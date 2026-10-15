-- ===== READ ONLY. Insurance certificates test, 15 October 2026 =====
--
-- Proves supabase/migrations/0076_insurance_certificates.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up offices and people it creates
-- never exist outside it.
--
-- Pass: the last line says "Insurance certificates: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  ag uuid := gen_random_uuid();      -- an office
  ag2 uuid := gen_random_uuid();     -- another office
  lic uuid := gen_random_uuid();     -- its licensee in charge
  agt uuid := gen_random_uuid();     -- one of its agents
  lic2 uuid := gen_random_uuid();    -- the other office's licensee
  n integer;
  h record;
begin
  insert into auth.users (id, email) values
    (lic, 'ic-lic@example.invalid'), (agt, 'ic-agent@example.invalid'), (lic2, 'ic-lic2@example.invalid');
  insert into public.agencies (id, name, plan, status) values
    (ag, 'IC Property (made up)', 'office_1', 'active'),
    (ag2, 'IC Other Property (made up)', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent) values
    (lic, ag, 'IC Licensee', 'ic-lic@example.invalid', true, false, true),
    (agt, ag, 'IC Agent', 'ic-agent@example.invalid', false, false, true),
    (lic2, ag2, 'IC Other Licensee', 'ic-lic2@example.invalid', true, false, true);

  -- Everything below is done as the licensee, through the same rules the app uses.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);

  -- 1. Details typed by hand: one history row, "typed", by the licensee.
  set local role authenticated;
  update public.agencies
     set pi_insurer = 'Made-up Underwriting Pty Ltd', pi_policy_number = 'PI-204418', pi_expiry = '2026-06-30'
   where id = ag;
  reset role;
  select count(*) into n from public.insurance_history where agency_id = ag;
  if n <> 1 then raise exception 'FAIL 1: % history rows after typing the details, expected 1', n; end if;
  select * into h from public.insurance_history where agency_id = ag;
  if h.policy_type <> 'pi' or h.source <> 'typed' or h.changed_by is distinct from lic
     or h.before ->> 'insurer' is not null or h.after ->> 'expiry' <> '2026-06-30' then
    raise exception 'FAIL 1: the typed change was recorded wrongly (%, %, %, %)', h.policy_type, h.source, h.before, h.after;
  end if;

  -- 2. A certificate uploaded and read: "document_read".
  set local role authenticated;
  update public.agencies
     set pi_document_path = ag::text || '/_insurance/pi/1-coc-2025-26.pdf',
         pi_document_file_name = 'coc-2025-26.pdf',
         pi_read = jsonb_build_object('changeSource', 'document_read', 'at', '2025-07-01T00:00:00Z')
   where id = ag;
  reset role;
  select count(*) into n from public.insurance_history where agency_id = ag;
  if n <> 2 then raise exception 'FAIL 2: % history rows after the certificate read, expected 2', n; end if;
  select count(*) into n from public.insurance_history
   where agency_id = ag and source = 'document_read' and after ->> 'documentFileName' = 'coc-2025-26.pdf';
  if n <> 1 then raise exception 'FAIL 2: the certificate read was not recorded as one'; end if;

  -- 3. The renewal: next year's certificate moves the expiry on, and last
  --    year's certificate and expiry are kept in the history.
  set local role authenticated;
  update public.agencies
     set pi_document_path = ag::text || '/_insurance/pi/2-coc-2026-27.pdf',
         pi_document_file_name = 'coc-2026-27.pdf',
         pi_expiry = '2027-06-30',
         pi_read = jsonb_build_object('changeSource', 'document_read', 'at', '2026-10-15T00:00:00Z')
   where id = ag;
  reset role;
  select count(*) into n from public.insurance_history where agency_id = ag;
  if n <> 3 then raise exception 'FAIL 3: % history rows after the renewal, expected 3', n; end if;
  select count(*) into n from public.insurance_history
   where agency_id = ag and policy_type = 'pi' and source = 'document_read'
     and before ->> 'documentPath' = ag::text || '/_insurance/pi/1-coc-2025-26.pdf'
     and before ->> 'expiry' = '2026-06-30'
     and after ->> 'documentPath' = ag::text || '/_insurance/pi/2-coc-2026-27.pdf'
     and after ->> 'expiry' = '2027-06-30';
  if n <> 1 then raise exception 'FAIL 3: last year''s certificate and expiry are not in the history'; end if;

  -- 4. A change to anything else on the office writes nothing.
  set local role authenticated;
  update public.agencies set corporation_licence_number = '10099999' where id = ag;
  reset role;
  select count(*) into n from public.insurance_history where agency_id = ag;
  if n <> 3 then raise exception 'FAIL 4: a change to something else wrote % insurance history rows', n - 3; end if;

  -- 5. A change made without a new read state is a change by hand, even
  --    though the last read state still says "document_read".
  set local role authenticated;
  update public.agencies set pi_policy_number = 'PI-204419' where id = ag;
  reset role;
  select count(*) into n from public.insurance_history
   where agency_id = ag and source = 'typed' and after ->> 'policyNumber' = 'PI-204419';
  if n <> 1 then raise exception 'FAIL 5: the hand change was not recorded as typed'; end if;

  -- 6. Each policy gets its own row: cyber and iCare changed together.
  set local role authenticated;
  update public.agencies
     set cyber_insurer = 'Made-up Cyber Cover Ltd', icare_expiry = '2027-03-31'
   where id = ag;
  reset role;
  select count(*) into n from public.insurance_history where agency_id = ag and policy_type in ('cyber', 'icare');
  if n <> 2 then raise exception 'FAIL 6: % rows for cyber and iCare, expected 2', n; end if;

  -- 7. Only the licensee sees it: not an agent, not another office.
  set local role authenticated;
  select count(*) into n from public.insurance_history;
  reset role;
  if n <> 6 then raise exception 'FAIL 7: the licensee sees % rows, expected 6', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', agt, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.insurance_history;
  reset role;
  if n <> 0 then raise exception 'FAIL 7: an agent sees % insurance history rows', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', lic2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.insurance_history;
  reset role;
  if n <> 0 then raise exception 'FAIL 7: another office''s licensee sees % rows', n; end if;

  -- 8. Nobody writes the history directly, not even the licensee.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.insurance_history (agency_id, policy_type, source) values (ag, 'pi', 'typed');
    reset role;
    raise exception 'FAIL 8: the licensee added a history row directly';
  exception when insufficient_privilege then
    reset role;
  end;
  begin
    set local role authenticated;
    update public.insurance_history set before = '{}'::jsonb where agency_id = ag;
    reset role;
    raise exception 'FAIL 8: the licensee changed a history row';
  exception when insufficient_privilege then
    reset role;
  end;
  begin
    set local role authenticated;
    delete from public.insurance_history where agency_id = ag;
    reset role;
    raise exception 'FAIL 8: the licensee deleted history rows';
  exception when insufficient_privilege then
    reset role;
  end;
  select count(*) into n from public.insurance_history where agency_id = ag;
  if n <> 6 then raise exception 'FAIL 8: the history changed (% rows)', n; end if;

  -- 9. A certificate must be in that policy's own folder in the office's own files.
  begin
    set local role authenticated;
    update public.agencies set pi_document_path = ag::text || '/_insurance/cyber/3-x.pdf' where id = ag;
    reset role;
    raise exception 'FAIL 9: a PI certificate path in the cyber folder was saved';
  exception when check_violation then
    reset role;
  end;
  begin
    set local role authenticated;
    update public.agencies set icare_document_path = ag2::text || '/_insurance/icare/3-x.pdf' where id = ag;
    reset role;
    raise exception 'FAIL 9: a path in another office''s folder was saved';
  exception when check_violation then
    reset role;
  end;
end $$;

select 'Insurance certificates: all checks passed' as result;

rollback;
