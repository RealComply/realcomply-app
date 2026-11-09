-- ===== READ ONLY. Office manager limits Legal relies on, 3 November 2026 =====
--
-- Legal cleared office manager access (part 1 of #107) on these limits:
--   1. Only the licensee in charge can make someone office manager.
--   2. Agents can't see complaints.
--   3. The office manager can change only a complaint's status, not its
--      details.
--   4. The office manager can't delete a complaint.
--   5. Only the licensee signs off.
-- This proves each one in the database, after 0108, 0109 and 0111. Safe on
-- the live database: everything happens inside one transaction that is
-- rolled back at the end, so the made-up offices and people it creates never
-- exist outside it.
--
-- Pass: the last line says "Office manager limits: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1 uuid := gen_random_uuid();   -- an office
  l  uuid := gen_random_uuid();   -- its licensee in charge
  m  uuid := gen_random_uuid();   -- its office manager
  a  uuid := gen_random_uuid();   -- an agent
  b  uuid := gen_random_uuid();   -- another agent, not office manager
  c1 uuid := gen_random_uuid();   -- an open complaint
  today date := (now() at time zone 'Australia/Sydney')::date;
  n integer;
  r record;
begin
  insert into auth.users (id, email) values
    (l, 'oml-l@example.invalid'), (m, 'oml-m@example.invalid'), (a, 'oml-a@example.invalid'), (b, 'oml-b@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'OML Office (made up)', 'office_2', 'active', 'Lee Licensee', 'oml-lee-own@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (l, o1, 'Lee Licensee', 'oml-l@example.invalid', true, true, false),
    (m, o1, 'Max Manager', 'oml-m@example.invalid', true, false, false),
    (a, o1, 'Ana Agent', 'oml-a@example.invalid', true, false, false),
    (b, o1, 'Ben Agent', 'oml-b@example.invalid', true, false, false);
  insert into public.complaints (id, agency_id, received_date, complainant, nature, notes, status, created_by) values
    (c1, o1, date '2026-10-12', 'K. Adams, buyer (made up)', 'Inspection times', 'First call 12 Oct', 'open', l);

  -- ── 1. Only the licensee in charge makes someone office manager ─────────
  -- The licensee does, in Team.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.grant_office_manager(m);
  reset role;
  if not exists (select 1 from public.office_managers where profile_id = m and withdrawn_at is null) then
    raise exception 'FAIL 1: the licensee couldn''t make someone office manager'; end if;

  -- An agent can't, in Team, by writing the record, or by inviting.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.grant_office_manager(b);
    raise exception 'FAIL 1b: an agent made someone office manager';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.office_managers (agency_id, profile_id, wording, approved_via, approved_by_name)
    values (o1, a, 'made up', 'team', 'Ana Agent');
    raise exception 'FAIL 1c: an agent wrote an office manager record';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.agency_invites (agency_id, email, full_name, is_office_manager, invited_by)
    values (o1, 'oml-new@example.invalid', 'New Person', true, a);
    raise exception 'FAIL 1d: an agent invited an office manager';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- Nor can the office manager.
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.grant_office_manager(b);
    raise exception 'FAIL 1e: the office manager made someone else office manager';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.agency_invites (agency_id, email, full_name, is_office_manager, invited_by)
    values (o1, 'oml-new@example.invalid', 'New Person', true, m);
    raise exception 'FAIL 1f: the office manager invited an office manager';
  exception when insufficient_privilege then null;
  end;
  -- Nor ask for themselves by link where the licensee is on RealComply.
  begin
    perform public.request_office_manager();
    raise exception 'FAIL 1g: the office manager asked for a link';
  exception when others then
    if sqlerrm not like 'You''re already office manager%' then raise; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.request_office_manager();
    raise exception 'FAIL 1h: an agent asked for a link while the licensee is on RealComply';
  exception when others then
    if sqlerrm not like 'Your licensee in charge is on RealComply%' then raise; end if;
  end;
  reset role;

  -- ── 2. Agents can't see complaints ─────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.complaints;
  if n <> 0 then raise exception 'FAIL 2: an agent saw % complaints', n; end if;
  update public.complaints set status = 'under_review' where id = c1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2b: an agent changed a complaint'; end if;
  begin
    insert into public.complaints (agency_id, received_date, complainant, nature, status, created_by)
    values (o1, today, 'Made up', 'Made up', 'open', a);
    raise exception 'FAIL 2c: an agent logged a complaint';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ── 3. The office manager changes the status, not the details ──────────
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.complaints where id = c1;
  if n <> 1 then raise exception 'FAIL 3: the office manager can''t see the complaints register'; end if;
  update public.complaints set status = 'under_review' where id = c1;
  -- Marked Resolved with a date of their own: the database writes today's.
  update public.complaints set status = 'resolved', resolved_date = date '2001-01-01' where id = c1;
  select status, resolved_date, resolved_by into r from public.complaints where id = c1;
  if r.status <> 'resolved' or r.resolved_date <> today or r.resolved_by <> m then
    raise exception 'FAIL 3b: marking it Resolved recorded %', row_to_json(r); end if;
  begin
    update public.complaints set resolved_date = date '2026-10-15' where id = c1;
    raise exception 'FAIL 3c: the office manager changed the date it was resolved';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.complaints set nature = 'Changed (made up)' where id = c1;
    raise exception 'FAIL 3d: the office manager changed what the complaint was about';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.complaints set notes = 'Changed (made up)' where id = c1;
    raise exception 'FAIL 3e: the office manager changed the notes';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.complaints set complainant = 'Changed (made up)' where id = c1;
    raise exception 'FAIL 3f: the office manager changed who complained';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.complaints set received_date = date '2026-10-01' where id = c1;
    raise exception 'FAIL 3g: the office manager changed the date it was received';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.complaints set created_at = now() - interval '1 year' where id = c1;
    raise exception 'FAIL 3h: the office manager changed when it was logged';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.complaints set signed_off_via = 'pack' where id = c1;
    raise exception 'FAIL 3i: the office manager changed how it was signed off';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.complaints set status = 'open' where id = c1;
    raise exception 'FAIL 3j: the office manager reopened a resolved complaint';
  exception when insufficient_privilege then null;
  end;
  reset role;
  select nature, notes, complainant, received_date into r from public.complaints where id = c1;
  if r.nature <> 'Inspection times' or r.notes <> 'First call 12 Oct' or r.complainant <> 'K. Adams, buyer (made up)'
     or r.received_date <> date '2026-10-12' then
    raise exception 'FAIL 3k: the complaint''s details changed: %', row_to_json(r); end if;

  -- ── 4. The office manager can't delete a complaint ─────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.complaints where id = c1;
  get diagnostics n = row_count;
  reset role;
  if n <> 0 or not exists (select 1 from public.complaints where id = c1) then
    raise exception 'FAIL 4: the office manager deleted a complaint'; end if;

  -- ── 5. Only the licensee signs off ─────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.sign_off_complaint(c1);
    raise exception 'FAIL 5: the office manager signed off a complaint';
  exception when insufficient_privilege then null;
  end;
  -- Writing the sign-off directly is put back by the database.
  update public.complaints set signed_off_by = m, signed_off_name = 'Max Manager', signed_off_at = now() where id = c1;
  reset role;
  if (select signed_off_at from public.complaints where id = c1) is not null then
    raise exception 'FAIL 5b: the office manager wrote a sign-off'; end if;
  -- The pack and item signing functions are the server's only, never the browser's.
  if has_function_privilege('authenticated', 'public.licensee_sign_pack(uuid, uuid, text, text, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.licensee_sign_item(uuid, text, uuid, uuid, text, text, uuid)', 'execute')
     or has_function_privilege('anon', 'public.licensee_sign_pack(uuid, uuid, text, text, jsonb)', 'execute') then
    raise exception 'FAIL 5c: someone signed in can call the signing functions'; end if;
  -- The licensee signs it off.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.sign_off_complaint(c1);
  reset role;
  select signed_off_by, signed_off_name into r from public.complaints where id = c1;
  if r.signed_off_by <> l or r.signed_off_name <> 'Lee Licensee' then
    raise exception 'FAIL 5d: the licensee''s sign-off recorded %', row_to_json(r); end if;

  raise notice 'Office manager limits: all checks passed';
end $$;

rollback;
