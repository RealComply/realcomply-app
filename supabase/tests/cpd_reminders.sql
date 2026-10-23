-- ===== READ ONLY. CPD reminders record, 19 October 2026 =====
--
-- Proves supabase/migrations/0084_cpd_reminders.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up office and people it creates
-- never exist outside it.
--
-- Pass: the last line says "CPD reminders: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  ag uuid := gen_random_uuid();      -- a made-up office
  lic uuid := gen_random_uuid();     -- its licensee in charge
  jo uuid := gen_random_uuid();      -- an agent
  sam uuid := gen_random_uuid();     -- another agent
  n integer;
begin
  insert into auth.users (id, email) values
    (lic, 'cr-lic@example.invalid'), (jo, 'cr-jo@example.invalid'), (sam, 'cr-sam@example.invalid');
  insert into public.agencies (id, name, plan, status) values (ag, 'CR Property (made up)', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent) values
    (lic, ag, 'CR Licensee', 'cr-lic@example.invalid', true, false, true),
    (jo, ag, 'CR Jo', 'cr-jo@example.invalid', false, false, true),
    (sam, ag, 'CR Sam', 'cr-sam@example.invalid', false, false, true);

  -- The daily job's writes (the table's owner here, as the service client).
  insert into public.cpd_reminders (agency_id, profile_id, kind, cpd_year_start, send_date, recipients)
  values (ag, jo, 'person', '2026-07-01', '2027-04-01', array['cr-jo@example.invalid']),
         (ag, sam, 'person', '2026-07-01', '2027-04-01', array['cr-sam@example.invalid']);
  insert into public.cpd_reminders (agency_id, profile_id, kind, cpd_year_start, send_date, outstanding, recipients)
  values (ag, lic, 'summary', '2026-07-01', '2027-04-01', array[jo, sam], array['cr-lic@example.invalid']);

  -- 1. The same person, kind, year and date can't be recorded twice.
  begin
    insert into public.cpd_reminders (agency_id, profile_id, kind, cpd_year_start, send_date)
    values (ag, jo, 'person', '2026-07-01', '2027-04-01');
    raise exception 'FAIL 1: the same reminder was recorded twice';
  exception when unique_violation then
    null;
  end;
  -- The next date is a new row.
  insert into public.cpd_reminders (agency_id, profile_id, kind, cpd_year_start, send_date)
  values (ag, jo, 'person', '2026-07-01', '2027-05-01');

  -- 2. A CPD year starts on 1 July.
  begin
    insert into public.cpd_reminders (agency_id, profile_id, kind, cpd_year_start, send_date)
    values (ag, jo, 'person', '2026-01-01', '2027-04-01');
    raise exception 'FAIL 2: a CPD year not starting 1 July was accepted';
  exception when check_violation then
    null;
  end;

  -- 3. An agent sees their own reminders only.
  perform set_config('request.jwt.claims', json_build_object('sub', jo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.cpd_reminders where agency_id = ag;
  reset role;
  if n <> 2 then raise exception 'FAIL 3: an agent saw % reminders, expected their own 2', n; end if;

  -- 4. The licensee in charge sees the office's.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.cpd_reminders where agency_id = ag;
  reset role;
  if n <> 4 then raise exception 'FAIL 4: the licensee saw % reminders, expected 4', n; end if;

  -- 5. Nobody signed in can add, change or remove one, not even the licensee:
  --    a removed row would re-arm a reminder already sent.
  begin
    set local role authenticated;
    insert into public.cpd_reminders (agency_id, profile_id, kind, cpd_year_start, send_date)
    values (ag, lic, 'person', '2026-07-01', '2027-06-01');
    reset role;
    raise exception 'FAIL 5: a signed-in person recorded a reminder';
  exception when insufficient_privilege then
    reset role;
  end;
  begin
    set local role authenticated;
    delete from public.cpd_reminders where agency_id = ag;
    reset role;
    raise exception 'FAIL 5: a signed-in person removed a reminder';
  exception when insufficient_privilege then
    reset role;
  end;
  begin
    set local role authenticated;
    update public.cpd_reminders set send_date = '2027-06-23' where agency_id = ag;
    reset role;
    raise exception 'FAIL 5: a signed-in person changed a reminder';
  exception when insufficient_privilege then
    reset role;
  end;
  select count(*) into n from public.cpd_reminders where agency_id = ag;
  if n <> 4 then raise exception 'FAIL 5: % reminders left, expected 4', n; end if;

  -- 6. Not visible to anyone not signed in.
  if has_table_privilege('anon', 'public.cpd_reminders', 'select') then
    raise exception 'FAIL 6: anon can read cpd_reminders';
  end if;
end $$;

select 'CPD reminders: all checks passed' as result;

rollback;
