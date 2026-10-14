-- ===== READ ONLY. More than one type of licence test, 14 October 2026 =====
--
-- Proves supabase/migrations/0073_cpd_categories.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up office and people it creates
-- never exist outside it.
--
-- Pass: the last line says "Licence types: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  ag uuid := gen_random_uuid();      -- an office
  lic uuid := gen_random_uuid();     -- its licensee in charge
  agt uuid := gen_random_uuid();     -- an agent
  agt2 uuid := gen_random_uuid();    -- another agent
  n integer;
  cats text[];
begin
  -- 1. Everyone's single category moved across (live data, read only).
  select count(*) into n from public.profiles
   where cpd_practice_category is not null and not (cpd_practice_category = any (licence_categories));
  if n <> 0 then raise exception 'FAIL 1: % people still have a category that did not move across', n; end if;

  insert into auth.users (id, email) values
    (lic, 'lt-lic@example.invalid'), (agt, 'lt-a@example.invalid'), (agt2, 'lt-b@example.invalid');
  insert into public.agencies (id, name, plan, status) values (ag, 'LT Property (made up)', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent, licence_type) values
    (lic, ag, 'LT Licensee', 'lt-lic@example.invalid', true, false, true, 'class_1'),
    (agt, ag, 'LT Agent', 'lt-a@example.invalid', false, false, true, 'class_1'),
    (agt2, ag, 'LT Agent Two', 'lt-b@example.invalid', false, false, true, 'class_2');

  -- 2. New people start with none ticked.
  select licence_categories into cats from public.profiles where id = agt;
  if cats <> '{}' then raise exception 'FAIL 2: a new person has licence types ticked'; end if;

  -- 3. A person ticks their own: residential sales, business broking, stock and station.
  perform set_config('request.jwt.claims', json_build_object('sub', agt, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profiles
     set licence_categories = array['residential_sales', 'business_broking', 'stock_and_station']
   where id = agt;
  reset role;
  select licence_categories into cats from public.profiles where id = agt;
  if cats <> array['residential_sales', 'business_broking', 'stock_and_station'] then
    raise exception 'FAIL 3: own licence types not saved (%)', cats;
  end if;

  -- 4. Anything that isn't a licence type is refused.
  begin
    set local role authenticated;
    update public.profiles set licence_categories = array['residential_sales', 'astrology'] where id = agt;
    reset role;
    raise exception 'FAIL 4: a made-up licence type was saved';
  exception when check_violation then
    reset role;
  end;

  -- 5. An agent can't change a colleague's (nothing changes).
  set local role authenticated;
  update public.profiles set licence_categories = array['strata'] where id = agt2;
  reset role;
  select licence_categories into cats from public.profiles where id = agt2;
  if cats <> '{}' then raise exception 'FAIL 5: an agent changed a colleague''s licence types'; end if;

  -- 6. The licensee in charge can.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profiles set licence_categories = array['residential_property_management'] where id = agt2;
  reset role;
  select licence_categories into cats from public.profiles where id = agt2;
  if cats <> array['residential_property_management'] then raise exception 'FAIL 6: the licensee could not set them'; end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'Licence types: all checks passed';
end $$;

select 'Licence types: all checks passed' as result;

rollback;
