-- ===== READ ONLY. Edit a comparable's details, 10 November 2026 =====
--
-- Proves supabase/migrations/0123_comparable_detail_changes.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up offices, people and sales it
-- creates never exist outside it.
--
-- Pass: the last line says "Comparable detail changes: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1  uuid := gen_random_uuid();  -- the office
  o2  uuid := gen_random_uuid();  -- another office
  lic uuid := gen_random_uuid();  -- o1's licensee in charge
  ag  uuid := gen_random_uuid();  -- o1's agent, whose listing it is
  oli uuid := gen_random_uuid();  -- o2's licensee in charge
  p1  uuid;
  c1  uuid;  -- a sale from the report
  c2  uuid;  -- a sale the agent added
  n   integer;
  m   integer;
  r   record;
begin
  insert into auth.users (id, email) values
    (lic, 'cc-lic@example.invalid'), (ag, 'cc-ag@example.invalid'), (oli, 'cc-oli@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'Comparable Changes Office (made up)', 'office_1', 'active', 'Lou Licensee', 'cc-lou@example.invalid'),
    (o2, 'Other Comparable Office (made up)', 'office_1', 'active', 'Oli Licensee', 'cc-oli2@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (lic, o1, 'Lou Licensee', 'cc-lic@example.invalid', true, true, false),
    (ag, o1, 'Ana Agent', 'cc-ag@example.invalid', true, false, false),
    (oli, o2, 'Oli Licensee', 'cc-oli@example.invalid', true, true, false);
  insert into public.properties (agency_id, created_by, address, property_type, is_strata)
    values (o1, ag, '4/12 Made Up Road, Sampleton', 'Unit', true) returning id into p1;
  insert into public.property_comparables
    (agency_id, property_id, address, sale_price, sale_date, bedrooms, bathrooms, car_spaces, land_size_sqm, internal_area_sqm, source, position)
    values (o1, p1, '1/40 Sample Street (made up)', 700000, date '2026-09-10', 3, 1, 1, 650, null, 'report', 1)
    returning id into c1;
  insert into public.property_comparables (agency_id, property_id, address, sale_price, bedrooms, source, position)
    values (o1, p1, '9 Agent Added Street (made up)', 690000, 2, 'agent', 900)
    returning id into c2;

  -- 1. The agent changes the land size read from the report: one row, with
  --    the figure as read, the new one, who, and that it was the report's.
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.property_comparables set land_size_sqm = 210 where id = c1;
  reset role;
  select count(*) into n from public.property_comparable_changes where comparable_id = c1;
  if n <> 1 then raise exception 'FAIL 1a: % rows for one change', n; end if;
  select * into r from public.property_comparable_changes where comparable_id = c1;
  if r.field <> 'land_size_sqm' or r.old_value::numeric <> 650 or r.new_value::numeric <> 210
     or not r.was_from_report or r.changed_by <> ag or r.changed_by_name <> 'Ana Agent'
     or r.agency_id <> o1 or r.property_id <> p1 then
    raise exception 'FAIL 1b: recorded as %', row_to_json(r); end if;

  -- 2. Changed again: no longer the report's figure.
  set local role authenticated;
  update public.property_comparables set land_size_sqm = 205 where id = c1;
  reset role;
  select * into r from public.property_comparable_changes where comparable_id = c1 and new_value::numeric = 205;
  if r.old_value::numeric <> 210 or r.was_from_report then
    raise exception 'FAIL 2: second change recorded as %', row_to_json(r); end if;

  -- 3. Several figures in one save: a row each, at the same moment. An empty
  --    figure filled in, and a figure emptied, are both changes.
  set local role authenticated;
  update public.property_comparables
     set bedrooms = 2, sale_price = 705000, sale_date = date '2026-09-12', internal_area_sqm = 85, car_spaces = null
   where id = c1;
  reset role;
  select count(*), count(distinct changed_at) into n, m from (
    select changed_at from public.property_comparable_changes
     where comparable_id = c1 and field in ('bedrooms', 'sale_price', 'sale_date', 'internal_area_sqm', 'car_spaces')) x;
  if n <> 5 or m <> 1 then raise exception 'FAIL 3a: % rows at % moments for five figures in one save', n, m; end if;
  select * into r from public.property_comparable_changes where comparable_id = c1 and field = 'internal_area_sqm';
  if r.old_value is not null or r.new_value::numeric <> 85 or not r.was_from_report then
    raise exception 'FAIL 3b: an empty figure filled in recorded as %', row_to_json(r); end if;
  select * into r from public.property_comparable_changes where comparable_id = c1 and field = 'car_spaces';
  if r.old_value <> '1' or r.new_value is not null then
    raise exception 'FAIL 3c: a figure emptied recorded as %', row_to_json(r); end if;
  select * into r from public.property_comparable_changes where comparable_id = c1 and field = 'sale_date';
  if r.old_value <> '2026-09-10' or r.new_value <> '2026-09-12' then
    raise exception 'FAIL 3d: the sale date recorded as %', row_to_json(r); end if;

  -- 4. The same figure saved again, the mark, or the note: nothing recorded.
  set local role authenticated;
  update public.property_comparables set bedrooms = 2, weighting = 'relied', agent_note = 'Same building.' where id = c1;
  reset role;
  select count(*) into n from public.property_comparable_changes where comparable_id = c1;
  if n <> 7 then raise exception 'FAIL 4: % rows after saving nothing new (7 expected)', n; end if;

  -- 5. A sale the agent added: their own figure, never "read from report".
  set local role authenticated;
  update public.property_comparables set bedrooms = 3 where id = c2;
  reset role;
  select * into r from public.property_comparable_changes where comparable_id = c2;
  if r.was_from_report or r.old_value <> '2' or r.new_value <> '3' then
    raise exception 'FAIL 5: an added sale''s change recorded as %', row_to_json(r); end if;

  -- 6. Signed in, nobody writes a change directly, changes one or deletes one.
  set local role authenticated;
  begin
    insert into public.property_comparable_changes
      (agency_id, property_id, comparable_id, field, old_value, new_value, was_from_report, changed_by_name)
      values (o1, p1, c1, 'bedrooms', '9', '1', true, 'Someone');
    raise exception 'FAIL 6a: a change was written directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.property_comparable_changes set new_value = '999' where comparable_id = c1;
    raise exception 'FAIL 6b: a change was rewritten';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.property_comparable_changes where comparable_id = c1;
    raise exception 'FAIL 6c: a change was deleted';
  exception when insufficient_privilege then null;
  end;

  -- 7. Whoever sees the listing sees its changes: the agent and the licensee.
  select count(*) into n from public.property_comparable_changes where property_id = p1;
  reset role;
  if n <> 8 then raise exception 'FAIL 7a: the agent sees % of 8', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.property_comparable_changes where property_id = p1;
  reset role;
  if n <> 8 then raise exception 'FAIL 7b: the licensee sees % of 8', n; end if;

  -- 8. Another office sees none of them, and signed out nobody does.
  perform set_config('request.jwt.claims', json_build_object('sub', oli, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.property_comparable_changes;
  reset role;
  if n <> 0 then raise exception 'FAIL 8a: another office sees %', n; end if;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    select count(*) into n from public.property_comparable_changes;
    raise exception 'FAIL 8b: signed out read %', n;
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 9. A change made with the app's service key is recorded too, by name.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  update public.property_comparables set bathrooms = 2 where id = c1;
  select * into r from public.property_comparable_changes where comparable_id = c1 and field = 'bathrooms';
  if r.changed_by is not null or r.changed_by_name <> 'RealComply' or not r.was_from_report then
    raise exception 'FAIL 9: a service change recorded as %', row_to_json(r); end if;

  -- 10. The licensee removes the sale: its changes go with it, and the
  --     removal is logged as before.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.property_comparables where id = c1;
  reset role;
  select count(*) into n from public.property_comparable_changes where comparable_id = c1;
  if n <> 0 then raise exception 'FAIL 10a: % changes left behind', n; end if;
  select count(*) into n from public.property_comparable_changes where comparable_id = c2;
  if n <> 1 then raise exception 'FAIL 10b: the other sale''s change went too'; end if;

  raise notice 'Comparable detail changes: all checks passed';
end
$$;

rollback;
