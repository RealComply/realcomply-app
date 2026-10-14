-- ===== READ ONLY. Your own unsaved CPD certificate test, 15 October 2026 =====
--
-- Proves supabase/migrations/0075_own_cpd_upload_removable.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up office, people and file entries
-- it creates never exist outside it. It adds rows to the file list only; no
-- real file is touched.
--
-- Pass: the last line says "Own CPD upload: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  ag  uuid := gen_random_uuid();     -- a made-up office
  lic uuid := gen_random_uuid();     -- its licensee in charge
  jo  uuid := gen_random_uuid();     -- Jo, an agent
  oth uuid := gen_random_uuid();     -- another agent
  rec uuid := gen_random_uuid();
  jf  text;                          -- Jo's CPD folder
  n integer;
begin
  insert into auth.users (id, email) values
    (lic, 'oc-lic@example.invalid'), (jo, 'oc-jo@example.invalid'), (oth, 'oc-oth@example.invalid');
  insert into public.agencies (id, name, plan, status) values (ag, 'OC Property (made up)', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent) values
    (lic, ag, 'OC Licensee', 'oc-lic@example.invalid', true, false, true),
    (jo, ag, 'Jo Bennett', 'oc-jo@example.invalid', false, false, true),
    (oth, ag, 'OC Other', 'oc-oth@example.invalid', false, false, true);
  jf := ag::text || '/_cpd/' || jo::text || '/';

  -- Made-up file entries (no file behind them).
  insert into storage.objects (bucket_id, name, owner, owner_id, created_at) values
    ('compliance-evidence', jf || '1-fresh.pdf',      jo,  jo::text,  now()),
    ('compliance-evidence', jf || '2-old.pdf',        jo,  jo::text,  now() - interval '2 hours'),
    ('compliance-evidence', jf || '3-on-record.pdf',  jo,  jo::text,  now()),
    ('compliance-evidence', jf || '4-was-on.pdf',     jo,  jo::text,  now()),
    ('compliance-evidence', jf || '5-by-lic.pdf',     lic, lic::text, now()),
    ('compliance-evidence', jf || 'sub/6-deeper.pdf', jo,  jo::text,  now()),
    ('compliance-evidence', ag::text || '/_cpd/' || oth::text || '/7-not-hers.pdf', jo, jo::text, now()),
    ('compliance-evidence', ag::text || '/_licences/' || jo::text || '/8-licence.pdf', jo, jo::text, now()),
    ('compliance-evidence', jf || '9-for-lic.pdf',    jo,  jo::text,  now());
  insert into public.cpd_records (id, agency_id, profile_id, activity_name, category, created_by, evidence_path, evidence_file_name)
  values (rec, ag, jo, 'On record (made up)', 'general', jo, jf || '3-on-record.pdf', '3-on-record.pdf'),
         (gen_random_uuid(), ag, jo, 'Was on record (made up)', 'general', jo, jf || '4-was-on.pdf', '4-was-on.pdf');
  -- 4 leaves its record: the certificate is taken off.
  update public.cpd_records set evidence_path = null, evidence_file_name = null where evidence_path = jf || '4-was-on.pdf';

  perform set_config('request.jwt.claims', json_build_object('sub', jo, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. Jo removes her own certificate, just uploaded, never saved.
  with d as (delete from storage.objects where name = jf || '1-fresh.pdf' returning 1) select count(*) into n from d;
  if n <> 1 then raise exception 'FAIL 1: Jo could not remove her own unsaved upload'; end if;

  -- 2. Not after the hour.
  with d as (delete from storage.objects where name = jf || '2-old.pdf' returning 1) select count(*) into n from d;
  if n <> 0 then raise exception 'FAIL 2: an upload older than an hour was removed'; end if;

  -- 3. Not a certificate on a CPD record.
  with d as (delete from storage.objects where name = jf || '3-on-record.pdf' returning 1) select count(*) into n from d;
  if n <> 0 then raise exception 'FAIL 3: a certificate on a record was removed'; end if;

  -- 4. Not one that was on a record and was taken off.
  with d as (delete from storage.objects where name = jf || '4-was-on.pdf' returning 1) select count(*) into n from d;
  if n <> 0 then raise exception 'FAIL 4: a certificate once on a record was removed'; end if;

  -- 5. Not one someone else uploaded, even in her own folder.
  with d as (delete from storage.objects where name = jf || '5-by-lic.pdf' returning 1) select count(*) into n from d;
  if n <> 0 then raise exception 'FAIL 5: Jo removed a file the licensee uploaded'; end if;

  -- 6. Not deeper in the folder, and 7. not in someone else's CPD folder.
  with d as (delete from storage.objects where name = jf || 'sub/6-deeper.pdf' returning 1) select count(*) into n from d;
  if n <> 0 then raise exception 'FAIL 6: a file below her CPD folder was removed'; end if;
  with d as (delete from storage.objects where name like '%/7-not-hers.pdf' returning 1) select count(*) into n from d;
  if n <> 0 then raise exception 'FAIL 7: a file in another agent''s CPD folder was removed'; end if;

  -- 8. This rule is for CPD only: her licence folder is not opened by it.
  with d as (delete from storage.objects where name like '%/8-licence.pdf'
               and not exists (select 1 from pg_policy where polname = 'compliance-evidence: own refused licence upload can be removed')
             returning 1) select count(*) into n from d;
  if n <> 0 then raise exception 'FAIL 8: the CPD rule removed a file outside the CPD folder'; end if;

  -- 9. Another agent can't remove Jo's upload.
  perform set_config('request.jwt.claims', json_build_object('sub', oth, 'role', 'authenticated')::text, true);
  with d as (delete from storage.objects where name = jf || '9-for-lic.pdf' returning 1) select count(*) into n from d;
  if n <> 0 then raise exception 'FAIL 9: another agent removed Jo''s upload'; end if;

  -- 10. The licensee still can (0058, unchanged).
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  with d as (delete from storage.objects where name = jf || '9-for-lic.pdf' returning 1) select count(*) into n from d;
  if n <> 1 then raise exception 'FAIL 10: the licensee could not remove a file'; end if;

  reset role;

  -- 11. Deleting a CPD record writes its certificate down too.
  delete from public.cpd_records where id = rec;
  if not exists (select 1 from public.evidence_files_once_on_record where name = jf || '3-on-record.pdf') then
    raise exception 'FAIL 11: a deleted record''s certificate was not written down';
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'Own CPD upload: all checks passed';
end $$;

select 'Own CPD upload: all checks passed' as result;

rollback;
