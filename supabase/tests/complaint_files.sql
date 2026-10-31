-- ===== READ ONLY. Files on a complaint, 30 October 2026 =====
--
-- Proves supabase/migrations/0101_complaint_files.sql. Run after it, and
-- after 0102: since 31 Oct 2026 an office manager reads the register and adds
-- to it (supabase/tests/office_manager_complaints.sql proves that part), so
-- here they are only checked for what stays the licensee's. Safe on the live
-- database: everything happens inside one transaction that is rolled back at
-- the end, so the made-up offices and people never exist outside it.
--
-- Pass: the last line says "Complaint files: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1 uuid := gen_random_uuid();   -- an office
  o2 uuid := gen_random_uuid();   -- another office
  o3 uuid := gen_random_uuid();   -- an agent's own plan
  l   uuid := gen_random_uuid();  -- o1's licensee in charge
  a   uuid := gen_random_uuid();  -- an agent in o1
  m   uuid := gen_random_uuid();  -- o1's office manager
  x   uuid := gen_random_uuid();  -- o2's licensee in charge
  g   uuid := gen_random_uuid();  -- the agent on o3, their own plan
  c1  uuid := gen_random_uuid();  -- a complaint in o1
  c3  uuid := gen_random_uuid();  -- another complaint in o1
  c2  uuid := gen_random_uuid();  -- a complaint in o2
  f1  uuid;
  f2  uuid;
  n integer;
  who uuid;
  at timestamptz;
  rec jsonb;
begin
  insert into auth.users (id, email) values
    (l, 'cf-l@example.invalid'), (a, 'cf-a@example.invalid'), (m, 'cf-m@example.invalid'),
    (x, 'cf-x@example.invalid'), (g, 'cf-g@example.invalid');
  insert into public.agencies (id, name, plan, status) values
    (o1, 'CF Office One', 'office_1', 'active'),
    (o2, 'CF Office Two', 'office_1', 'active'),
    (o3, 'CF Own Plan', 'agent_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (l, o1, 'Lee Licensee', 'cf-l@example.invalid', true, true, false),
    (a, o1, 'Ana Agent', 'cf-a@example.invalid', true, false, false),
    (m, o1, 'Max Manager', 'cf-m@example.invalid', true, false, false),
    (x, o2, 'Xan Elsewhere', 'cf-x@example.invalid', true, true, false),
    (g, o3, 'Gus Contractor', 'cf-g@example.invalid', true, false, false);
  insert into public.office_managers (agency_id, profile_id, wording, approved_via, approved_by, approved_by_name)
  values (o1, m, 'I authorise Max Manager to manage CF Office One''s RealComply account as office manager.',
          'team', l, 'Lee Licensee');
  insert into public.complaints (id, agency_id, received_date, complainant, nature, status, created_by) values
    (c1, o1, date '2026-10-12', 'K. Adams, buyer (made up)', 'Not told about the strata report', 'open', l),
    (c3, o1, date '2026-10-20', 'P. Lim, vendor (made up)', 'Slow to return calls', 'open', l),
    (c2, o2, date '2026-10-14', 'R. Diaz, tenant (made up)', 'Bond question', 'open', x);

  -- 1. The licensee adds two files. Who and when are the database's, not
  --    whatever was sent.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.complaint_files (agency_id, complaint_id, file_path, file_name, size_bytes, added_by, added_at)
  values (o1, c1, o1 || '/_complaints/' || c1 || '/1-complaint-email.eml', 'complaint-email.eml', 2048, a, '2001-01-01')
  returning id into f1;
  insert into public.complaint_files (agency_id, complaint_id, file_path, file_name, size_bytes)
  values (o1, c1, o1 || '/_complaints/' || c1 || '/2-photo.jpg', 'photo.jpg', 4096)
  returning id into f2;
  reset role;
  select added_by, added_at into who, at from public.complaint_files where id = f1;
  if who is distinct from l then raise exception 'FAIL 1: added_by is %, not the licensee', who; end if;
  if at < now() - interval '1 minute' then raise exception 'FAIL 1b: added_at was taken from the caller'; end if;

  -- 2. And a third later, on the same complaint, while it is resolved.
  update public.complaints set status = 'resolved', resolved_date = date '2026-10-28' where id = c1;
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.complaint_files (agency_id, complaint_id, file_path, file_name)
  values (o1, c1, o1 || '/_complaints/' || c1 || '/3-outcome-letter.pdf', 'outcome-letter.pdf');
  select count(*) into n from public.complaint_files where complaint_id = c1;
  if n <> 3 then raise exception 'FAIL 2: the licensee sees % files, expected 3', n; end if;

  -- 3. Only in that complaint's own folder in this office.
  begin
    insert into public.complaint_files (agency_id, complaint_id, file_path, file_name)
    values (o1, c1, o1 || '/_complaints/' || c3 || '/x.pdf', 'x.pdf');
    raise exception 'FAIL 3: a file was put in another complaint''s folder';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into public.complaint_files (agency_id, complaint_id, file_path, file_name)
    values (o1, c1, o1 || '/_signoffs/x.pdf', 'x.pdf');
    raise exception 'FAIL 3b: a file outside the complaints folder was recorded';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into public.complaint_files (agency_id, complaint_id, file_path, file_name)
    values (o1, c1, o1 || '/_complaints/' || c1 || '/../../' || o2 || '/x.pdf', 'x.pdf');
    raise exception 'FAIL 3c: a path climbing out of the folder was recorded';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into public.complaint_files (agency_id, complaint_id, file_path, file_name)
    values (o1, c2, o1 || '/_complaints/' || c2 || '/x.pdf', 'x.pdf');
    raise exception 'FAIL 3d: a file was added to another office''s complaint';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into public.complaint_files (agency_id, complaint_id, file_path, file_name)
    values (o2, c2, o2 || '/_complaints/' || c2 || '/x.pdf', 'x.pdf');
    raise exception 'FAIL 3e: a file was added to another office';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into public.complaint_files (agency_id, complaint_id, file_path, file_name, removed_at)
    values (o1, c1, o1 || '/_complaints/' || c1 || '/4-x.pdf', 'x.pdf', now());
    raise exception 'FAIL 3f: a file started out removed';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;

  -- 4. An agent, another office's licensee and the agent on their own plan
  --    see none of them and can add none. (The office manager reads and adds
  --    since 0102; they can't remove one, 4d below.)
  foreach who in array array[a, x, g] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.complaint_files;
    if n <> 0 then raise exception 'FAIL 4: % sees % complaint files', who, n; end if;
    begin
      insert into public.complaint_files (agency_id, complaint_id, file_path, file_name)
      values (o1, c1, o1 || '/_complaints/' || c1 || '/9-x.pdf', 'x.pdf');
      raise exception 'FAIL 4b: % added a complaint file', who;
    exception when others then
      if sqlerrm like 'FAIL%' then raise; end if;
    end;
    update public.complaint_files set removed_at = now() where id = f2;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL 4c: % removed a complaint file', who; end if;
    reset role;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.complaint_files set removed_at = now() where id = f2;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 4d: the office manager removed a complaint file'; end if;
  reset role;

  -- 5. The complaints folder in Storage: the licensee in charge's. Not the
  --    agent, another office, or an agent plan's own complaints folder. The
  --    office manager opens the files there since 0102, and can't replace one.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.evidence_path_readable(o1 || '/_complaints/' || c1 || '/2-photo.jpg')
     or not public.evidence_path_writable(o1 || '/_complaints/' || c1 || '/5-new.pdf') then
    raise exception 'FAIL 5: the licensee can''t use the complaints folder';
  end if;
  reset role;
  foreach who in array array[a, x] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    if public.evidence_path_readable(o1 || '/_complaints/' || c1 || '/2-photo.jpg')
       or public.evidence_path_writable(o1 || '/_complaints/' || c1 || '/5-new.pdf') then
      raise exception 'FAIL 5b: % can reach the complaints folder', who;
    end if;
    reset role;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.evidence_path_readable(o1 || '/_sg-manual/1-manual.pdf') then
    raise exception 'FAIL 5c: the office manager lost the rest of the office''s records';
  end if;
  if public.evidence_path_writable(o1 || '/_complaints/' || c1 || '/2-photo.jpg') then
    raise exception 'FAIL 5f: the office manager can replace a complaint''s file';
  end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', g, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.evidence_path_writable(o3 || '/_complaints/' || gen_random_uuid() || '/x.pdf') then
    raise exception 'FAIL 5d: the agent on their own plan can file complaint files';
  end if;
  if not public.evidence_path_writable(o3 || '/_cpd/' || g || '/x.pdf') then
    raise exception 'FAIL 5e: the agent on their own plan lost their own folder';
  end if;
  reset role;

  -- 6. Deleting a stored complaint file: the licensee in charge, not anyone else.
  insert into storage.objects (bucket_id, name, owner_id) values
    ('compliance-evidence', o1 || '/_complaints/' || c1 || '/2-photo.jpg', l::text),
    ('compliance-evidence', o3 || '/_complaints/' || c1 || '/left-over.pdf', g::text);
  foreach who in array array[a, m, x] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    delete from storage.objects where name = o1 || '/_complaints/' || c1 || '/2-photo.jpg';
    get diagnostics n = row_count;
    reset role;
    if n <> 0 then raise exception 'FAIL 6: % deleted a stored complaint file', who; end if;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', g, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from storage.objects where name = o3 || '/_complaints/' || c1 || '/left-over.pdf';
  get diagnostics n = row_count;
  reset role;
  if n <> 0 then raise exception 'FAIL 6b: the agent on their own plan deleted from a complaints folder'; end if;

  -- 7. The licensee removes one. Who and when are the database's; the record
  --    stays; it can't be changed again; nothing else can change; nobody deletes.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.complaint_files set removed_at = '2001-01-01', removed_by = a where id = f2;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 7: the licensee could not remove a file'; end if;
  delete from storage.objects where name = o1 || '/_complaints/' || c1 || '/2-photo.jpg';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 7b: the licensee could not delete the stored file'; end if;
  begin
    update public.complaint_files set removed_at = null, removed_by = null where id = f2;
    raise exception 'FAIL 7c: a removed file came back';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    update public.complaint_files set file_name = 'renamed.eml' where id = f1;
    raise exception 'FAIL 7d: a file was renamed';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    update public.complaint_files set file_path = o1 || '/_complaints/' || c1 || '/other.eml' where id = f1;
    raise exception 'FAIL 7e: a file''s path was changed';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    update public.complaint_files set removed_by = l where id = f1;
    raise exception 'FAIL 7f: removed_by was set without removing';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    delete from public.complaint_files where id = f1;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL 7g: a complaint file record was deleted'; end if;
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;
  if not exists (select 1 from public.complaint_files where id = f1) then
    raise exception 'FAIL 7g: a complaint file record was deleted';
  end if;
  select removed_by, removed_at into who, at from public.complaint_files where id = f2;
  if who is distinct from l then raise exception 'FAIL 7h: removed_by is %, not the licensee', who; end if;
  if at < now() - interval '1 minute' then raise exception 'FAIL 7i: removed_at was taken from the caller'; end if;
  select count(*) into n from public.deletion_log
   where agency_id = o1 and what = 'file' and refs ->> 'folder' = '_complaints' and deleted_by = l;
  if n <> 1 then raise exception 'FAIL 7j: the stored file''s deletion was not logged (% rows)', n; end if;

  -- 8. A complaint with files on it stays until its files are removed. Then it
  --    can go, and the record of its removed files stays.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    delete from public.complaints where id = c1;
    raise exception 'FAIL 8: a complaint with files on it was deleted';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  update public.complaint_files set removed_at = now() where complaint_id = c1 and removed_at is null;
  delete from public.complaints where id = c1;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 8b: the complaint could not be deleted once its files were removed'; end if;
  select count(*) into n from public.complaint_files where agency_id = o1 and complaint_id is null and removed_at is not null;
  if n <> 3 then raise exception 'FAIL 8c: % removed-file records kept, expected 3', n; end if;
  -- A complaint that never had files is deleted as before.
  delete from public.complaints where id = c3;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 8d: a complaint with no files could not be deleted'; end if;
  reset role;

  -- 9. The 7-year activity record: who and when, never the file's name.
  rec := public.build_activity_record(o1);
  if jsonb_array_length(rec -> 'complaint_files') <> 3 then
    raise exception 'FAIL 9: the activity record holds % complaint files', jsonb_array_length(rec -> 'complaint_files');
  end if;
  if rec::text like '%complaint-email%' or rec::text like '%photo.jpg%' or rec::text like '%outcome-letter%' then
    raise exception 'FAIL 9b: a file name reached the activity record';
  end if;

  -- 10. Once the subscription has ended, nothing is added or removed.
  perform set_config('request.jwt.claims', '', true);
  insert into public.complaints (id, agency_id, received_date, complainant, nature, status, created_by)
  values (c3, o1, date '2026-10-29', 'Q. Ng (made up)', 'Late call back', 'open', l);
  -- Ended the way Stripe ends one (0054's trigger sets ended_at).
  update public.agencies set status = 'canceled' where id = o1;
  if not public.agency_has_ended(o1) then raise exception 'FAIL 10 setup: the office did not end'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.complaint_files (agency_id, complaint_id, file_path, file_name)
    values (o1, c3, o1 || '/_complaints/' || c3 || '/1-x.pdf', 'x.pdf');
    raise exception 'FAIL 10: a file was added after the subscription ended';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;

  raise notice 'Complaint files: all checks passed';
end $$;

rollback;
