-- ===== READ ONLY. The 3 most comparable sales, 9 November 2026 =====
--
-- Proves supabase/migrations/0119_comparables_most_comparable.sql. Run after
-- it. Safe on the live database: everything happens inside one transaction
-- that is rolled back at the end, so the made-up office, people, listing and
-- sales it creates never exist outside it.
--
-- Pass: the last line says "Most comparable: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1  uuid := gen_random_uuid();  -- the office
  a   uuid := gen_random_uuid();  -- its agent
  p1  uuid;
  s   uuid[] := array[]::uuid[];
  id1 uuid;
  n   integer;
  r   record;
begin
  insert into auth.users (id, email) values (a, 'mc-a@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'MC Office (made up)', 'office_1', 'active', 'Lou Licensee', 'mc-lou@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (a, o1, 'Ana Agent', 'mc-a@example.invalid', true, false, false);
  insert into public.properties (agency_id, created_by, address) values (o1, a, '12 Harbour Street (made up)') returning id into p1;
  for i in 1..5 loop
    insert into public.property_comparables (agency_id, property_id, address, sale_price, sale_date, distance_m, source, weighting, position)
    values (o1, p1, i || ' Sample Street (made up)', 1000000 + i * 10000, date '2026-10-01' - i * 10, 400 * i, 'report', 'relied', i)
    returning id into id1;
    s := s || id1;
  end loop;
  update public.property_comparables set weighting = 'considered' where id = s[5];

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. A sale relied on, with a reason and the factors weighed.
  update public.property_comparables
     set most_comparable = true, most_comparable_reason = 'Same street, same layout, sold last month.',
         comparison_factors = array['date_sold', 'location', 'layout']
   where id = s[1];
  select * into r from public.property_comparables where id = s[1];
  if not r.most_comparable or r.comparison_factors <> array['date_sold', 'location', 'layout'] then
    raise exception 'FAIL 1: the mark was kept as %', row_to_json(r); end if;

  -- 2. No reason, a blank reason, a sale only considered, a factor that
  --    isn't one of the Regulation's: each refused.
  begin
    update public.property_comparables set most_comparable = true where id = s[2];
    raise exception 'FAIL 2a: marked with no reason';
  exception when check_violation then null;
  end;
  begin
    update public.property_comparables set most_comparable = true, most_comparable_reason = '   ' where id = s[2];
    raise exception 'FAIL 2b: marked with a blank reason';
  exception when check_violation then null;
  end;
  begin
    update public.property_comparables set most_comparable = true, most_comparable_reason = 'Close by.' where id = s[5];
    raise exception 'FAIL 2c: a sale only considered was marked';
  exception when check_violation then null;
  end;
  begin
    update public.property_comparables set comparison_factors = array['vibes'] where id = s[2];
    raise exception 'FAIL 2d: a made-up factor was taken';
  exception when check_violation then null;
  end;

  -- 3. Three, and not a fourth.
  update public.property_comparables set most_comparable = true, most_comparable_reason = 'Close by.' where id = s[2];
  update public.property_comparables set most_comparable = true, most_comparable_reason = 'Same layout.' where id = s[3];
  begin
    update public.property_comparables set most_comparable = true, most_comparable_reason = 'Also close.' where id = s[4];
    raise exception 'FAIL 3: a fourth was marked';
  exception when check_violation then
    if sqlerrm not like 'Only 3 sales can be marked as the most comparable.%' then
      raise exception 'FAIL 3b: refused with %', sqlerrm; end if;
  end;
  select count(*) into n from public.property_comparables where property_id = p1 and most_comparable;
  if n <> 3 then raise exception 'FAIL 3c: % marked', n; end if;

  -- 4. Take one off, and another can be marked.
  update public.property_comparables set most_comparable = false, most_comparable_reason = null, comparison_factors = '{}' where id = s[3];
  update public.property_comparables set most_comparable = true, most_comparable_reason = 'Also close.' where id = s[4];
  select count(*) into n from public.property_comparables where property_id = p1 and most_comparable;
  if n <> 3 then raise exception 'FAIL 4: % marked after the swap', n; end if;

  -- 5. A marked sale can't be moved to "Considered" without the mark coming off.
  begin
    update public.property_comparables set weighting = 'considered' where id = s[1];
    raise exception 'FAIL 5: a marked sale became "Considered"';
  exception when check_violation then null;
  end;

  -- 6. A sale added already marked as a fourth is refused too.
  begin
    insert into public.property_comparables (agency_id, property_id, address, source, weighting, most_comparable, most_comparable_reason)
    values (o1, p1, '9 Added Lane (made up)', 'agent', 'relied', true, 'Sold next door.');
    raise exception 'FAIL 6: a fourth was added';
  exception when check_violation then null;
  end;
  reset role;

  raise notice 'Most comparable: all checks passed';
end $$;

rollback;
