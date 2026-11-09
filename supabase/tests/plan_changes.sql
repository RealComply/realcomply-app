-- ===== READ ONLY. Self-serve plan changes, 6 November 2026 =====
--
-- Proves supabase/migrations/0116_plan_changes.sql. Run after it. Safe on the
-- live database: everything happens inside one transaction that is rolled
-- back at the end, so the made-up offices and people it creates never exist
-- outside it.
--
-- Pass: the last line says "Plan changes: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1 uuid := gen_random_uuid();   -- an agent who says "I am" the licensee
  o2 uuid := gen_random_uuid();   -- an agent who says "someone else"
  o3 uuid := gen_random_uuid();   -- another office, to check what it can read
  c1 uuid := gen_random_uuid();
  c2 uuid := gen_random_uuid();
  x2 uuid := gen_random_uuid();   -- an agent later invited into o2
  c3 uuid := gen_random_uuid();
  n integer;
  t text;
  r record;
begin
  insert into auth.users (id, email) values
    (c1, 'pc-c1@example.invalid'), (c2, 'pc-c2@example.invalid'), (x2, 'pc-x2@example.invalid'), (c3, 'pc-c3@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'PC Office One (made up)', 'agent_1', 'active', 'Old Licensee', 'pc-old@example.invalid'),
    (o2, 'PC Office Two (made up)', 'agent_1', 'active', 'Lee Licensee', 'pc-lee@example.invalid'),
    (o3, 'PC Office Three (made up)', 'office_1', 'active', 'Kim Licensee', 'pc-kim@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (c1, o1, 'Cam Agent', 'pc-c1@example.invalid', true, false, false),
    (c2, o2, 'Cass Agent', 'pc-c2@example.invalid', true, false, false),
    (c3, o3, 'Cy Agent', 'pc-c3@example.invalid', true, false, false);

  -- 1. Only the server records the licensee answer, or checks it.
  perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.apply_plan_change_licensee(o1, c1, 'self', null, null, 'x');
    raise exception 'FAIL 1: a signed-in person recorded a licensee answer';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.plan_change_licensee_problem(o1, c1, 'self', null, null);
    raise exception 'FAIL 1b: a signed-in person ran the check';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- 2. The check before anything is charged.
  if public.plan_change_licensee_problem(o2, c2, 'self', null, null) is not null then raise exception 'FAIL 2: "I am" refused'; end if;
  if public.plan_change_licensee_problem(o2, c2, '', null, null) <> 'Say who the licensee in charge is.' then raise exception 'FAIL 2b'; end if;
  if public.plan_change_licensee_problem(o2, c2, 'someone_else', '  ', 'a@b.co') <> 'Add the licensee''s name.' then raise exception 'FAIL 2c'; end if;
  if public.plan_change_licensee_problem(o2, c2, 'someone_else', 'Lee', 'not an email') <> 'Add the licensee''s email.' then raise exception 'FAIL 2d'; end if;
  t := public.plan_change_licensee_problem(o2, c2, 'someone_else', 'Lee', ' PC-C2@example.invalid ');
  if t is distinct from 'That email is the login of someone in your office. Use your licensee''s own email.' then
    raise exception 'FAIL 2e: the payer''s own login was accepted as the licensee email (%)', t;
  end if;
  if public.plan_change_licensee_problem(o2, c2, 'someone_else', 'Lee Licensee', 'pc-lee@example.invalid') is not null then
    raise exception 'FAIL 2f: a good answer refused';
  end if;

  -- 3. Not before the office is on the office plan.
  begin
    perform public.apply_plan_change_licensee(o1, c1, 'self', null, null, 'x');
    raise exception 'FAIL 3: recorded while still on an agent plan';
  exception when raise_exception then
    if sqlerrm <> 'The office isn''t on an office plan yet.' then raise; end if;
  end;

  -- 4. "I am": marked licensee in charge, the office's licensee is them, and
  --    the history records them as the office's first licensee in charge.
  update public.agencies set plan = 'office_1' where id in (o1, o2);
  perform public.apply_plan_change_licensee(o1, c1, 'self', null, null, 'Moved from Agent 1 to Office 1 (made up)');
  select p.is_licensee_in_charge as flagged, a.licensee_name, a.licensee_email into r
    from public.profiles p join public.agencies a on a.id = p.agency_id where p.id = c1;
  if not r.flagged then raise exception 'FAIL 4: not marked licensee in charge'; end if;
  if r.licensee_name <> 'Cam Agent' or r.licensee_email <> 'pc-c1@example.invalid' then
    raise exception 'FAIL 4b: the office''s licensee is % / %', r.licensee_name, r.licensee_email;
  end if;
  select count(*) into n from public.licensee_in_charge_history h
   where h.agency_id = o1 and h.profile_id = c1 and h.source = 'first' and h.ended_at is null;
  if n <> 1 then raise exception 'FAIL 4c: history line (%)', n; end if;
  if exists (select 1 from public.office_access_until_licensee where agency_id = o1) then
    raise exception 'FAIL 4d: "I am" gave interim access';
  end if;

  -- 5. "Someone else": the office's licensee is who they typed, and the
  --    payer keeps the office side until that licensee approves or joins.
  perform public.apply_plan_change_licensee(o2, c2, 'someone_else', ' Lee Licensee ', ' PC-Lee@Example.invalid ', 'Moved from Agent 1 to Office 1 (made up)');
  select a.licensee_name, a.licensee_email into r from public.agencies a where a.id = o2;
  if r.licensee_name <> 'Lee Licensee' or r.licensee_email <> 'pc-lee@example.invalid' then
    raise exception 'FAIL 5: the office''s licensee is % / %', r.licensee_name, r.licensee_email;
  end if;
  if (select is_licensee_in_charge from public.profiles where id = c2) then raise exception 'FAIL 5b: the payer was marked licensee'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not (public.keeps_office_access() and public.runs_office()) then raise exception 'FAIL 5c: the payer lost the office side'; end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.apply_plan_change_licensee(o2, c2, 'someone_else', 'Lee', 'pc-c2@example.invalid', 'x');
    raise exception 'FAIL 5d: the payer''s login recorded as the licensee email';
  exception when raise_exception then
    if sqlerrm not like 'That email is the login of someone in your office%' then raise; end if;
  end;

  -- 6. The record: written by the server only; read by the office side and
  --    the account holder; not by another office, nor an agent who doesn't pay.
  insert into public.plan_changes (agency_id, changed_by, changed_by_name, from_plan, from_interval, to_plan, to_interval,
                                   takes_effect, effective_at, next_payment_at, amount_today_cents, ongoing_cents, licensee_answer, status)
  values (o2, c2, 'Cass Agent', 'agent_1', 'monthly', 'office_1', 'monthly', 'now', now(), now() + interval '12 days', 5918, 24900, 'someone_else', 'done');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant)
  values (x2, o2, 'Xan Agent', 'pc-x2@example.invalid', true, false, false);

  perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.plan_changes where agency_id = o2;
  if n <> 1 then raise exception 'FAIL 6: the payer can''t read their own change (%)', n; end if;
  begin
    insert into public.plan_changes (agency_id, from_plan, from_interval, to_plan, to_interval, takes_effect, effective_at, ongoing_cents)
    values (o2, 'office_1', 'monthly', 'office_5', 'monthly', 'now', now(), 0);
    raise exception 'FAIL 6b: a signed-in person wrote a plan change';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', x2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.plan_changes;
  if n <> 0 then raise exception 'FAIL 6c: an agent who doesn''t pay can read the plan changes'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c3, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.plan_changes;
  if n <> 0 then raise exception 'FAIL 6d: another office can read the plan changes'; end if;
  reset role;

  -- 7. The record's own rules.
  begin
    insert into public.plan_changes (agency_id, from_plan, from_interval, to_plan, to_interval, takes_effect, effective_at, ongoing_cents)
    values (o3, 'office_9', 'monthly', 'office_1', 'monthly', 'now', now(), 0);
    raise exception 'FAIL 7: a made-up plan was recorded';
  exception when check_violation then null;
  end;

  raise notice 'Plan changes: all checks passed';
end $$;

rollback;
