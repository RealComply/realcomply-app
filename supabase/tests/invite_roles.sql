-- ===== READ ONLY. Team invites for every role, 26 October 2026 =====
--
-- Proves supabase/migrations/0095_invite_roles.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up offices and people it creates
-- never exist outside it.
--
-- Pass: the last line says "Invite roles: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  -- Office 1: the licensee in charge isn't on RealComply; f is office manager.
  o1 uuid := gen_random_uuid();
  f  uuid := gen_random_uuid();
  a  uuid := gen_random_uuid();   -- an agent in office 1
  v  uuid := gen_random_uuid();   -- the licensee, joining by invite
  -- Office 2: the licensee in charge has a login.
  o2 uuid := gen_random_uuid();
  l  uuid := gen_random_uuid();
  b  uuid := gen_random_uuid();
  m  uuid := gen_random_uuid();   -- joins as office manager
  p  uuid := gen_random_uuid();   -- joins as property manager
  q  uuid := gen_random_uuid();   -- office manager invite, inviter no longer licensee
  -- Office 3: an agent plan (no property management).
  o3 uuid := gen_random_uuid();
  x  uuid := gen_random_uuid();
  -- Office 4: licensee not on RealComply; someone else becomes licensee first.
  o4 uuid := gen_random_uuid();
  g  uuid := gen_random_uuid();
  y  uuid := gen_random_uuid();
  inv record;
  tok uuid;
  tok_m uuid;
  tok_p uuid;
  tok_q uuid;
  tok_g uuid;
  n integer;
  t text;
  r record;
begin
  insert into auth.users (id, email) values
    (f, 'ir-f@example.invalid'), (a, 'ir-a@example.invalid'), (v, 'ir-jordan@example.invalid'),
    (l, 'ir-l@example.invalid'), (b, 'ir-b@example.invalid'), (m, 'ir-m@example.invalid'),
    (p, 'ir-p@example.invalid'), (q, 'ir-q@example.invalid'), (x, 'ir-x@example.invalid'),
    (g, 'ir-g@example.invalid'), (y, 'ir-y@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'IR Office One', 'office_1', 'active', 'Jordan Made-Up', 'IR-Jordan@example.invalid '),
    (o2, 'IR Office Two', 'office_1', 'active', null, null),
    (o3, 'IR Own Plan', 'agent_1', 'active', 'Pat Made-Up', 'ir-pat@example.invalid'),
    (o4, 'IR Office Four', 'office_1', 'active', 'Kim Made-Up', 'ir-kim@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant, created_at) values
    (f, o1, 'Sam Founder', 'ir-f@example.invalid', true, false, false, now() - interval '2 days'),
    (a, o1, 'Alex Agent', 'ir-a@example.invalid', true, false, false, now() - interval '1 day'),
    (l, o2, 'Lee Licensee', 'ir-l@example.invalid', true, true, false, now() - interval '2 days'),
    (b, o2, 'Bo Agent', 'ir-b@example.invalid', true, false, false, now() - interval '1 day'),
    (x, o3, 'Xi Solo', 'ir-x@example.invalid', true, true, false, now()),
    (g, o4, 'Gus Founder', 'ir-g@example.invalid', true, false, false, now() - interval '1 day');
  insert into public.office_managers (agency_id, profile_id, wording, approved_via, approved_by_name) values
    (o1, f, public.office_manager_wording('Sam Founder', 'IR Office One'), 'email_link', 'Jordan Made-Up'),
    (o4, g, public.office_manager_wording('Gus Founder', 'IR Office Four'), 'email_link', 'Kim Made-Up');

  -- 1. The office manager invites the licensee in charge: whatever the form
  --    says, the invite goes to the licensee exactly as in Office profile.
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.agency_invites (agency_id, email, full_name, is_licensee_in_charge, invited_by)
    values (o1, 'someone-else@example.invalid', 'Someone Else', true, a)
    returning * into inv;
  if inv.email <> 'ir-jordan@example.invalid' or inv.full_name is distinct from 'Jordan Made-Up' then
    raise exception 'FAIL 1: the licensee invite went to % (%)', inv.email, inv.full_name;
  end if;
  if inv.invited_by <> f then raise exception 'FAIL 1b: the invite says someone else sent it'; end if;
  tok := inv.token;
  if public.invite_role(tok) <> 'licensee_in_charge' then raise exception 'FAIL 1c: invite_role said %', public.invite_role(tok); end if;
  begin
    insert into public.agency_invites (agency_id, email, is_licensee_in_charge) values (o1, 'x@example.invalid', true);
    raise exception 'FAIL 1d: a second licensee invite while one is waiting';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- An invite can't be changed, only cancelled.
  begin
    update public.agency_invites set email = 'other@example.invalid' where id = inv.id;
    raise exception 'FAIL 1e: changed who an invite is for';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 2. The office manager can't invite an office manager, or two roles at once.
  begin
    insert into public.agency_invites (agency_id, email, full_name, is_office_manager) values (o1, 'om@example.invalid', 'Om Person', true);
    raise exception 'FAIL 2: an office manager invited an office manager';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.agency_invites (agency_id, email, is_assistant, is_property_manager) values (o1, 'two@example.invalid', true, true);
    raise exception 'FAIL 2b: an invite for two roles';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 3. The licensee's name and email: not the office manager, not the person
  --    who set the office up (f is both).
  begin
    perform public.set_agency_licensee('Changed', 'changed@example.invalid');
    raise exception 'FAIL 3: the office manager changed the licensee''s details';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    update public.agencies set licensee_email = 'changed@example.invalid' where id = o1;
    raise exception 'FAIL 3b: changed the licensee email directly';
  exception when check_violation then null;
  end;

  -- 4. An agent who isn't office manager can't invite anyone.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  begin
    insert into public.agency_invites (agency_id, email) values (o1, 'agent2@example.invalid');
    raise exception 'FAIL 4: an agent sent an invite';
  exception when insufficient_privilege then null;
  end;

  -- 5. The licensee joins by the invite: licensee in charge, recorded as an
  --    invite (no start date, not a handover), billing stays with f.
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  perform public.accept_invite(tok, 'Jordan Made-Up');
  reset role;
  select * into r from public.profiles where id = v;
  if not r.is_licensee_in_charge then raise exception 'FAIL 5: the licensee joined, but not as licensee in charge'; end if;
  select * into r from public.licensee_in_charge_history where profile_id = v;
  if r.source <> 'invite' or r.started_on is not null then
    raise exception 'FAIL 5b: history says % from %', r.source, r.started_on;
  end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  if not public.is_account_holder() then raise exception 'FAIL 5c: billing moved away from whoever set the office up'; end if;
  if not public.is_office_manager() then raise exception 'FAIL 5d: the office manager lost the role when the licensee joined'; end if;
  -- Now the office has a licensee on RealComply: no more licensee invites.
  begin
    insert into public.agency_invites (agency_id, email, is_licensee_in_charge) values (o1, 'x@example.invalid', true);
    raise exception 'FAIL 5e: invited a licensee in charge while one is on RealComply';
  exception when insufficient_privilege or raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- ...and the licensee, now signed in, can change their own details.
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  perform public.set_agency_licensee('Jordan Made-Up', 'ir-jordan@example.invalid');

  -- 6. The licensee with a login invites an office manager: the words and the
  --    time are the database's; a name is needed.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  begin
    insert into public.agency_invites (agency_id, email, is_office_manager) values (o2, 'ir-m@example.invalid', true);
    raise exception 'FAIL 6: an office manager invite without a name';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  insert into public.agency_invites (agency_id, email, full_name, is_office_manager, office_manager_wording)
    values (o2, 'ir-m@example.invalid', '  Max Manager ', true, 'I authorise anyone at all')
    returning * into inv;
  if inv.office_manager_wording <> public.office_manager_wording('Max Manager', 'IR Office Two')
     or inv.office_manager_authorised_at is null then
    raise exception 'FAIL 6b: the office manager wording was %', inv.office_manager_wording;
  end if;
  tok_m := inv.token;
  -- Licensee in charge isn't an invite here: hand over in Office profile.
  begin
    insert into public.agency_invites (agency_id, email, is_licensee_in_charge) values (o2, 'new-lic@example.invalid', true);
    raise exception 'FAIL 6c: invited a licensee in charge where one is on RealComply';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  insert into public.agency_invites (agency_id, email, full_name, is_property_manager)
    values (o2, 'ir-p@example.invalid', 'Pia Rentals', true) returning token into tok_p;
  insert into public.agency_invites (agency_id, email, full_name, is_office_manager)
    values (o2, 'ir-q@example.invalid', 'Quinn Later', true) returning token into tok_q;

  -- 7. Joining as office manager: recorded like an approval in Team.
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  perform public.accept_invite(tok_m, 'Max Manager');
  if not public.is_office_manager() then raise exception 'FAIL 7: joined, but not as office manager'; end if;
  reset role;
  select * into r from public.office_managers where profile_id = m;
  if r.approved_by <> l or r.approved_via <> 'team' or r.approved_by_name <> 'Lee Licensee'
     or r.wording <> public.office_manager_wording('Max Manager', 'IR Office Two') then
    raise exception 'FAIL 7b: the record says % by % (%)', r.approved_via, r.approved_by_name, r.wording;
  end if;

  -- 8. If the person who invited them is no longer licensee in charge, they
  --    join as an agent.
  update public.agency_invites set invited_by = b where token = tok_q;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', q, 'role', 'authenticated')::text, true);
  perform public.accept_invite(tok_q, 'Quinn Later');
  if public.is_office_manager() then raise exception 'FAIL 8: became office manager without a licensee''s approval'; end if;

  -- 9. Joining as property manager: the flag, and the licence category.
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform public.accept_invite(tok_p, 'Pia Rentals');
  reset role;
  select * into r from public.profiles where id = p;
  if not r.is_property_manager or not r.is_agent or r.licence_categories <> array['residential_property_management'] then
    raise exception 'FAIL 9: joined as % / % / %', r.is_property_manager, r.is_agent, r.licence_categories;
  end if;

  -- 10. Property manager is a role: the licensee or an office manager changes
  --     it, never the person themselves.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin
    update public.profiles set is_property_manager = true where id = b;
  exception when raise_exception then null;
  end;
  select count(*) into n from public.profiles where id = b and is_property_manager;
  if n <> 0 then raise exception 'FAIL 10: made themselves property manager'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  update public.profiles set is_property_manager = true where id = b;
  select count(*) into n from public.profiles where id = b and is_property_manager;
  if n <> 1 then raise exception 'FAIL 10b: the office manager couldn''t make someone property manager'; end if;

  -- 11. No property manager without property management on the plan.
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  begin
    insert into public.agency_invites (agency_id, email, is_property_manager) values (o3, 'pm@example.invalid', true);
    raise exception 'FAIL 11: a property manager invite on an agent plan';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 12. A licensee invite still waiting is done with once someone else is the
  --     office's licensee in charge on RealComply.
  perform set_config('request.jwt.claims', json_build_object('sub', g, 'role', 'authenticated')::text, true);
  insert into public.agency_invites (agency_id, email, is_licensee_in_charge) values (o4, 'ignored@example.invalid', true)
    returning token into tok_g;
  reset role;
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant)
    values (y, o4, 'Yan Other', 'ir-y@example.invalid', true, true, false);
  if public.invite_role(tok_g) is not null then raise exception 'FAIL 12: the licensee invite is still waiting'; end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'Invite roles: all checks passed';
end
$$;

rollback;
