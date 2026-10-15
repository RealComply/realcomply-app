-- ===== READ ONLY. The name on a CPD certificate test, 15 October 2026 =====
--
-- Proves supabase/migrations/0074_cpd_certificate_name.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up office and people it creates
-- never exist outside it.
--
-- Pass: the last line says "Certificate name: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  ag  uuid := gen_random_uuid();     -- a made-up office
  lic uuid := gen_random_uuid();     -- its licensee in charge
  jo  uuid := gen_random_uuid();     -- Jo Bennett, an agent
  oth uuid := gen_random_uuid();     -- another agent
  r1  uuid := gen_random_uuid();
  r2  uuid := gen_random_uuid();
  r3  uuid := gen_random_uuid();
  folder text;
  n integer;
  rec record;
begin
  -- 1. No record that exists today has a name on it.
  select count(*) into n from public.cpd_records
   where name_on_certificate is not null and created_at < now() - interval '1 minute';
  if n <> 0 then raise exception 'FAIL 1: % existing records were given a name', n; end if;

  insert into auth.users (id, email) values
    (lic, 'cn-lic@example.invalid'), (jo, 'cn-jo@example.invalid'), (oth, 'cn-oth@example.invalid');
  insert into public.agencies (id, name, plan, status) values (ag, 'CN Property (made up)', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent) values
    (lic, ag, 'CN Licensee', 'cn-lic@example.invalid', true, false, true),
    (jo, ag, 'Jo Bennett', 'cn-jo@example.invalid', false, false, true),
    (oth, ag, 'CN Other', 'cn-oth@example.invalid', false, false, true);
  folder := ag::text || '/_cpd/' || jo::text || '/';

  -- 2. Jo says "Yes, it's mine" to "Joanne Mary Bennett": saved, with the
  --    database's time, not the one sent.
  perform set_config('request.jwt.claims', json_build_object('sub', jo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.cpd_records (id, agency_id, profile_id, activity_name, category, hours, completed_date,
                                  evidence_path, evidence_file_name, created_by,
                                  name_on_certificate, name_confirmed_by, name_confirmed_at)
  values (r1, ag, jo, 'Contracts (made up)', 'general', 2, current_date, folder || '1-cert.pdf', 'cert.pdf', jo,
          'Joanne Mary Bennett', jo, '2020-01-01');
  reset role;
  select * into rec from public.cpd_records where id = r1;
  if rec.name_on_certificate is distinct from 'Joanne Mary Bennett' or rec.name_confirmed_by is distinct from jo then
    raise exception 'FAIL 2: the confirmed name was not saved';
  end if;
  if rec.name_confirmed_at < now() - interval '1 minute' then
    raise exception 'FAIL 2: the time sent was kept instead of the database clock';
  end if;

  -- 3. Nobody can answer as someone else.
  begin
    set local role authenticated;
    insert into public.cpd_records (agency_id, profile_id, activity_name, category, created_by,
                                    name_on_certificate, name_confirmed_by, name_confirmed_at)
    values (ag, jo, 'Forged (made up)', 'general', jo, 'Joanne Mary Bennett', lic, now());
    reset role;
    raise exception 'FAIL 3: a confirmation was saved in someone else''s name';
  exception when raise_exception then
    reset role;
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 4. A name with no one answering is refused too.
  begin
    set local role authenticated;
    insert into public.cpd_records (agency_id, profile_id, activity_name, category, created_by, name_on_certificate)
    values (ag, jo, 'No answer (made up)', 'general', jo, 'Joanne Mary Bennett');
    reset role;
    raise exception 'FAIL 4: a name was saved with no one confirming it';
  exception when raise_exception then
    reset role;
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 5. A certificate whose name matched saves with no name, as today.
  set local role authenticated;
  insert into public.cpd_records (id, agency_id, profile_id, activity_name, category, created_by,
                                  evidence_path, evidence_file_name)
  values (r2, ag, jo, 'Matched (made up)', 'general', jo, folder || '2-cert.pdf', 'cert.pdf');
  reset role;
  select * into rec from public.cpd_records where id = r2;
  if rec.name_on_certificate is not null or rec.name_confirmed_by is not null or rec.name_confirmed_at is not null then
    raise exception 'FAIL 5: a matching certificate was given a confirmation';
  end if;

  -- 6. The answer can't be rewritten afterwards.
  set local role authenticated;
  begin
    update public.cpd_records set name_on_certificate = 'Jo Bennett' where id = r1;
    raise exception 'FAIL 6: the name on the certificate was rewritten';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    update public.cpd_records set name_confirmed_at = now() - interval '1 year' where id = r1;
    raise exception 'FAIL 6: the time of the answer was changed';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 7. Nor quietly cleared while the certificate stays.
  begin
    update public.cpd_records set name_on_certificate = null, name_confirmed_by = null, name_confirmed_at = null
     where id = r1;
    raise exception 'FAIL 7: the answer was cleared with the certificate still attached';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 8. The rest of the record can still be corrected.
  update public.cpd_records set activity_name = 'Contracts and disclosure (made up)', hours = 3 where id = r1;
  reset role;
  select * into rec from public.cpd_records where id = r1;
  if rec.activity_name <> 'Contracts and disclosure (made up)' or rec.name_on_certificate is distinct from 'Joanne Mary Bennett' then
    raise exception 'FAIL 8: correcting the record failed or lost the answer';
  end if;

  -- 9. Removing the certificate clears the answer with it.
  set local role authenticated;
  update public.cpd_records
     set evidence_path = null, evidence_file_name = null,
         name_on_certificate = null, name_confirmed_by = null, name_confirmed_at = null
   where id = r1;
  reset role;
  select * into rec from public.cpd_records where id = r1;
  if rec.evidence_path is not null or rec.name_on_certificate is not null then
    raise exception 'FAIL 9: removing the certificate did not clear the answer';
  end if;

  -- 10. The licensee in charge can answer for Jo.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.cpd_records (id, agency_id, profile_id, activity_name, category, created_by,
                                  evidence_path, evidence_file_name,
                                  name_on_certificate, name_confirmed_by)
  values (r3, ag, jo, 'Trust accounting (made up)', 'general', lic, folder || '3-cert.pdf', 'cert.pdf',
          'Joanne Bennett', lic);
  reset role;
  select * into rec from public.cpd_records where id = r3;
  if rec.name_confirmed_by is distinct from lic or rec.name_confirmed_at is null then
    raise exception 'FAIL 10: the licensee could not confirm for Jo';
  end if;

  -- 11. Another agent can't add a certificate to Jo's record at all (0058, unchanged).
  perform set_config('request.jwt.claims', json_build_object('sub', oth, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.cpd_records (agency_id, profile_id, activity_name, category, created_by,
                                    name_on_certificate, name_confirmed_by)
    values (ag, jo, 'Not theirs (made up)', 'general', oth, 'Joanne Mary Bennett', oth);
    reset role;
    raise exception 'FAIL 11: an agent added a certificate to a colleague''s CPD';
  exception when insufficient_privilege then
    reset role;
  end;

  -- 12. A name longer than any real one is refused.
  perform set_config('request.jwt.claims', json_build_object('sub', jo, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.cpd_records (agency_id, profile_id, activity_name, category, created_by,
                                    name_on_certificate, name_confirmed_by)
    values (ag, jo, 'Too long (made up)', 'general', jo, repeat('x', 201), jo);
    reset role;
    raise exception 'FAIL 12: a 201 character name was saved';
  exception when check_violation then
    reset role;
  end;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'Certificate name: all checks passed';
end $$;

select 'Certificate name: all checks passed' as result;

rollback;
