-- ===== READ ONLY. CPD with more than one category of practice test, 14 October 2026 =====
--
-- Proves supabase/migrations/0073_cpd_categories.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up office and people it creates
-- never exist outside it.
--
-- Pass: the last line says "CPD categories: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  ag uuid := gen_random_uuid();      -- an office
  lic uuid := gen_random_uuid();     -- its licensee in charge
  agt uuid := gen_random_uuid();     -- an agent
  agt2 uuid := gen_random_uuid();    -- another agent
  asst uuid := gen_random_uuid();    -- an assistant agent
  rec uuid;
  n integer;
  cats text[];
  st text;
begin
  -- 1. Everyone's single category moved across (live data, read only).
  select count(*) into n from public.profiles
   where cpd_practice_category is not null and not (cpd_practice_category = any (cpd_categories));
  if n <> 0 then raise exception 'FAIL 1: % people still have a category that did not move across', n; end if;

  insert into auth.users (id, email) values
    (lic, 'cpdc-lic@example.invalid'), (agt, 'cpdc-a@example.invalid'),
    (agt2, 'cpdc-b@example.invalid'), (asst, 'cpdc-asst@example.invalid');
  insert into public.agencies (id, name, plan, status) values (ag, 'CPDC Property (made up)', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent, licence_type) values
    (lic, ag, 'CPDC Licensee', 'cpdc-lic@example.invalid', true, false, true, 'class_1'),
    (agt, ag, 'CPDC Agent', 'cpdc-a@example.invalid', false, false, true, 'class_1'),
    (agt2, ag, 'CPDC Agent Two', 'cpdc-b@example.invalid', false, false, true, 'class_2'),
    (asst, ag, 'CPDC Assistant', 'cpdc-asst@example.invalid', false, true, false, 'certificate_of_registration');

  -- 2. New people start with no categories, not livestock only, no start date.
  select cpd_categories into cats from public.profiles where id = agt;
  if cats <> '{}' then raise exception 'FAIL 2: a new person has categories'; end if;

  -- 3. A person ticks their own: residential sales, business broking, stock and station.
  perform set_config('request.jwt.claims', json_build_object('sub', agt, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profiles
     set cpd_categories = array['residential_sales', 'business_broking', 'stock_and_station'],
         licence_started_on = date '2027-04-01'
   where id = agt;
  reset role;
  select cpd_categories into cats from public.profiles where id = agt;
  if cats <> array['residential_sales', 'business_broking', 'stock_and_station'] then
    raise exception 'FAIL 3: own categories not saved (%)', cats;
  end if;

  -- 4. Anything that isn't a category is refused.
  begin
    set local role authenticated;
    update public.profiles set cpd_categories = array['residential_sales', 'astrology'] where id = agt;
    reset role;
    raise exception 'FAIL 4: a made-up category was saved';
  exception when check_violation then
    reset role;
  end;

  -- 5. An agent can't change a colleague's categories (nothing changes).
  set local role authenticated;
  update public.profiles set cpd_categories = array['strata'] where id = agt2;
  reset role;
  select cpd_categories into cats from public.profiles where id = agt2;
  if cats <> '{}' then raise exception 'FAIL 5: an agent changed a colleague''s categories'; end if;

  -- 6. The licensee in charge can, and can mark an assistant livestock only.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profiles set cpd_categories = array['residential_property_management'] where id = agt2;
  update public.profiles set cpd_categories = array['stock_and_station'], cpd_livestock_only = true where id = asst;
  reset role;
  select cpd_categories into cats from public.profiles where id = agt2;
  if cats <> array['residential_property_management'] then raise exception 'FAIL 6: the licensee could not set them'; end if;
  if not (select cpd_livestock_only from public.profiles where id = asst) then
    raise exception 'FAIL 6b: livestock only not saved';
  end if;

  -- 7. A certificate records the topics it covers, and an untick for one category.
  insert into public.cpd_records (agency_id, profile_id, activity_name, hours, completed_date, provider, topics)
    values (ag, agt, 'Supervision Guidelines and AML CTF in agency practice', 2, date '2026-09-01', 'Made-up Training', array['supervision_aml'])
    returning id into rec;
  perform set_config('request.jwt.claims', json_build_object('sub', agt, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.cpd_records
     set topics_not_covered = array['supervision_aml:business_broking'], topics_changed_by = agt, topics_changed_at = now()
   where id = rec;
  reset role;
  select array_to_string(topics_not_covered, ',') into st from public.cpd_records where id = rec;
  if st <> 'supervision_aml:business_broking' then raise exception 'FAIL 7: the untick was not saved'; end if;

  -- 8. Badly formed topic keys are refused.
  begin
    update public.cpd_records set topics = array['Auction Laws!'] where id = rec;
    raise exception 'FAIL 8: a badly formed topic was saved';
  exception when check_violation then null;
  end;
  begin
    update public.cpd_records set topics_not_covered = array['supervision_aml'] where id = rec;
    raise exception 'FAIL 8b: an untick without a category was saved';
  exception when check_violation then null;
  end;

  -- 9. Another agent can't untick someone else's certificate (nothing changes).
  perform set_config('request.jwt.claims', json_build_object('sub', agt2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.cpd_records set topics_not_covered = '{}' where id = rec;
  reset role;
  select array_to_string(topics_not_covered, ',') into st from public.cpd_records where id = rec;
  if st <> 'supervision_aml:business_broking' then raise exception 'FAIL 9: a colleague changed the ticks'; end if;

  -- 10. The licensee can put the tick back.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.cpd_records set topics_not_covered = '{}', topics_changed_by = lic, topics_changed_at = now() where id = rec;
  reset role;
  if (select cardinality(topics_not_covered) from public.cpd_records where id = rec) <> 0 then
    raise exception 'FAIL 10: the licensee could not put the tick back';
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'CPD categories: all checks passed';
end $$;

select 'CPD categories: all checks passed' as result;

rollback;
