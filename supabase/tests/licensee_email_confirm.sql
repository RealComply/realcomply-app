-- ===== READ ONLY. The licensee email confirms first, 4 November 2026 =====
--
-- Proves supabase/migrations/0112_licensee_email_confirm.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up offices and people it creates
-- never exist outside it.
--
-- Pass: the last line says "Licensee email confirm first: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1 uuid := gen_random_uuid();   -- an office whose licensee has no login
  o2 uuid := gen_random_uuid();   -- an office whose licensee has a login
  o3 uuid := gen_random_uuid();   -- an agent on their own plan
  a  uuid := gen_random_uuid();   -- o1's account holder, an agent
  m  uuid := gen_random_uuid();   -- o1's office manager
  b  uuid := gen_random_uuid();   -- another agent in o1, who asks to be office manager
  l2 uuid := gen_random_uuid();   -- o2's licensee in charge
  a2 uuid := gen_random_uuid();   -- an agent in o2
  g  uuid := gen_random_uuid();   -- the agent on their own plan
  p1 uuid := gen_random_uuid();   -- a's listing
  p2 uuid := gen_random_uuid();   -- a2's listing
  conf uuid;
  tok uuid;
  old_tok uuid;
  req uuid;
  n integer;
  r record;
  ok boolean;
begin
  insert into auth.users (id, email) values
    (a, 'lec-a@example.invalid'), (m, 'lec-m@example.invalid'), (b, 'lec-b@example.invalid'),
    (l2, 'lec-l2@example.invalid'), (a2, 'lec-a2@example.invalid'), (g, 'lec-g@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'LEC Office One (made up)', 'office_2', 'active', 'Lee Licensee', 'LEC-Lee-Own@Example.invalid '),
    (o2, 'LEC Office Two (made up)', 'office_2', 'active', 'Lou Licensee', 'lec-l2@example.invalid'),
    (o3, 'LEC Agent Plan (made up)', 'agent_1', 'active', 'Kim Licensee', 'lec-kim@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (a, o1, 'Ana Agent', 'lec-a@example.invalid', true, false, false),
    (m, o1, 'Max Manager', 'lec-m@example.invalid', true, false, false),
    (b, o1, 'Ben Agent', 'lec-b@example.invalid', true, false, false),
    (l2, o2, 'Lou Licensee', 'lec-l2@example.invalid', true, true, false),
    (a2, o2, 'Abe Agent', 'lec-a2@example.invalid', true, false, false),
    (g, o3, 'Gus Agent', 'lec-g@example.invalid', true, false, false);
  insert into public.office_managers (agency_id, profile_id, wording, approved_via, approved_by_name) values
    (o1, m, 'I authorise Max Manager to manage LEC Office One''s RealComply account as office manager.', 'email_link', 'Lee Licensee');
  insert into public.properties (id, agency_id, created_by, address) values
    (p1, o1, a, '1 Confirm Street, Nowhere NSW (made up)'),
    (p2, o2, a2, '2 Confirm Street, Nowhere NSW (made up)');

  -- 1. Nothing goes to an address that hasn't confirmed.
  if public.licensee_email_confirmed(o1) then raise exception 'FAIL 1: o1 counts as confirmed before anything'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.property_signoff_requests (agency_id, property_id, statement) values (o1, p1, 'I sign off this file (made up).');
    raise exception 'FAIL 1b: a file sign-off link went to an address that hasn''t confirmed';
  exception when raise_exception then
    if sqlerrm not like 'Waiting for lec-lee-own@example.invalid to confirm%' then raise; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.request_office_manager();
    raise exception 'FAIL 1c: an office manager request went to an address that hasn''t confirmed';
  exception when raise_exception then
    if sqlerrm not like 'Waiting for lec-lee-own@example.invalid to confirm%' then raise; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.agency_invites (agency_id, email, is_licensee_in_charge, invited_by) values (o1, 'x@example.invalid', true, m);
    raise exception 'FAIL 1d: a licensee invite was made for an address that hasn''t confirmed';
  exception when raise_exception then
    if sqlerrm not like 'Waiting for lec-lee-own@example.invalid to confirm%' then raise; end if;
  end;
  reset role;
  begin
    insert into public.sg_annexure_links (agency_id, sent_to, purpose) values (o1, 'lec-lee-own@example.invalid', 'new_office');
    raise exception 'FAIL 1e: an annexure link was made for an address that hasn''t confirmed';
  exception when raise_exception then
    if sqlerrm not like 'Waiting for lec-lee-own@example.invalid to confirm%' then raise; end if;
  end;

  -- 2. The daily job's list: o1 once; never o2 (the licensee's login) or o3 (an agent's licensee).
  select count(*) into n from public.pending_licensee_confirmations() where agency_id = o1 and email = 'lec-lee-own@example.invalid';
  if n <> 1 then raise exception 'FAIL 2: o1 isn''t on the list to confirm'; end if;
  select count(*) into n from public.pending_licensee_confirmations() where agency_id in (o2, o3);
  if n <> 0 then raise exception 'FAIL 2b: an office that needs no email is on the list'; end if;
  if not public.licensee_email_confirmed(o2) then raise exception 'FAIL 2c: the licensee''s own login isn''t accepted'; end if;

  -- 3. Anyone in the office asks for it; the token stays hidden; the send is recorded.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  conf := public.request_licensee_confirmation();
  if conf is null then raise exception 'FAIL 3: no confirmation to send'; end if;
  begin
    perform token from public.licensee_email_confirmations where id = conf;
    raise exception 'FAIL 3b: someone signed in read the confirm token';
  exception when insufficient_privilege then null;
  end;
  perform public.record_licensee_confirmation_email(conf, true);
  begin
    perform public.request_licensee_confirmation();
    raise exception 'FAIL 3c: it could be sent again straight away';
  exception when raise_exception then
    if sqlerrm not like 'We sent it to lec-lee-own@example.invalid a few minutes ago%' then raise; end if;
  end;
  reset role;
  select count(*) into n from public.pending_licensee_confirmations() where agency_id = o1;
  if n <> 0 then raise exception 'FAIL 3d: the daily job would send it again'; end if;
  select token into tok from public.licensee_email_confirmations where id = conf;

  -- 4. The click, with no login.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  select * into r from public.licensee_confirmation_details(tok);
  if r.office_name <> 'LEC Office One (made up)' or r.email <> 'lec-lee-own@example.invalid' or r.confirmed_at is not null
     or not r.is_current then
    raise exception 'FAIL 4: the confirm page would show %', row_to_json(r); end if;
  if public.confirm_licensee_email(tok, '203.0.113.5') is distinct from o1 then
    raise exception 'FAIL 4b: the click didn''t confirm'; end if;
  begin
    perform count(*) from public.licensee_email_confirmations;
    raise exception 'FAIL 4c: anonymous read the confirmations';
  exception when insufficient_privilege then null;
  end;
  reset role;
  select confirmed_at, confirmed_ip into r from public.licensee_email_confirmations where id = conf;
  if r.confirmed_at is null or r.confirmed_ip <> '203.0.113.5' then
    raise exception 'FAIL 4d: the click recorded %', row_to_json(r); end if;
  if not public.licensee_email_confirmed(o1) then raise exception 'FAIL 4e: o1 still isn''t confirmed'; end if;

  -- 5. Then the links go.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.property_signoff_requests (agency_id, property_id, statement) values (o1, p1, 'I sign off this file (made up).');
  reset role;
  if (select sent_to from public.property_signoff_requests where property_id = p1) <> 'LEC-Lee-Own@Example.invalid ' then
    raise exception 'FAIL 5: the file sign-off link went somewhere else'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  req := public.request_office_manager();
  reset role;
  if req is null then raise exception 'FAIL 5b: no office manager request after the click'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.agency_invites (agency_id, email, is_licensee_in_charge, invited_by) values (o1, 'x@example.invalid', true, m);
  select count(*) into n from public.licensee_link_sends() where kind = 'confirm' and sent_to = 'lec-lee-own@example.invalid';
  if n <> 1 then raise exception 'FAIL 5c: Office profile wouldn''t show when the confirm email went'; end if;
  select count(*) into n from public.licensee_link_sends() where kind = 'licensee_invite' and sent_to = 'lec-lee-own@example.invalid';
  if n <> 1 then raise exception 'FAIL 5d: Office profile wouldn''t show the invite'; end if;
  reset role;

  -- 6. A licensee whose own login is the licensee email needs no confirming.
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.property_signoff_requests (agency_id, property_id, statement) values (o2, p2, 'I sign off this file (made up).');
  reset role;

  -- 7. A new licensee email starts again, and links to the old one stop.
  select token into old_tok from public.office_manager_requests where id = req;
  update public.agencies set licensee_email = 'lec-new@example.invalid' where id = o1;
  if public.licensee_email_confirmed(o1) then raise exception 'FAIL 7: the new address counts as confirmed'; end if;
  if (select superseded_at from public.licensee_email_confirmations where id = conf) is null then
    raise exception 'FAIL 7b: the old address''s confirmation still stands'; end if;
  if (select revoked_at from public.property_signoff_requests where property_id = p1) is null then
    raise exception 'FAIL 7c: the file sign-off link to the old address still works'; end if;
  if (select cancelled_at from public.office_manager_requests where id = req) is null then
    raise exception 'FAIL 7d: the office manager request to the old address is still open'; end if;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  ok := public.approve_office_manager(old_tok, 'Lee Licensee');
  if ok then raise exception 'FAIL 7e: the old address approved an office manager'; end if;
  if public.confirm_licensee_email(tok, '203.0.113.9') is not null then
    raise exception 'FAIL 7f: the old confirm link confirmed the new address'; end if;
  select is_current into ok from public.licensee_confirmation_details(tok);
  if ok then raise exception 'FAIL 7g: the old confirm page still offers to confirm'; end if;
  reset role;
  -- The o2 link went to the licensee's own login and stays.
  if (select revoked_at from public.property_signoff_requests where property_id = p2) is not null then
    raise exception 'FAIL 7h: a link in another office was withdrawn'; end if;
  select count(*) into n from public.pending_licensee_confirmations() where agency_id = o1 and email = 'lec-new@example.invalid';
  if n <> 1 then raise exception 'FAIL 7i: the new address isn''t on the list to confirm'; end if;

  -- 8. Another office can't see this office's confirmations or sends.
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.licensee_email_confirmations where agency_id = o1;
  if n <> 0 then raise exception 'FAIL 8: another office saw the confirmations'; end if;
  select count(*) into n from public.licensee_link_sends() where sent_to like 'lec-lee-own%';
  if n <> 0 then raise exception 'FAIL 8b: another office saw where links went'; end if;
  reset role;

  raise notice 'Licensee email confirm first: all checks passed';
end $$;

rollback;
