-- ===== READ ONLY. Each listing's council area, 9 November 2026 =====
--
-- Proves supabase/migrations/0118_council_area.sql. Run after it. Safe on the
-- live database: everything happens inside one transaction that is rolled
-- back at the end, so the made-up offices, people and listings it creates
-- never exist outside it.
--
-- Pass: the last line says "Council area: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1  uuid := gen_random_uuid();  -- the office
  o2  uuid := gen_random_uuid();  -- another office
  a   uuid := gen_random_uuid();  -- o1's agent, whose listing p1 is
  b   uuid := gen_random_uuid();  -- o1's second agent
  x   uuid := gen_random_uuid();  -- an agent in o2
  p1  uuid;
  p2  uuid;
  n   integer;
  r   record;
  first_at timestamptz;
begin
  insert into auth.users (id, email) values
    (a, 'ca-a@example.invalid'), (b, 'ca-b@example.invalid'), (x, 'ca-x@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'CA Office One (made up)', 'office_1', 'active', 'Lou Licensee', 'ca-lou@example.invalid'),
    (o2, 'CA Office Two (made up)', 'office_1', 'active', 'Other Licensee', 'ca-other@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (a, o1, 'Ana Agent', 'ca-a@example.invalid', true, false, false),
    (b, o1, 'Ben Agent', 'ca-b@example.invalid', true, true, false),
    (x, o2, 'Xan Agent', 'ca-x@example.invalid', true, false, false);
  insert into public.properties (agency_id, created_by, address) values (o1, a, '12 Harbour Street (made up)') returning id into p1;

  -- 1. A new listing has none, and nothing about it.
  select * into r from public.properties where id = p1;
  if r.council_area is not null or r.council_area_from is not null or r.council_area_set_by is not null
     or r.council_area_set_at is not null then
    raise exception 'FAIL 1: a new listing has %', row_to_json(r); end if;

  -- 2. Read off the planning certificate as the agent: who and when stamped.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.properties set council_area = 'Hornsby', council_area_from = 'planning_certificate' where id = p1;
  reset role;
  select * into r from public.properties where id = p1;
  if r.council_area <> 'Hornsby' or r.council_area_from <> 'planning_certificate' or r.council_area_set_by <> a
     or r.council_area_set_at is null then
    raise exception 'FAIL 2: after the read the listing has %', row_to_json(r); end if;
  first_at := r.council_area_set_at;

  -- 3. Changing something else on the listing leaves them as they were, and
  --    so does sending a different who or when.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.properties set listing_url = 'example.invalid/listing/12' where id = p1;
  update public.properties set council_area_set_by = b, council_area_set_at = now() - interval '9 days' where id = p1;
  reset role;
  select * into r from public.properties where id = p1;
  if r.council_area_set_by <> a or r.council_area_set_at <> first_at then
    raise exception 'FAIL 3: who or when changed without the council area changing: %', row_to_json(r); end if;

  -- 4. Chosen by someone else in the office: stamped with them.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.properties set council_area = 'Ku-ring-gai', council_area_from = 'agent' where id = p1;
  reset role;
  select * into r from public.properties where id = p1;
  if r.council_area <> 'Ku-ring-gai' or r.council_area_from <> 'agent' or r.council_area_set_by <> b then
    raise exception 'FAIL 4: after the change the listing has %', row_to_json(r); end if;

  -- 5. A council area with no source, a source with no council area, a
  --    source that isn't one of the two, and a blank name are all refused.
  begin
    update public.properties set council_area_from = null where id = p1;
    raise exception 'FAIL 5a: a council area was kept with no source';
  exception when check_violation then null;
  end;
  begin
    update public.properties set council_area = null where id = p1;
    raise exception 'FAIL 5b: a source was kept with no council area';
  exception when check_violation then null;
  end;
  begin
    update public.properties set council_area_from = 'guess' where id = p1;
    raise exception 'FAIL 5c: a source of "guess" was taken';
  exception when check_violation then null;
  end;
  begin
    update public.properties set council_area = '   ' where id = p1;
    raise exception 'FAIL 5d: a blank council area was taken';
  exception when check_violation then null;
  end;

  -- 6. Cleared: who and when go with it.
  update public.properties set council_area = null, council_area_from = null where id = p1;
  select * into r from public.properties where id = p1;
  if r.council_area_set_by is not null or r.council_area_set_at is not null then
    raise exception 'FAIL 6: clearing it left %', row_to_json(r); end if;

  -- 7. A listing created with one is stamped too. (Added as the app's
  --    server would, so the made-up office needs no annexure first.)
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'service_role')::text, true);
  insert into public.properties (agency_id, created_by, address, council_area, council_area_from)
  values (o1, a, '3 Hill Road (made up)', 'Uralla', 'agent') returning id into p2;
  select * into r from public.properties where id = p2;
  if r.council_area_set_by <> a or r.council_area_set_at is null then
    raise exception 'FAIL 7: a new listing with a council area has %', row_to_json(r); end if;

  -- 8. Another office can't change it.
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.properties set council_area = 'Sydney', council_area_from = 'agent' where id = p2;
  get diagnostics n = row_count;
  reset role;
  if n <> 0 or (select council_area from public.properties where id = p2) <> 'Uralla' then
    raise exception 'FAIL 8: another office changed the council area'; end if;

  raise notice 'Council area: all checks passed';
end $$;

rollback;
