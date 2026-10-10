-- ===== READ ONLY. PM Part B agency isolation test, 6 October 2026 =====
--
-- Proves one agency can never see or change another agency's PM Part B
-- records (migration 0053), that inside one office only the property
-- manager, their assistant and the licensee can (0058), and that the file
-- reminder log is closed to everyone signed in. Run it after 0059. It is safe
-- on the live database:
-- everything happens inside one transaction that is rolled back at the end,
-- so the two test agencies, people and properties it makes never exist
-- outside it.
--
-- Pass: the last line says "PM Part B isolation: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  a_agency uuid := gen_random_uuid();
  b_agency uuid := gen_random_uuid();
  a_user uuid := gen_random_uuid();
  b_user uuid := gen_random_uuid();
  a_lic uuid := gen_random_uuid();   -- licensee in charge of office A
  a_ag2 uuid := gen_random_uuid();   -- another agent in office A
  a_pet2 uuid;
  a_prop uuid;
  b_prop uuid;
  a_ten uuid;
  b_ten uuid;
  a_pet uuid;
  a_sold uuid;
  b_pet uuid;
  n integer;
  who uuid;
  blocked boolean;
begin
  -- Two made-up agencies. A is an office with a licensee and two agents;
  -- person A manages A's property. B has one person.
  insert into auth.users (id, email) values
    (a_user, 'pm-b-test-a@example.invalid'),
    (b_user, 'pm-b-test-b@example.invalid'),
    (a_lic, 'pm-b-test-a-lic@example.invalid'),
    (a_ag2, 'pm-b-test-a-ag2@example.invalid');
  insert into public.agencies (id, name, status, plan) values
    (a_agency, 'PM Part B isolation test A', 'active', 'office_1');
  insert into public.agencies (id, name, status) values
    (b_agency, 'PM Part B isolation test B', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_agent) values
    (a_lic, a_agency, 'Test A Licensee', 'pm-b-test-a-lic@example.invalid', true, true),
    (a_user, a_agency, 'Test A', 'pm-b-test-a@example.invalid', false, true),
    (a_ag2, a_agency, 'Test A Agent Two', 'pm-b-test-a-ag2@example.invalid', false, true),
    (b_user, b_agency, 'Test B', 'pm-b-test-b@example.invalid', false, true);
  -- The licensee joined first, so they hold the account (0059).
  update public.profiles set created_at = now() + interval '1 minute' where id in (a_user, a_ag2);

  -- One made-up tenanted property in each agency, each with a pet request.
  insert into public.pm_properties (agency_id, address, manager_id, origin, grp, created_by)
    values (a_agency, '1 Test Street, Nowhere NSW 2000', a_user, 'new', 'tenanted', a_user)
    returning id into a_prop;
  insert into public.pm_properties (agency_id, address, manager_id, origin, grp, created_by)
    values (b_agency, '2 Test Street, Nowhere NSW 2000', b_user, 'new', 'tenanted', b_user)
    returning id into b_prop;
  insert into public.pm_tenancies (agency_id, property_id) values (a_agency, a_prop) returning id into a_ten;
  insert into public.pm_tenancies (agency_id, property_id) values (b_agency, b_prop) returning id into b_ten;
  insert into public.pm_records (agency_id, property_id, tenancy_id, kind, data, recorded_by)
    values (b_agency, b_prop, b_ten, 'pet_request', '{"received": "2026-10-01", "outcome": "consent"}', b_user)
    returning id into b_pet;
  insert into public.pm_records (agency_id, property_id, tenancy_id, kind, data, recorded_by)
    values (a_agency, a_prop, a_ten, 'pet_request', '{"received": "2026-10-02", "outcome": "consent"}', a_user)
    returning id into a_pet2;
  -- One reminder already sent for A's own tenancy, written as the daily job would.
  insert into public.pm_retention_reminders (agency_id, subject_kind, subject_id, due_date)
    values (a_agency, 'tenancy', a_ten, date '2029-10-07');

  -- From here on, act as person A, signed in, through the same role the app uses.
  perform set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. A sees none of B's records.
  select count(*) into n from public.pm_records where property_id = b_prop;
  if n <> 0 then raise exception 'FAIL 1: person A can see agency B''s records'; end if;

  -- 2. A cannot add a record to B's property, with either agency id on the row.
  blocked := false;
  begin
    insert into public.pm_records (agency_id, property_id, tenancy_id, kind)
      values (b_agency, b_prop, b_ten, 'property_sold');
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 2: person A added a record to agency B'; end if;
  blocked := false;
  begin
    insert into public.pm_records (agency_id, property_id, tenancy_id, kind)
      values (a_agency, b_prop, b_ten, 'property_sold');
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 2: person A added a record to agency B''s property under A''s name'; end if;

  -- 3. A cannot point a record at B's tenancy from A's own property.
  blocked := false;
  begin
    insert into public.pm_records (agency_id, property_id, tenancy_id, kind)
      values (a_agency, a_prop, b_ten, 'property_sold');
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 3: person A linked a record to agency B''s tenancy'; end if;

  -- 4. A cannot mark B's pet request as answered, or end B's tenancy or
  --    management (the updates touch no rows; checked below).
  update public.pm_records set response_given_at = now() where id = b_pet;
  update public.pm_tenancies set ended_by = 'landlord', termination_ground = 'renovation' where id = b_ten;
  update public.pm_properties set management_ended_on = current_date, management_ended_reason = 'sold'
    where id = b_prop;

  -- 5. Who and when are the server's: A cannot record a press in B's person's name.
  insert into public.pm_records (agency_id, property_id, tenancy_id, kind, recorded_by)
    values (a_agency, a_prop, a_ten, 'property_sold', b_user)
    returning id, recorded_by into a_sold, who;
  if who <> a_user then raise exception 'FAIL 5: a record was saved in someone else''s name'; end if;

  -- 6. A saved record cannot be changed, only a pet request's "Response given", once.
  blocked := false;
  begin
    update public.pm_records set kind = 'advertising_photos' where id = a_sold;
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 6: a saved record was changed'; end if;
  blocked := false;
  begin
    update public.pm_records set response_given_at = now() where id = a_sold;
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 6: "Response given" was added to a record that is not a pet request'; end if;

  insert into public.pm_records (agency_id, property_id, tenancy_id, kind, data)
    values (a_agency, a_prop, a_ten, 'pet_request', '{"received": "2026-10-01", "outcome": "consent"}')
    returning id into a_pet;
  update public.pm_records set response_given_at = now() where id = a_pet returning response_given_by into who;
  if who is distinct from a_user then raise exception 'FAIL 6: "Response given" was not stamped with the person who pressed it'; end if;
  blocked := false;
  begin
    update public.pm_records set response_given_at = now() where id = a_pet;
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 6: "Response given" was pressed twice'; end if;

  -- 7. Nobody signed in can read or write the file reminder log, not even
  --    their own agency's rows. Supabase may grant the table to signed-in
  --    users by default; row-level security with no policy is what keeps it
  --    closed, so a read sees nothing and a write is refused or changes nothing.
  n := 0;
  begin
    select count(*) into n from public.pm_retention_reminders;
  exception when insufficient_privilege then n := 0;
  end;
  if n <> 0 then raise exception 'FAIL 7: a signed-in person can read the file reminder log'; end if;
  blocked := false;
  begin
    insert into public.pm_retention_reminders (agency_id, subject_kind, subject_id, due_date)
      values (a_agency, 'tenancy', a_ten, current_date);
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 7: a signed-in person can write the file reminder log'; end if;
  -- No filter on purpose: a filtered write also needs read access, so only an
  -- unfiltered one shows a write-only leak. All of it is rolled back below.
  begin
    update public.pm_retention_reminders set due_date = current_date;
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.pm_retention_reminders;
  exception when insufficient_privilege then null;
  end;

  -- 8. Inside office A, another agent sees none of A's records, cannot add
  --    one and cannot mark a pet request answered (0058). The licensee sees them.
  perform set_config('request.jwt.claims', json_build_object('sub', a_ag2, 'role', 'authenticated')::text, true);
  select count(*) into n from public.pm_records where property_id = a_prop;
  if n <> 0 then raise exception 'FAIL 8: another agent in the office can see the property manager''s records'; end if;
  blocked := false;
  begin
    insert into public.pm_records (agency_id, property_id, tenancy_id, kind)
      values (a_agency, a_prop, a_ten, 'property_sold');
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 8: another agent in the office added a record to the property manager''s property'; end if;
  update public.pm_records set response_given_at = now() where id = a_pet2;
  -- No filter on purpose, as in check 7: a write rule without a read rule
  -- only shows on an unfiltered update. Here it reaches A's saved records,
  -- which refuse the change. All of it is rolled back below.
  blocked := false;
  begin
    update public.pm_records set response_given_at = now();
  exception when others then blocked := true;
  end;
  if blocked then raise exception 'FAIL 8: another agent in the office can reach the property manager''s records to change them'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a_lic, 'role', 'authenticated')::text, true);
  select count(*) into n from public.pm_records where property_id = a_prop;
  if n < 3 then raise exception 'FAIL 8: the licensee cannot see the office''s records'; end if;
  select count(*) into n from public.pm_records where property_id = b_prop;
  if n <> 0 then raise exception 'FAIL 8: the licensee can see another agency''s records'; end if;

  -- Back to the owner to check 4 and 8 did nothing.
  reset role;
  select count(*) into n from public.pm_records where id = b_pet and response_given_at is null;
  if n <> 1 then raise exception 'FAIL 4: person A marked agency B''s pet request as answered'; end if;
  select count(*) into n from public.pm_tenancies where id = b_ten and ended_by is null and termination_ground is null;
  if n <> 1 then raise exception 'FAIL 4: person A ended agency B''s tenancy'; end if;
  select count(*) into n from public.pm_properties where id = b_prop and management_ended_on is null;
  if n <> 1 then raise exception 'FAIL 4: person A ended agency B''s management'; end if;
  select count(*) into n from public.pm_retention_reminders where subject_id = a_ten and due_date = date '2029-10-07';
  if n <> 1 then raise exception 'FAIL 7: a signed-in person changed or removed the file reminder log'; end if;
  select count(*) into n from public.pm_records where id = a_pet2 and response_given_at is null;
  if n <> 1 then raise exception 'FAIL 8: another agent in the office marked the property manager''s pet request as answered'; end if;

  raise notice 'PM Part B isolation: all checks passed';
end
$$;

select 'PM Part B isolation: all checks passed' as result;

rollback;
