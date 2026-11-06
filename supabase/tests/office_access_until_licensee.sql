-- ===== READ ONLY. Office access until the licensee approves, 6 November 2026 =====
--
-- Proves supabase/migrations/0115_office_access_until_licensee.sql. Run after
-- it. Safe on the live database: everything happens inside one transaction
-- that is rolled back at the end, so the made-up offices and people it
-- creates never exist outside it.
--
-- Pass: the last line says "Office access until licensee: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1 uuid := gen_random_uuid();   -- moved from an agent plan; licensee has no login
  o2 uuid := gen_random_uuid();   -- a licensee joins RealComply
  o3 uuid := gen_random_uuid();   -- goes back to an agent plan
  o4 uuid := gen_random_uuid();   -- someone else is approved as office manager
  c  uuid := gen_random_uuid();   -- o1's account holder, who keeps access
  x  uuid := gen_random_uuid();   -- another agent in o1
  c2 uuid := gen_random_uuid();
  l2 uuid := gen_random_uuid();   -- o2's licensee, joining
  c3 uuid := gen_random_uuid();
  c4 uuid := gen_random_uuid();
  m4 uuid := gen_random_uuid();   -- o4's other agent, approved as office manager
  tok uuid;
  req uuid;
  n integer;
  ok boolean;
begin
  insert into auth.users (id, email) values
    (c, 'oal-c@example.invalid'), (x, 'oal-x@example.invalid'), (c2, 'oal-c2@example.invalid'),
    (l2, 'oal-l2@example.invalid'), (c3, 'oal-c3@example.invalid'), (c4, 'oal-c4@example.invalid'),
    (m4, 'oal-m4@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'OAL Office One (made up)', 'office_1', 'active', 'Sue Licensee', 'oal-sue@example.invalid'),
    (o2, 'OAL Office Two (made up)', 'office_1', 'active', 'Lou Licensee', 'oal-l2@example.invalid'),
    (o3, 'OAL Office Three (made up)', 'office_1', 'active', 'Kim Licensee', 'oal-kim@example.invalid'),
    (o4, 'OAL Office Four (made up)', 'office_1', 'active', 'Pat Licensee', 'oal-pat@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (c, o1, 'Cass Agent', 'oal-c@example.invalid', true, false, false),
    (x, o1, 'Xan Agent', 'oal-x@example.invalid', true, false, false),
    (c2, o2, 'Cam Agent', 'oal-c2@example.invalid', true, false, false),
    (c3, o3, 'Cy Agent', 'oal-c3@example.invalid', true, false, false),
    (c4, o4, 'Cleo Agent', 'oal-c4@example.invalid', true, false, false),
    (m4, o4, 'Max Agent', 'oal-m4@example.invalid', true, false, false);

  -- 1. Before any row: an agent on an office plan has no office side.
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.keeps_office_access() or public.is_office_manager() or public.runs_office() then
    raise exception 'FAIL 1: office access before anything was given';
  end if;
  reset role;

  -- 2. Given (as RealComply does, in the SQL editor): the office side, as an
  --    office manager has it, and nothing that stays with the licensee.
  insert into public.office_access_until_licensee (agency_id, profile_id, reason) values
    (o1, c, 'Moved from Agent 1 to Office 1 (made up)'),
    (o2, c2, 'Moved from Agent 1 to Office 1 (made up)'),
    (o3, c3, 'Moved from Agent 1 to Office 1 (made up)'),
    (o4, c4, 'Moved from Agent 1 to Office 1 (made up)');
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.keeps_office_access() then raise exception 'FAIL 2: keeps_office_access() is false once given'; end if;
  if not public.is_office_manager() then raise exception 'FAIL 2b: not counted as office manager'; end if;
  if not public.runs_office() then raise exception 'FAIL 2c: runs_office() is false'; end if;
  if public.acts_as_licensee() then raise exception 'FAIL 2d: acts as licensee (that stays with the licensee)'; end if;
  if public.is_approved_office_manager() then raise exception 'FAIL 2e: counted as an approved office manager'; end if;
  -- An office manager's power, by the rule that already lets one in: inviting
  -- an agent to the office (0095).
  insert into public.agency_invites (agency_id, email, is_licensee_in_charge, invited_by)
  values (o1, 'oal-new@example.invalid', false, c);
  reset role;

  -- 3. Only the person named: another agent in the office gets nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.keeps_office_access() or public.is_office_manager() or public.runs_office() then
    raise exception 'FAIL 3: another agent in the office got office access';
  end if;
  begin
    insert into public.agency_invites (agency_id, email, is_licensee_in_charge, invited_by)
    values (o1, 'oal-new2@example.invalid', false, x);
    raise exception 'FAIL 3b: another agent could invite';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 4. Nobody signed in writes the table, and other offices can't read it.
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.office_access_until_licensee set started_at = now() where agency_id = o1;
    raise exception 'FAIL 4: a signed-in person changed the record';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.office_access_until_licensee (agency_id, profile_id, reason) values (o1, x, 'x');
    raise exception 'FAIL 4b: a signed-in person added a record';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from public.office_access_until_licensee where agency_id = o1;
  if n <> 1 then raise exception 'FAIL 4c: the office can''t see its own record (%)', n; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.office_access_until_licensee where agency_id = o1;
  if n <> 0 then raise exception 'FAIL 4d: another office can read the record'; end if;
  reset role;

  -- 5. They can still ask the licensee to approve them (once the licensee
  --    email has confirmed, as 0112 requires of everyone).
  insert into public.licensee_email_confirmations (agency_id, email, confirmed_at)
  values (o1, 'oal-sue@example.invalid', now());
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  req := public.request_office_manager();
  if req is null then raise exception 'FAIL 5: no request was made'; end if;
  reset role;
  select r.token, r.sent_to = 'oal-sue@example.invalid' into tok, ok from public.office_manager_requests r where r.id = req;
  if not ok then raise exception 'FAIL 5b: the request didn''t go to the licensee email'; end if;

  -- 6. The licensee approves: an office manager by approval, and the
  --    interim access is over.
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  if not public.approve_office_manager(tok, 'Sue Licensee') then raise exception 'FAIL 6: the approval didn''t go through'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.keeps_office_access() then raise exception 'FAIL 6b: still keeping access after the approval'; end if;
  if not (public.is_approved_office_manager() and public.is_office_manager() and public.runs_office()) then
    raise exception 'FAIL 6c: not office manager after the approval';
  end if;
  reset role;

  -- 7. The licensee withdraws it: the interim access doesn't come back.
  select m.withdraw_token into tok from public.office_managers m where m.agency_id = o1 and m.profile_id = c;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  if not public.withdraw_office_manager_by_token(tok) then raise exception 'FAIL 7: the withdrawal didn''t go through'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.keeps_office_access() or public.is_office_manager() or public.runs_office() then
    raise exception 'FAIL 7b: office access came back after the licensee withdrew it';
  end if;
  reset role;

  -- 8. A licensee in charge joins RealComply: over.
  perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.keeps_office_access() then raise exception 'FAIL 8: o2 setup'; end if;
  reset role;
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant)
  values (l2, o2, 'Lou Licensee', 'oal-l2@example.invalid', true, true, false);
  perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.keeps_office_access() or public.is_office_manager() then
    raise exception 'FAIL 8b: still keeping access once the licensee joined';
  end if;
  reset role;

  -- 9. Back to an agent plan: over (on an agent plan the agent runs their
  --    own account anyway).
  perform set_config('request.jwt.claims', '', true);
  update public.agencies set plan = 'agent_1' where id = o3;
  perform set_config('request.jwt.claims', json_build_object('sub', c3, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.keeps_office_access() or public.is_office_manager() then
    raise exception 'FAIL 9: still counted as office manager on an agent plan';
  end if;
  if not public.acts_as_licensee() then raise exception 'FAIL 9b: the agent on their own plan doesn''t run it'; end if;
  reset role;

  -- 10. The licensee approves someone else as office manager: over.
  insert into public.office_managers (agency_id, profile_id, wording, approved_via, approved_by_name)
  values (o4, m4, 'I authorise Max Agent to manage OAL Office Four''s RealComply account as office manager.', 'email_link', 'Pat Licensee');
  perform set_config('request.jwt.claims', json_build_object('sub', c4, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.keeps_office_access() or public.is_office_manager() then
    raise exception 'FAIL 10: still keeping access once the licensee approved an office manager';
  end if;
  reset role;

  -- 11. An approved office manager is unchanged.
  perform set_config('request.jwt.claims', json_build_object('sub', m4, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not (public.is_approved_office_manager() and public.is_office_manager() and public.runs_office()) then
    raise exception 'FAIL 11: an approved office manager lost access';
  end if;
  if public.keeps_office_access() then raise exception 'FAIL 11b: an approved office manager counted as interim'; end if;
  begin
    perform public.request_office_manager();
    raise exception 'FAIL 11c: an approved office manager could ask again';
  exception when raise_exception then
    if sqlerrm <> 'You''re already office manager.' then raise; end if;
  end;
  reset role;

  raise notice 'Office access until licensee: all checks passed';
end $$;

rollback;
