-- ===== READ ONLY. PM follows the plan, 21 October 2026 =====
--
-- Proves migration 0086: property management is on for office plans, never
-- on for single agent plans, can't be switched on by hand, and is enforced by
-- the database itself, not just the app. An office that moves to a single
-- agent plan loses PM from view with nothing deleted; back on an office plan,
-- its PM records are all there. Run it after 0086. It is safe on the live
-- database: everything happens inside one transaction that is rolled back at
-- the end, so the made-up offices, people and properties never exist outside
-- it.
--
-- Pass: the last line says "PM follows the plan: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  office uuid := gen_random_uuid();
  agent_office uuid := gen_random_uuid();
  o_user uuid := gen_random_uuid();
  a_user uuid := gen_random_uuid();
  prop uuid;
  ten uuid;
  n integer;
  on_ boolean;
  blocked boolean;
begin
  -- 1. A new office starts on office_1 (the column's default, as at sign-up): PM on.
  insert into public.agencies (id, name, status) values (office, 'PM plan test office (made up)', 'active');
  select pm_enabled into on_ from public.agencies where id = office;
  if on_ is not true then raise exception 'FAIL 1: a new office sign-up has PM off'; end if;

  -- 2. A new office on a single agent plan, as the Stripe webhook sets it: PM off.
  insert into public.agencies (id, name, status) values (agent_office, 'PM plan test agent (made up)', 'active');
  update public.agencies set plan = 'agent_1' where id = agent_office;
  select pm_enabled into on_ from public.agencies where id = agent_office;
  if on_ is not false then raise exception 'FAIL 2: a single agent plan has PM on'; end if;
  -- Office to agent and back, as the webhook would on a plan change.
  update public.agencies set plan = 'office_2' where id = agent_office;
  update public.agencies set plan = 'agent_3' where id = agent_office;
  select pm_enabled into on_ from public.agencies where id = agent_office;
  if on_ is not false then raise exception 'FAIL 2: agent_3 has PM on'; end if;

  insert into auth.users (id, email) values
    (o_user, 'pm-plan-office@example.invalid'),
    (a_user, 'pm-plan-agent@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge) values
    (o_user, office, 'Office Licensee (made up)', 'pm-plan-office@example.invalid', true, true),
    (a_user, agent_office, 'Single Agent (made up)', 'pm-plan-agent@example.invalid', true, true);

  -- A made-up managed property in the office, with a tenancy and a tick.
  insert into public.pm_properties (agency_id, address, manager_id, origin, grp, created_by)
    values (office, '1 Plan Street, Testville NSW 2999 (made up)', o_user, 'new', 'for_lease', o_user)
    returning id into prop;
  insert into public.pm_tenancies (agency_id, property_id) values (office, prop) returning id into ten;
  insert into public.pm_item_states (agency_id, property_id, tenancy_id, item_key, state, changed_by)
    values (office, prop, ten, 'fixed_rent', 'done', o_user);

  -- 3. The single agent, signed in, through the role the app uses.
  perform set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 3a. Can't switch PM on for their own office by a direct call.
  update public.agencies set pm_enabled = true where id = agent_office;
  select pm_enabled into on_ from public.agencies where id = agent_office;
  if on_ is not false then raise exception 'FAIL 3a: a single agent switched PM on by a direct call'; end if;

  -- 3b. Can't add a managed property by a direct call.
  blocked := false;
  begin
    insert into public.pm_properties (agency_id, address, manager_id, origin, grp, created_by)
      values (agent_office, '2 Plan Street', a_user, 'new', 'onboarding', a_user);
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 3b: a single agent added a managed property'; end if;

  -- 3c. Can't name a records system.
  blocked := false;
  begin
    perform public.set_agency_pm_records_system('Made-up system');
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 3c: a single agent named a PM records system'; end if;

  -- 3d. Can't change their own plan (the billing guard, unchanged).
  blocked := false;
  begin
    update public.agencies set plan = 'office_1' where id = agent_office;
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 3d: a single agent changed their own plan'; end if;

  reset role;

  -- 4. The office licensee sees the property and its tick.
  perform set_config('request.jwt.claims', json_build_object('sub', o_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.pm_properties where id = prop;
  if n <> 1 then raise exception 'FAIL 4: the office cannot see its own managed property'; end if;
  reset role;

  -- 5. The office moves to a single agent plan: PM is hidden, nothing is deleted.
  -- Plan changes come from the Stripe webhook (the service key): no one signed in.
  perform set_config('request.jwt.claims', '', true);
  update public.agencies set plan = 'agent_2' where id = office;
  perform set_config('request.jwt.claims', json_build_object('sub', o_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select pm_enabled into on_ from public.agencies where id = office;
  if on_ is not false then raise exception 'FAIL 5: PM still on after the move to a single agent plan'; end if;
  select count(*) into n from public.pm_properties;
  if n <> 0 then raise exception 'FAIL 5: % managed properties still visible on a single agent plan', n; end if;
  select count(*) into n from public.pm_tenancies;
  if n <> 0 then raise exception 'FAIL 5: tenancies still visible on a single agent plan'; end if;
  select count(*) into n from public.pm_item_states;
  if n <> 0 then raise exception 'FAIL 5: ticks still visible on a single agent plan'; end if;
  select count(*) into n from public.pm_item_events;
  if n <> 0 then raise exception 'FAIL 5: tick history still visible on a single agent plan'; end if;
  -- A change it can't see is a change that doesn't happen.
  update public.pm_properties set address = 'Changed' where id = prop;
  reset role;
  select count(*) into n from public.pm_properties where id = prop and address = '1 Plan Street, Testville NSW 2999 (made up)';
  if n <> 1 then raise exception 'FAIL 5: the hidden property was changed or deleted'; end if;
  select count(*) into n from public.pm_item_states where property_id = prop;
  if n <> 1 then raise exception 'FAIL 5: the hidden tick was deleted'; end if;

  -- 6. Back on an office plan: PM and every record come back.
  perform set_config('request.jwt.claims', '', true);
  update public.agencies set plan = 'office_3' where id = office;
  perform set_config('request.jwt.claims', json_build_object('sub', o_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select pm_enabled into on_ from public.agencies where id = office;
  if on_ is not true then raise exception 'FAIL 6: PM still off back on an office plan'; end if;
  select count(*) into n from public.pm_properties where id = prop;
  if n <> 1 then raise exception 'FAIL 6: the managed property did not come back'; end if;
  select count(*) into n from public.pm_tenancies where property_id = prop;
  if n <> 1 then raise exception 'FAIL 6: the tenancy did not come back'; end if;
  select count(*) into n from public.pm_item_states where property_id = prop;
  if n <> 1 then raise exception 'FAIL 6: the tick did not come back'; end if;
  reset role;

  -- 7. The switch can't be turned off by hand on an office plan either.
  perform set_config('request.jwt.claims', '', true);
  update public.agencies set pm_enabled = false where id = office;
  select pm_enabled into on_ from public.agencies where id = office;
  if on_ is not true then raise exception 'FAIL 7: PM switched off by hand on an office plan'; end if;

  raise notice 'PM follows the plan: all checks passed';
end
$$;

rollback;

select 'PM follows the plan: all checks passed' as result;
