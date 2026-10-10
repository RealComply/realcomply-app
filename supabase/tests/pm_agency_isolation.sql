-- ===== READ ONLY. PM agency isolation test, 6 October 2026 =====
--
-- Proves one agency can never see or change another agency's PM records
-- (migration 0052). Run it after 0052. It is safe on the live database:
-- everything happens inside one transaction that is rolled back at the end,
-- so the two test agencies, people and properties it makes never exist
-- outside it.
--
-- Pass: the last line says "PM isolation: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  a_agency uuid := gen_random_uuid();
  b_agency uuid := gen_random_uuid();
  a_user uuid := gen_random_uuid();
  b_user uuid := gen_random_uuid();
  gone_user uuid := gen_random_uuid();
  a_prop uuid;
  b_prop uuid;
  b_ten uuid;
  n integer;
  blocked boolean;
begin
  -- Two made-up agencies, one person each, plus an archived person in A.
  insert into auth.users (id, email) values
    (a_user, 'pm-test-a@example.invalid'),
    (b_user, 'pm-test-b@example.invalid'),
    (gone_user, 'pm-test-gone@example.invalid');
  insert into public.agencies (id, name, status) values
    (a_agency, 'PM isolation test A', 'active'),
    (b_agency, 'PM isolation test B', 'active');
  insert into public.profiles (id, agency_id, full_name, email) values
    (a_user, a_agency, 'Test A', 'pm-test-a@example.invalid'),
    (b_user, b_agency, 'Test B', 'pm-test-b@example.invalid'),
    (gone_user, a_agency, 'Test Gone', 'pm-test-gone@example.invalid');
  update public.profiles set archived_at = now() where id = gone_user;

  -- One made-up property in each agency, with a tenancy and a tick.
  insert into public.pm_properties (agency_id, address, manager_id, origin, grp, created_by)
    values (a_agency, '1 Test Street, Nowhere NSW 2000', a_user, 'new', 'onboarding', a_user)
    returning id into a_prop;
  insert into public.pm_properties (agency_id, address, manager_id, origin, grp, created_by)
    values (b_agency, '2 Test Street, Nowhere NSW 2000', b_user, 'new', 'for_lease', b_user)
    returning id into b_prop;
  insert into public.pm_tenancies (agency_id, property_id) values (a_agency, a_prop);
  insert into public.pm_tenancies (agency_id, property_id) values (b_agency, b_prop) returning id into b_ten;
  insert into public.pm_item_states (agency_id, property_id, tenancy_id, item_key, state, changed_by)
    values (b_agency, b_prop, b_ten, 'fixed_rent', 'done', b_user);

  -- From here on, act as person A, signed in, through the same role the app uses.
  perform set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. A sees only A's property.
  select count(*) into n from public.pm_properties;
  if n <> 1 then raise exception 'FAIL 1: person A sees % properties, expected 1', n; end if;
  select count(*) into n from public.pm_properties where id = b_prop;
  if n <> 0 then raise exception 'FAIL 1: person A can see agency B''s property'; end if;

  -- 2. A sees none of B's tenancies, ticks, history or moves.
  select count(*) into n from public.pm_tenancies where property_id = b_prop;
  if n <> 0 then raise exception 'FAIL 2: person A can see agency B''s tenancy'; end if;
  select count(*) into n from public.pm_item_states where property_id = b_prop;
  if n <> 0 then raise exception 'FAIL 2: person A can see agency B''s ticks'; end if;
  select count(*) into n from public.pm_item_events where property_id = b_prop;
  if n <> 0 then raise exception 'FAIL 2: person A can see agency B''s tick history'; end if;

  -- 3. A cannot add a property to agency B.
  blocked := false;
  begin
    insert into public.pm_properties (agency_id, address, manager_id, origin, grp, created_by)
      values (b_agency, '3 Test Street', a_user, 'new', 'onboarding', a_user);
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 3: person A added a property to agency B'; end if;

  -- 4. A cannot tick on B's property, even with A's own agency id on the row.
  blocked := false;
  begin
    insert into public.pm_item_states (agency_id, property_id, tenancy_id, item_key, state, changed_by)
      values (a_agency, b_prop, b_ten, 'material_facts', 'done', a_user);
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 4: person A ticked an item on agency B''s property'; end if;

  -- 5. A cannot change or untick anything of B's (the update touches no rows).
  update public.pm_properties set grp = 'archived' where id = b_prop;
  update public.pm_item_states set state = 'open' where property_id = b_prop;

  -- 6. Nobody can write the tick history directly.
  blocked := false;
  begin
    insert into public.pm_item_events (agency_id, property_id, item_key, state, changed_by)
      values (a_agency, a_prop, 'fixed_rent', 'done', a_user);
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 6: the tick history could be written directly'; end if;

  -- 7. An archived person in A sees nothing at all.
  perform set_config('request.jwt.claims', json_build_object('sub', gone_user, 'role', 'authenticated')::text, true);
  select count(*) into n from public.pm_properties;
  if n <> 0 then raise exception 'FAIL 7: an archived person can still see % properties', n; end if;

  -- Back to the owner to check 5 did nothing.
  reset role;
  select count(*) into n from public.pm_properties where id = b_prop and grp = 'for_lease';
  if n <> 1 then raise exception 'FAIL 5: person A changed agency B''s property'; end if;
  select count(*) into n from public.pm_item_states where property_id = b_prop and state = 'done';
  if n <> 1 then raise exception 'FAIL 5: person A unticked agency B''s item'; end if;

  raise notice 'PM isolation: all checks passed';
end
$$;

select 'PM isolation: all checks passed' as result;

rollback;
