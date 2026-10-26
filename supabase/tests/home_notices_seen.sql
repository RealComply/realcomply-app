-- ===== READ ONLY. Office manager card on Home, seen once, 26 October 2026 =====
--
-- Proves supabase/migrations/0096_home_notices_seen.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up offices and people it creates
-- never exist outside it.
--
-- Pass: the last line says "Home notices: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1 uuid := gen_random_uuid();
  l  uuid := gen_random_uuid();   -- licensee in charge of office 1
  m  uuid := gen_random_uuid();   -- office manager in office 1
  o2 uuid := gen_random_uuid();
  x  uuid := gen_random_uuid();   -- someone in another office
  rec uuid := gen_random_uuid();
  k  text;
  first_seen timestamptz;
  dismissed timestamptz;
  n integer;
begin
  insert into auth.users (id, email) values
    (l, 'hn-l@example.invalid'), (m, 'hn-m@example.invalid'), (x, 'hn-x@example.invalid');
  insert into public.agencies (id, name, plan, status) values
    (o1, 'HN Office One', 'office_1', 'active'),
    (o2, 'HN Office Two', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (l, o1, 'Lee Licensee', 'hn-l@example.invalid', true, true, false),
    (m, o1, 'Max Manager', 'hn-m@example.invalid', true, false, false),
    (x, o2, 'Xan Elsewhere', 'hn-x@example.invalid', true, false, false);
  insert into public.office_managers (id, agency_id, profile_id, wording, approved_via, approved_by, approved_by_name)
  values (rec, o1, m, 'I authorise Max Manager to manage HN Office One''s RealComply account as office manager.',
          'team', l, 'Lee Licensee');
  k := 'om-approved:' || rec::text;

  -- 1. The office manager's first view is recorded, not yet "Got it".
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.note_home_notice(k, false) then raise exception 'FAIL 1: not recorded'; end if;
  select first_seen_at, dismissed_at into first_seen, dismissed from public.home_notices_seen where notice_key = k;
  if first_seen is null or dismissed is not null then
    raise exception 'FAIL 1b: first view recorded as % / %', first_seen, dismissed;
  end if;

  -- 2. "Got it" is recorded; a later view keeps both times.
  perform public.note_home_notice(k, true);
  select dismissed_at into dismissed from public.home_notices_seen where notice_key = k;
  if dismissed is null then raise exception 'FAIL 2: "Got it" not recorded'; end if;
  perform public.note_home_notice(k, false);
  perform public.note_home_notice(k, true);
  select count(*) into n from public.home_notices_seen
   where notice_key = k and first_seen_at = first_seen and dismissed_at = dismissed;
  if n <> 1 then raise exception 'FAIL 2b: a later call changed the first view or the "Got it" time'; end if;

  -- 3. Never written directly.
  begin
    insert into public.home_notices_seen (profile_id, notice_key) values (m, 'om-withdrawn:' || rec::text);
    raise exception 'FAIL 3: wrote the record directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.home_notices_seen set dismissed_at = null where profile_id = m;
    raise exception 'FAIL 3b: changed the record directly';
  exception when insufficient_privilege then null;
  end;

  -- 4. Per person: the licensee's view is their own record, and neither
  --    reads the other's.
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.home_notices_seen;
  if n <> 0 then raise exception 'FAIL 4: the licensee read the office manager''s record'; end if;
  perform public.note_home_notice(k, false);
  select count(*) into n from public.home_notices_seen where profile_id = l and dismissed_at is null;
  if n <> 1 then raise exception 'FAIL 4b: the licensee''s first view not recorded'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.home_notices_seen;
  if n <> 1 then raise exception 'FAIL 4c: the office manager sees % records, not their one', n; end if;

  -- 5. Only a record in their own office, and only a known card.
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.note_home_notice(k, false);
    raise exception 'FAIL 5: noted a card about another office';
  exception when raise_exception then
    if sqlerrm <> 'Unknown card.' then raise; end if;
  end;
  begin
    perform public.note_home_notice('anything:' || rec::text, false);
    raise exception 'FAIL 5b: noted an unknown card';
  exception when raise_exception then
    if sqlerrm <> 'Unknown card.' then raise; end if;
  end;

  -- 6. Not without signing in.
  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform public.note_home_notice(k, false);
    raise exception 'FAIL 6: noted without signing in';
  exception when insufficient_privilege then null;
  end;
  begin
    select count(*) into n from public.home_notices_seen;
    raise exception 'FAIL 6b: read the records without signing in';
  exception when insufficient_privilege then null;
  end;
  reset role;

  raise notice 'Home notices: all checks passed';
end
$$;

rollback;
