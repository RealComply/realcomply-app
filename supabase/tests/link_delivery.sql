-- ===== READ ONLY. Email that gets through: Copy link, Opened, 3 November 2026 =====
--
-- Proves supabase/migrations/0107_link_delivery.sql. Run after it. Safe on
-- the live database: everything happens inside one transaction that is
-- rolled back at the end, so the made-up offices, people and listings it
-- creates never exist outside it.
--
-- Pass: the last line says "Link delivery: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1  uuid := gen_random_uuid();  -- an office whose licensee has no login
  o2  uuid := gen_random_uuid();  -- another office
  a   uuid := gen_random_uuid();  -- o1's agent, whose listing p1 is
  b   uuid := gen_random_uuid();  -- another agent in o1, not on p1
  f   uuid := gen_random_uuid();  -- o1's founder, who asks to be office manager
  x   uuid := gen_random_uuid();  -- an agent in o2
  p1  uuid;
  link uuid;
  real_tok uuid;
  tok uuid;
  req uuid;
  om_tok uuid;
  ax_tok uuid;
  t timestamptz;
  n integer;
  r record;
begin
  insert into auth.users (id, email) values
    (a, 'ld-a@example.invalid'), (b, 'ld-b@example.invalid'), (f, 'ld-f@example.invalid'), (x, 'ld-x@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'LD Office One (made up)', 'office_1', 'active', 'Lou Licensee', 'ld-lou@example.invalid'),
    (o2, 'LD Office Two (made up)', 'office_1', 'active', 'Other Licensee', 'ld-other@example.invalid');
  -- The licensee email has confirmed (0112), so links can go to it.
  insert into public.licensee_email_confirmations (agency_id, email, confirmed_at) values
    (o1, 'ld-lou@example.invalid', now()), (o2, 'ld-other@example.invalid', now());
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant, created_at) values
    (f, o1, 'Fran Founder', 'ld-f@example.invalid', true, false, false, now() - interval '2 days'),
    (a, o1, 'Ana Agent', 'ld-a@example.invalid', true, false, false, now() - interval '1 day'),
    (b, o1, 'Ben Agent', 'ld-b@example.invalid', true, false, false, now()),
    (x, o2, 'Xan Agent', 'ld-x@example.invalid', true, false, false, now());
  insert into public.properties (agency_id, created_by, address) values (o1, a, '1 Link Street (made up)') returning id into p1;

  -- The agent sends the file sign-off link, as the app does.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.property_signoff_requests (agency_id, property_id, statement)
  values (o1, p1, 'I sign off this file (made up).') returning id into link;
  reset role;
  select token into real_tok from public.property_signoff_requests where id = link;

  -- 1. The token is still never readable by the signed-in; when it was opened is.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    select token into tok from public.property_signoff_requests where id = link;
    raise exception 'FAIL 1: the agent read the token from the table';
  exception when insufficient_privilege then null;
  end;
  select opened_at into t from public.property_signoff_requests where id = link;
  if t is not null then raise exception 'FAIL 1b: opened before anyone opened it'; end if;

  -- 2. Copy link: the agent gets the token, and the copy is recorded.
  tok := public.copy_signoff_link(link);
  reset role;
  if tok is distinct from real_tok then raise exception 'FAIL 2: Copy link handed back the wrong token'; end if;
  select copied_by, copied_by_name, agency_id, property_id into r from public.signoff_link_copies where request_id = link;
  if r.copied_by <> a or r.copied_by_name <> 'Ana Agent' or r.agency_id <> o1 or r.property_id <> p1 then
    raise exception 'FAIL 2b: the copy was recorded as %', row_to_json(r); end if;

  -- 3. Someone in another office, or anonymous, can't copy it.
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.copy_signoff_link(link);
    raise exception 'FAIL 3: another office copied the link';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin
    perform public.copy_signoff_link(link);
    raise exception 'FAIL 3b: anonymous copied the link';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 4. The copies: the office reads them, another office doesn't, nobody
  --    signed in writes them.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.signoff_link_copies where request_id = link;
  if n <> 1 then raise exception 'FAIL 4: the agent sees % copies', n; end if;
  begin
    insert into public.signoff_link_copies (request_id, agency_id, property_id, copied_by, copied_by_name)
    values (link, o1, p1, a, 'Someone else');
    raise exception 'FAIL 4b: a copy was written by hand';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.signoff_link_copies;
  reset role;
  if n <> 0 then raise exception 'FAIL 4c: another office sees % copies', n; end if;

  -- 5. Opened: not when someone signed in to the same office opens it.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.note_link_opened('signoff', real_tok);
  reset role;
  if (select opened_at from public.property_signoff_requests where id = link) is not null then
    raise exception 'FAIL 5: the agent opening their own link counted as the licensee opening it'; end if;

  -- 6. Opened: yes when a person opens it without being signed in, once.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  perform public.note_link_opened('signoff', real_tok);
  reset role;
  select opened_at into t from public.property_signoff_requests where id = link;
  if t is null then raise exception 'FAIL 6: opening the link wasn''t recorded'; end if;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  perform public.note_link_opened('signoff', real_tok);
  -- An unknown token, or a kind that doesn't exist, says nothing and does nothing.
  perform public.note_link_opened('signoff', gen_random_uuid());
  perform public.note_link_opened('nonsense', real_tok);
  reset role;
  if (select opened_at from public.property_signoff_requests where id = link) <> t then
    raise exception 'FAIL 6b: a second open moved the time'; end if;

  -- 7. A signed link can't be copied any more.
  update public.property_signoff_requests set signed_at = now(), signed_name = 'Lou Licensee' where id = link;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.copy_signoff_link(link);
    raise exception 'FAIL 7: a signed link was copied';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm <> 'That link can''t be signed any more. Send a new one.' then
      raise exception 'FAIL 7b: refused with "%"', sqlerrm; end if;
  end;
  reset role;

  -- 8. An expired link isn't marked opened.
  update public.property_signoff_requests set signed_at = null, signed_name = null, opened_at = null,
         expires_at = now() - interval '1 minute' where id = link;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  perform public.note_link_opened('signoff', real_tok);
  reset role;
  if (select opened_at from public.property_signoff_requests where id = link) is not null then
    raise exception 'FAIL 8: an expired link was marked opened'; end if;

  -- 9. The office manager request: opened by link, and the person asking sees
  --    when, never the token.
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  set local role authenticated;
  req := public.request_office_manager();
  reset role;
  select token into om_tok from public.office_manager_requests where id = req;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  perform public.note_link_opened('office_manager', om_tok);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select opened_at into t from public.office_manager_requests where id = req;
  begin
    select token into om_tok from public.office_manager_requests where id = req;
    raise exception 'FAIL 9b: the person asking read the token';
  exception when insufficient_privilege then null;
  end;
  reset role;
  if t is null then raise exception 'FAIL 9: the office manager link''s open wasn''t recorded'; end if;

  -- 10. The annexure link: opened by link, and its status only for whoever
  --     set the office up or runs it (Fran, the account holder; not Ben).
  insert into public.sg_annexure_links (agency_id, sent_to, purpose) values (o1, 'ld-lou@example.invalid', 'new_office')
  returning token into ax_tok;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  perform public.note_link_opened('annexure', ax_tok);
  reset role;
  if (select opened_at from public.sg_annexure_links where token = ax_tok) is null then
    raise exception 'FAIL 10: the annexure link''s open wasn''t recorded'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.office_annexure_link_status();
  reset role;
  if n <> 0 then raise exception 'FAIL 10b: an agent who doesn''t run the office saw the annexure link'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r from public.office_annexure_link_status();
  reset role;
  if r.sent_to is distinct from 'ld-lou@example.invalid' or r.opened_at is null then
    raise exception 'FAIL 10c: the account holder reads the annexure link as %', row_to_json(r); end if;

  raise notice 'Link delivery: all checks passed';
end
$$;

rollback;
