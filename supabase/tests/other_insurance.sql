-- ===== READ ONLY. Other insurance test, 16 October 2026 =====
--
-- Proves supabase/migrations/0078_other_insurance.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up offices and people it creates
-- never exist outside it.
--
-- Pass: the last line says "Other insurance: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  ag uuid := gen_random_uuid();      -- an office
  ag2 uuid := gen_random_uuid();     -- another office
  lic uuid := gen_random_uuid();     -- its licensee in charge
  agt uuid := gen_random_uuid();     -- one of its agents
  lic2 uuid := gen_random_uuid();    -- the other office's licensee
  pl uuid := gen_random_uuid();      -- a public liability policy
  car1 uuid := gen_random_uuid();    -- a motor vehicle policy
  car2 uuid := gen_random_uuid();    -- a second one
  n integer;
  h record;
  p record;
begin
  insert into auth.users (id, email) values
    (lic, 'oi-lic@example.invalid'), (agt, 'oi-agent@example.invalid'), (lic2, 'oi-lic2@example.invalid');
  insert into public.agencies (id, name, plan, status) values
    (ag, 'OI Property (made up)', 'office_1', 'active'),
    (ag2, 'OI Other Property (made up)', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent) values
    (lic, ag, 'OI Licensee', 'oi-lic@example.invalid', true, false, true),
    (agt, ag, 'OI Agent', 'oi-agent@example.invalid', false, false, true),
    (lic2, ag2, 'OI Other Licensee', 'oi-lic2@example.invalid', true, false, true);

  -- Everything below is done as the licensee, through the same rules the app uses.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);

  -- 1. Adding a policy with its certificate read: one history row,
  --    "document_read", for that policy, by the licensee. Who added it and
  --    when are the database's, whatever the app sends.
  set local role authenticated;
  insert into public.insurance_policies
    (id, agency_id, kind, insurer, policy_number, expiry, document_path, document_file_name, read, created_by, created_at)
  values
    (pl, ag, 'public_liability', 'Made-up Liability Insurance Ltd', 'PL-55120', '2026-11-01',
     ag::text || '/_insurance/other/' || pl::text || '/1-pl-coc.pdf', 'pl-coc.pdf',
     jsonb_build_object('changeSource', 'document_read'), agt, '2020-01-01');
  reset role;
  select * into p from public.insurance_policies where id = pl;
  if p.created_by is distinct from lic or p.created_at < now() - interval '1 minute' then
    raise exception 'FAIL 1: who added it and when were taken from the app (%, %)', p.created_by, p.created_at;
  end if;
  select count(*) into n from public.insurance_history where agency_id = ag;
  if n <> 1 then raise exception 'FAIL 1: % history rows after adding the policy, expected 1', n; end if;
  select * into h from public.insurance_history where agency_id = ag;
  if h.policy_type <> 'other' or h.policy_id is distinct from pl or h.source <> 'document_read'
     or h.changed_by is distinct from lic or h.before ->> 'insurer' is not null
     or h.after ->> 'expiry' <> '2026-11-01' or h.after ->> 'documentFileName' <> 'pl-coc.pdf' then
    raise exception 'FAIL 1: adding the policy was recorded wrongly (%, %, %, %)', h.policy_type, h.source, h.before, h.after;
  end if;

  -- 2. More than one of the same type is fine (two vehicles).
  set local role authenticated;
  insert into public.insurance_policies (id, agency_id, kind, name) values
    (car1, ag, 'motor_vehicle', 'Toyota Corolla'), (car2, ag, 'motor_vehicle', 'Ford Ranger');
  reset role;
  select count(*) into n from public.insurance_policies where agency_id = ag and kind = 'motor_vehicle';
  if n <> 2 then raise exception 'FAIL 2: % motor vehicle policies, expected 2', n; end if;

  -- 3. "Other" needs a name.
  begin
    set local role authenticated;
    insert into public.insurance_policies (agency_id, kind) values (ag, 'other');
    reset role;
    raise exception 'FAIL 3: an "Other" policy was added with no name';
  exception when check_violation then
    reset role;
  end;
  set local role authenticated;
  insert into public.insurance_policies (agency_id, kind, name) values (ag, 'other', 'Management liability');
  reset role;

  -- 4. The renewal: next year's certificate moves the expiry on, and last
  --    year's certificate and expiry are kept in the history.
  set local role authenticated;
  update public.insurance_policies
     set document_path = ag::text || '/_insurance/other/' || pl::text || '/2-pl-coc-2026-27.pdf',
         document_file_name = 'pl-coc-2026-27.pdf',
         expiry = '2027-11-01',
         read = jsonb_build_object('changeSource', 'document_read', 'at', '2026-10-16T00:00:00Z')
   where id = pl;
  reset role;
  select count(*) into n from public.insurance_history
   where policy_id = pl and source = 'document_read'
     and before ->> 'documentPath' = ag::text || '/_insurance/other/' || pl::text || '/1-pl-coc.pdf'
     and before ->> 'expiry' = '2026-11-01'
     and after ->> 'expiry' = '2027-11-01';
  if n <> 1 then raise exception 'FAIL 4: last year''s certificate and expiry are not in the history'; end if;

  -- 5. A change by hand is "typed", even though the read state still says
  --    "document_read" from before.
  set local role authenticated;
  update public.insurance_policies set policy_number = 'PL-55121' where id = pl;
  reset role;
  select count(*) into n from public.insurance_history
   where policy_id = pl and source = 'typed' and after ->> 'policyNumber' = 'PL-55121';
  if n <> 1 then raise exception 'FAIL 5: the hand change was not recorded as typed'; end if;

  -- 6. A certificate must be in that policy's own folder in the office's own files.
  begin
    set local role authenticated;
    update public.insurance_policies
       set document_path = ag::text || '/_insurance/other/' || car1::text || '/3-x.pdf' where id = pl;
    reset role;
    raise exception 'FAIL 6: a certificate in another policy''s folder was saved';
  exception when check_violation then
    reset role;
  end;
  begin
    set local role authenticated;
    update public.insurance_policies
       set document_path = ag2::text || '/_insurance/other/' || pl::text || '/3-x.pdf' where id = pl;
    reset role;
    raise exception 'FAIL 6: a path in another office''s folder was saved';
  exception when check_violation then
    reset role;
  end;
  begin
    set local role authenticated;
    update public.insurance_policies set document_path = ag::text || '/_insurance/pi/3-x.pdf' where id = pl;
    reset role;
    raise exception 'FAIL 6: a path in the PI folder was saved';
  exception when check_violation then
    reset role;
  end;

  -- 7. The type and the office can't change.
  begin
    set local role authenticated;
    update public.insurance_policies set kind = 'office_contents' where id = car1;
    reset role;
    raise exception 'FAIL 7: the type of a policy was changed';
  exception when raise_exception then
    reset role;
  end;

  -- 8. Remove: off the register, stamped by the database, recorded, final.
  set local role authenticated;
  update public.insurance_policies set removed_at = '2000-01-01', removed_by = agt where id = car2;
  reset role;
  select * into p from public.insurance_policies where id = car2;
  if p.removed_by is distinct from lic or p.removed_at < now() - interval '1 minute' then
    raise exception 'FAIL 8: who removed it and when were taken from the app (%, %)', p.removed_by, p.removed_at;
  end if;
  select count(*) into n from public.insurance_history where policy_id = car2 and source = 'policy_removed' and changed_by = lic;
  if n <> 1 then raise exception 'FAIL 8: the removal was not recorded'; end if;
  begin
    set local role authenticated;
    update public.insurance_policies set insurer = 'Changed after removal' where id = car2;
    reset role;
    raise exception 'FAIL 8: a removed policy was changed';
  exception when raise_exception then
    reset role;
  end;

  -- 9. Only the licensee: an agent can't see, add or change one, and another
  --    office's licensee can't see this office's.
  perform set_config('request.jwt.claims', json_build_object('sub', agt, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.insurance_policies;
  reset role;
  if n <> 0 then raise exception 'FAIL 9: an agent sees % policies', n; end if;
  begin
    set local role authenticated;
    insert into public.insurance_policies (agency_id, kind) values (ag, 'public_liability');
    reset role;
    raise exception 'FAIL 9: an agent added a policy';
  exception when insufficient_privilege then
    reset role;
  end;
  set local role authenticated;
  update public.insurance_policies set insurer = 'Agent was here' where id = pl;
  get diagnostics n = row_count;
  reset role;
  if n <> 0 then raise exception 'FAIL 9: an agent changed a policy'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', lic2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.insurance_policies;
  reset role;
  if n <> 0 then raise exception 'FAIL 9: another office''s licensee sees % policies', n; end if;
  set local role authenticated;
  select count(*) into n from public.insurance_history;
  reset role;
  if n <> 0 then raise exception 'FAIL 9: another office''s licensee sees % history rows', n; end if;

  -- 10. Nobody deletes a policy or writes its history directly, not even the
  --     licensee.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    delete from public.insurance_policies where id = pl;
    reset role;
    raise exception 'FAIL 10: the licensee deleted a policy';
  exception when insufficient_privilege then
    reset role;
  end;
  begin
    set local role authenticated;
    insert into public.insurance_history (agency_id, policy_type, policy_id, source) values (ag, 'other', pl, 'typed');
    reset role;
    raise exception 'FAIL 10: the licensee added a history row directly';
  exception when insufficient_privilege then
    reset role;
  end;

  -- 11. The three fixed policies still write their history as before, with no policy id.
  set local role authenticated;
  update public.agencies set pi_insurer = 'Made-up Underwriting Pty Ltd' where id = ag;
  reset role;
  select count(*) into n from public.insurance_history where agency_id = ag and policy_type = 'pi' and policy_id is null;
  if n <> 1 then raise exception 'FAIL 11: the PI change wrote % rows, expected 1', n; end if;

  -- 12. The licensee sees all of it: 4 policies, the removed one included
  --     (the register leaves it out; the record keeps it), and 5 history rows:
  --     the added policy, its renewal and hand change, the removal, the PI change.
  --     Adding a policy with nothing on it yet (the two vehicles) writes none.
  set local role authenticated;
  select count(*) into n from public.insurance_policies;
  reset role;
  if n <> 4 then raise exception 'FAIL 12: the licensee sees % policies, expected 4', n; end if;
  set local role authenticated;
  select count(*) into n from public.insurance_history;
  reset role;
  if n <> 5 then raise exception 'FAIL 12: the licensee sees % history rows, expected 5', n; end if;
end $$;

select 'Other insurance: all checks passed' as result;

rollback;
