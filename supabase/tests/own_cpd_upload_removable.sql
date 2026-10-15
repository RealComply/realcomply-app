-- ===== READ ONLY. Your own unsaved CPD certificate test, 15 October 2026 =====
--
-- Proves supabase/migrations/0075_own_cpd_upload_removable.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up office and people it creates
-- never exist outside it.
--
-- It asks the rule itself (own_cpd_upload_deletable, which the storage
-- policy calls) about made-up file names. It never touches Storage: Supabase
-- refuses deletes from its storage tables in SQL, rightly, so the real delete
-- is shown in the preview test instead, through the app.
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
  fresh timestamptz := now() - interval '5 minutes';
  q text;
begin
  -- 1. The storage rule is on, for deletes, and calls the check.
  select pg_get_expr(polqual, polrelid) into q from pg_policy
   where polrelid = 'storage.objects'::regclass
     and polname = 'compliance-evidence: own unsaved CPD certificate can be removed'
     and polcmd = 'd';
  if q is null or q not like '%own_cpd_upload_deletable%' then
    raise exception 'FAIL 1: the storage rule is missing or does not call the check';
  end if;
  -- ...and the licensee's own rule is still there (0058, unchanged).
  if not exists (select 1 from pg_policy where polrelid = 'storage.objects'::regclass
                    and polname = 'compliance-evidence: licensee can delete') then
    raise exception 'FAIL 1: the licensee''s delete rule is missing';
  end if;

  insert into auth.users (id, email) values
    (lic, 'oc-lic@example.invalid'), (jo, 'oc-jo@example.invalid'), (oth, 'oc-oth@example.invalid');
  insert into public.agencies (id, name, plan, status) values (ag, 'OC Property (made up)', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent) values
    (lic, ag, 'OC Licensee', 'oc-lic@example.invalid', true, false, true),
    (jo, ag, 'Jo Bennett', 'oc-jo@example.invalid', false, false, true),
    (oth, ag, 'OC Other', 'oc-oth@example.invalid', false, false, true);
  jf := ag::text || '/_cpd/' || jo::text || '/';

  insert into public.cpd_records (id, agency_id, profile_id, activity_name, category, created_by, evidence_path, evidence_file_name)
  values (rec, ag, jo, 'On record (made up)', 'general', jo, jf || '3-on-record.pdf', '3-on-record.pdf'),
         (gen_random_uuid(), ag, jo, 'Was on record (made up)', 'general', jo, jf || '4-was-on.pdf', '4-was-on.pdf');
  -- 4 leaves its record: the certificate is taken off.
  update public.cpd_records set evidence_path = null, evidence_file_name = null where evidence_path = jf || '4-was-on.pdf';

  perform set_config('request.jwt.claims', json_build_object('sub', jo, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 2. Jo's own certificate, just uploaded, never saved: she may remove it.
  if not public.own_cpd_upload_deletable(jf || '1-fresh.pdf', jo::text, fresh) then
    raise exception 'FAIL 2: Jo may not remove her own unsaved upload';
  end if;
  -- 3. Not after the hour.
  if public.own_cpd_upload_deletable(jf || '2-old.pdf', jo::text, now() - interval '2 hours') then
    raise exception 'FAIL 3: an upload older than an hour could be removed';
  end if;
  -- 4. Not a certificate on a CPD record.
  if public.own_cpd_upload_deletable(jf || '3-on-record.pdf', jo::text, fresh) then
    raise exception 'FAIL 4: a certificate on a record could be removed';
  end if;
  -- 5. Not one that was on a record and was taken off.
  if public.own_cpd_upload_deletable(jf || '4-was-on.pdf', jo::text, fresh) then
    raise exception 'FAIL 5: a certificate once on a record could be removed';
  end if;
  -- 6. Not one someone else uploaded, even in her own folder.
  if public.own_cpd_upload_deletable(jf || '6-by-lic.pdf', lic::text, fresh) then
    raise exception 'FAIL 6: Jo could remove a file the licensee uploaded';
  end if;
  -- 7. Not deeper in the folder, not in someone else's CPD folder, not her licence folder.
  if public.own_cpd_upload_deletable(jf || 'sub/7-deeper.pdf', jo::text, fresh) then
    raise exception 'FAIL 7: a file below her CPD folder could be removed';
  end if;
  if public.own_cpd_upload_deletable(ag::text || '/_cpd/' || oth::text || '/7-not-hers.pdf', jo::text, fresh) then
    raise exception 'FAIL 7: a file in another agent''s CPD folder could be removed';
  end if;
  if public.own_cpd_upload_deletable(ag::text || '/_licences/' || jo::text || '/7-licence.pdf', jo::text, fresh) then
    raise exception 'FAIL 7: the CPD rule opened her licence folder';
  end if;
  -- 8. Not in another office.
  if public.own_cpd_upload_deletable(gen_random_uuid()::text || '/_cpd/' || jo::text || '/8-other-office.pdf', jo::text, fresh) then
    raise exception 'FAIL 8: a file in another office could be removed';
  end if;

  -- 9. Another agent can't remove Jo's upload.
  perform set_config('request.jwt.claims', json_build_object('sub', oth, 'role', 'authenticated')::text, true);
  if public.own_cpd_upload_deletable(jf || '1-fresh.pdf', jo::text, fresh) then
    raise exception 'FAIL 9: another agent could remove Jo''s upload';
  end if;

  -- 10. Nobody signed in: never.
  perform set_config('request.jwt.claims', '', true);
  if coalesce(public.own_cpd_upload_deletable(jf || '1-fresh.pdf', jo::text, fresh), false) then
    raise exception 'FAIL 10: someone not signed in could remove a file';
  end if;

  reset role;

  -- 11. Deleting a CPD record writes its certificate down too.
  delete from public.cpd_records where id = rec;
  if not exists (select 1 from public.evidence_files_once_on_record where name = jf || '3-on-record.pdf') then
    raise exception 'FAIL 11: a deleted record''s certificate was not written down';
  end if;

  raise notice 'Own CPD upload: all checks passed';
end $$;

select 'Own CPD upload: all checks passed' as result;

rollback;
