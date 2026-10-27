-- ===== READ ONLY. "Set up your office" marks, 27 October 2026 =====
--
-- Proves supabase/migrations/0099_office_setup.sql. Run after it. Safe on the
-- live database: everything happens inside one transaction that is rolled
-- back at the end, so the made-up offices and people never exist outside it.
--
-- Pass: the last line says "Office setup marks: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1 uuid := gen_random_uuid();   -- an office
  o2 uuid := gen_random_uuid();   -- another office
  l   uuid := gen_random_uuid();  -- o1's licensee in charge
  m   uuid := gen_random_uuid();  -- o1's office manager
  a   uuid := gen_random_uuid();  -- an agent in o1
  x   uuid := gen_random_uuid();  -- o2's licensee in charge
  o3  uuid := gen_random_uuid();  -- an agent's own plan
  g   uuid := gen_random_uuid();  -- the agent on it
  n integer;
  who uuid;
begin
  insert into auth.users (id, email) values
    (l, 'os-l@example.invalid'), (m, 'os-m@example.invalid'), (a, 'os-a@example.invalid'), (x, 'os-x@example.invalid'),
    (g, 'os-g@example.invalid');
  insert into public.agencies (id, name, plan, status) values
    (o1, 'OS Office One', 'office_1', 'active'),
    (o2, 'OS Office Two', 'office_1', 'active'),
    (o3, 'OS Own Plan', 'agent_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (l, o1, 'Lee Licensee', 'os-l@example.invalid', true, true, false),
    (m, o1, 'Max Manager', 'os-m@example.invalid', true, false, false),
    (a, o1, 'Ana Agent', 'os-a@example.invalid', true, false, false),
    (x, o2, 'Xan Elsewhere', 'os-x@example.invalid', true, true, false),
    (g, o3, 'Gus Contractor', 'os-g@example.invalid', true, false, false);
  insert into public.office_managers (agency_id, profile_id, wording, approved_via, approved_by, approved_by_name)
  values (o1, m, 'I authorise Max Manager to manage OS Office One''s RealComply account as office manager.',
          'team', l, 'Lee Licensee');

  -- 1. The licensee marks iCare "Doesn't apply": recorded with who and when.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_office_setup_not_applicable('icare', true);
  reset role;
  select marked_by into who from public.office_setup_marks where agency_id = o1 and step = 'icare';
  if who is distinct from l then raise exception 'FAIL 1: iCare marked by %', who; end if;

  -- 2. An office manager can mark one too; marking again keeps the first.
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_office_setup_not_applicable('trust_account', true);
  perform public.set_office_setup_not_applicable('icare', true);
  reset role;
  select marked_by into who from public.office_setup_marks where agency_id = o1 and step = 'trust_account';
  if who is distinct from m then raise exception 'FAIL 2: trust marked by %', who; end if;
  select marked_by into who from public.office_setup_marks where agency_id = o1 and step = 'icare';
  if who is distinct from l then raise exception 'FAIL 2b: the first marking was replaced'; end if;

  -- 3. An agent can't mark anything, or record the office done.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_office_setup_not_applicable('team_invited', true);
    raise exception 'FAIL 3: an agent marked a step';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.note_office_setup_done();
    raise exception 'FAIL 3b: an agent recorded the office done';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- ... but can read their office's marks.
  select count(*) into n from public.office_setup_marks;
  if n <> 2 then raise exception 'FAIL 3c: an agent reads % marks, expected 2', n; end if;
  -- ... and can't write the table directly.
  begin
    insert into public.office_setup_marks (agency_id, step, marked_by) values (o1, 'all_done', a);
    raise exception 'FAIL 3d: an agent wrote a mark directly';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;

  -- 4. Only the four steps can be marked "Doesn't apply"; never all_done that way.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_office_setup_not_applicable('all_done', true);
    raise exception 'FAIL 4: all_done marked as not applying';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.set_office_setup_not_applicable('pi', true);
    raise exception 'FAIL 4b: PI marked as not applying';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 5. "It does apply after all" takes the mark away.
  perform public.set_office_setup_not_applicable('trust_account', false);
  reset role;
  select count(*) into n from public.office_setup_marks where agency_id = o1 and step = 'trust_account';
  if n <> 0 then raise exception 'FAIL 5: the trust mark is still there'; end if;

  -- 6. Recording the office done: once, by whoever got there first.
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.note_office_setup_done();
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.note_office_setup_done();
  reset role;
  select marked_by into who from public.office_setup_marks where agency_id = o1 and step = 'all_done';
  if who is distinct from m then raise exception 'FAIL 6: all_done recorded by %', who; end if;

  -- 7. Another office sees none of it, and its marks land on its own office.
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.office_setup_marks;
  if n <> 0 then raise exception 'FAIL 7: another office reads % marks', n; end if;
  perform public.set_office_setup_not_applicable('corporation_licence', true);
  reset role;
  select count(*) into n from public.office_setup_marks where agency_id = o2 and step = 'corporation_licence';
  if n <> 1 then raise exception 'FAIL 7b: the other office''s mark is missing'; end if;
  select count(*) into n from public.office_setup_marks where agency_id = o1 and step = 'corporation_licence';
  if n <> 0 then raise exception 'FAIL 7c: a mark landed on the wrong office'; end if;

  -- 8. An office keeps its own SG Manual: no "Doesn't apply" on it.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_office_setup_not_applicable('sg_manual', true);
    raise exception 'FAIL 8: an office marked its SG Manual as not applying';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;

  -- 9. The agent on their own plan (addendum, 27 Oct): SG Manual and trust
  -- account can be "Doesn't apply", and they can record their set-up done.
  perform set_config('request.jwt.claims', json_build_object('sub', g, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_office_setup_not_applicable('sg_manual', true);
  perform public.set_office_setup_not_applicable('trust_account', true);
  perform public.note_office_setup_done();
  reset role;
  select count(*) into n from public.office_setup_marks
   where agency_id = o3 and marked_by = g and step in ('sg_manual', 'trust_account', 'all_done');
  if n <> 3 then raise exception 'FAIL 9: the agent on their own plan has % of 3 marks', n; end if;

  -- 10. The office's listing count: for whoever runs the office, not agents.
  insert into public.properties (agency_id, created_by, address) values (o1, a, '1 Setup Street (made up)');
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.office_setup_listing_count() is distinct from 1 then
    raise exception 'FAIL 10: the office manager reads % listings', public.office_setup_listing_count();
  end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.office_setup_listing_count() is not null then raise exception 'FAIL 10b: an agent read the office count'; end if;
  reset role;

  -- 11. Signed out, nothing.
  set local role anon;
  begin
    perform public.set_office_setup_not_applicable('icare', true);
    raise exception 'FAIL 11: anon called it';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'Office setup marks: all checks passed';
end
$$;

rollback;
