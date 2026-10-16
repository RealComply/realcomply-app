-- ===== READ ONLY. A certificate on an existing CPD row test, 15 October 2026 =====
--
-- Proves supabase/migrations/0077_cpd_certificate_on_existing_row.sql. Run
-- after it. Safe on the live database: everything happens inside one
-- transaction that is rolled back at the end, so the made-up office, people
-- and CPD rows it creates never exist outside it.
--
-- Pass: the last line says "Certificate on an existing CPD row: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  ag uuid := gen_random_uuid();      -- an office
  lic uuid := gen_random_uuid();     -- its licensee in charge
  agt uuid := gen_random_uuid();     -- an agent
  r1 uuid := gen_random_uuid();      -- CPD rows from a training session, no certificate yet
  r2 uuid := gen_random_uuid();
  r3 uuid := gen_random_uuid();
  r4 uuid := gen_random_uuid();
  folder text;
  h record;
begin
  insert into auth.users (id, email) values (lic, 'ce-lic@example.invalid'), (agt, 'ce-agent@example.invalid');
  insert into public.agencies (id, name, plan, status) values (ag, 'CE Property (made up)', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent) values
    (lic, ag, 'CE Licensee', 'ce-lic@example.invalid', true, false, true),
    (agt, ag, 'Jo Agent', 'ce-agent@example.invalid', false, false, true);
  folder := ag::text || '/_cpd/' || agt::text || '/';
  insert into public.cpd_records (id, agency_id, profile_id, activity_name, category, hours, completed_date, provider) values
    (r1, ag, agt, 'Trust accounting (made up)', 'general', 2, '2026-09-10', 'Made-up Training'),
    (r2, ag, agt, 'Contracts (made up)', 'general', 1, '2026-09-11', 'Made-up Training'),
    (r3, ag, agt, 'Ethics (made up)', 'general', 1, '2026-09-12', 'Made-up Training'),
    (r4, ag, agt, 'Agency practice (made up)', 'general', 1, '2026-09-13', 'Made-up Training');

  -- 1. The agent attaches a certificate to their own session row. No name question.
  perform set_config('request.jwt.claims', json_build_object('sub', agt, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.cpd_records set evidence_path = folder || '1-cert.pdf', evidence_file_name = 'cert.pdf' where id = r1;
  reset role;
  select * into h from public.cpd_records where id = r1;
  if h.evidence_path is distinct from folder || '1-cert.pdf' or h.hours <> 2 then
    raise exception 'FAIL 1: the certificate did not go on the existing row';
  end if;

  -- 2. The licensee attaches one in another name and answers "Yes, it's Jo's".
  --    The answer is kept, timed by the database, whatever time was sent.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.cpd_records
     set evidence_path = folder || '2-cert.pdf', evidence_file_name = 'cert2.pdf',
         name_on_certificate = 'Joanne Mary Agent', name_confirmed_by = lic, name_confirmed_at = '2000-01-01T00:00:00Z'
   where id = r2;
  reset role;
  select * into h from public.cpd_records where id = r2;
  if h.name_on_certificate is distinct from 'Joanne Mary Agent' or h.name_confirmed_by is distinct from lic
     or h.name_confirmed_at < now() - interval '1 minute' then
    raise exception 'FAIL 2: the name answer was not kept as given, timed by the database (%)', h.name_confirmed_at;
  end if;

  -- 3. The answer can't be changed without a new certificate.
  begin
    set local role authenticated;
    update public.cpd_records set name_on_certificate = 'Someone Else' where id = r2;
    reset role;
    raise exception 'FAIL 3: the name answer was changed on the same certificate';
  exception when raise_exception then
    reset role;
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 4. Nobody answers for someone else: the agent can't record the licensee as having confirmed it.
  perform set_config('request.jwt.claims', json_build_object('sub', agt, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    update public.cpd_records
       set evidence_path = folder || '3-cert.pdf', evidence_file_name = 'cert3.pdf',
           name_on_certificate = 'Joanne Agent', name_confirmed_by = lic
     where id = r3;
    reset role;
    raise exception 'FAIL 4: a name answer was recorded in someone else''s name';
  exception when raise_exception then
    reset role;
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 5. No answer without a certificate.
  begin
    set local role authenticated;
    update public.cpd_records set name_on_certificate = 'Joanne Agent', name_confirmed_by = agt where id = r4;
    reset role;
    raise exception 'FAIL 5: a name answer was recorded with no certificate';
  exception when raise_exception then
    reset role;
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 6. A replaced certificate takes its answer with it.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.cpd_records
     set evidence_path = folder || '4-cert.pdf', evidence_file_name = 'cert4.pdf',
         name_on_certificate = null, name_confirmed_by = null, name_confirmed_at = null
   where id = r2;
  reset role;
  select * into h from public.cpd_records where id = r2;
  if h.name_on_certificate is not null then raise exception 'FAIL 6: the old answer stayed with a new certificate'; end if;

  -- 7. A new row still works as before (0074): the person answering only.
  perform set_config('request.jwt.claims', json_build_object('sub', agt, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.cpd_records (agency_id, profile_id, activity_name, category, evidence_path, evidence_file_name,
                                  name_on_certificate, name_confirmed_by)
  values (ag, agt, 'New certificate (made up)', 'general', folder || '5-cert.pdf', 'cert5.pdf', 'Joanne Agent', agt);
  reset role;
  begin
    set local role authenticated;
    insert into public.cpd_records (agency_id, profile_id, activity_name, category, evidence_path, evidence_file_name,
                                    name_on_certificate, name_confirmed_by)
    values (ag, agt, 'Another (made up)', 'general', folder || '6-cert.pdf', 'cert6.pdf', 'Joanne Agent', lic);
    reset role;
    raise exception 'FAIL 7: a new row recorded someone else as confirming';
  exception when raise_exception then
    reset role;
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

select 'Certificate on an existing CPD row: all checks passed' as result;

rollback;
