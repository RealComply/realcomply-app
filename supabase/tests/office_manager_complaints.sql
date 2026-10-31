-- ===== READ ONLY. Office managers on the Complaints register, 31 October 2026 =====
--
-- Proves supabase/migrations/0102_office_manager_complaints.sql: an approved
-- office manager reads the complaints register and adds to it ("adding and
-- read only", Adam 31 Oct 2026), and nothing more. Run after it. Safe on the
-- live database: everything happens inside one transaction that is rolled back
-- at the end, so the made-up offices and people never exist outside it.
--
-- Pass: the last line says "Office manager complaints: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1 uuid := gen_random_uuid();   -- an office
  o2 uuid := gen_random_uuid();   -- another office
  l   uuid := gen_random_uuid();  -- o1's licensee in charge
  m   uuid := gen_random_uuid();  -- o1's office manager
  a   uuid := gen_random_uuid();  -- an agent in o1
  w   uuid := gen_random_uuid();  -- o1's former office manager (withdrawn)
  x   uuid := gen_random_uuid();  -- o2's licensee in charge
  y   uuid := gen_random_uuid();  -- o2's office manager
  pm  uuid := gen_random_uuid();  -- a listing of the office manager's own, in o1
  pa  uuid := gen_random_uuid();  -- the agent's listing in o1
  c1  uuid := gen_random_uuid();  -- an open complaint in o1
  c2  uuid := gen_random_uuid();  -- a resolved complaint in o1
  c9  uuid := gen_random_uuid();  -- a complaint in o2
  cm  uuid;                       -- the complaint the office manager logs
  f1  uuid;                       -- the licensee's file on c1
  fm  uuid;                       -- the office manager's file on c1
  n integer;
  who uuid;
  at timestamptz;
  st text;
begin
  insert into auth.users (id, email) values
    (l, 'omc-l@example.invalid'), (m, 'omc-m@example.invalid'), (a, 'omc-a@example.invalid'),
    (w, 'omc-w@example.invalid'), (x, 'omc-x@example.invalid'), (y, 'omc-y@example.invalid');
  insert into public.agencies (id, name, plan, status) values
    (o1, 'OMC Office One', 'office_1', 'active'),
    (o2, 'OMC Office Two', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (l, o1, 'Lee Licensee', 'omc-l@example.invalid', true, true, false),
    (m, o1, 'Max Manager', 'omc-m@example.invalid', true, false, false),
    (a, o1, 'Ana Agent', 'omc-a@example.invalid', true, false, false),
    (w, o1, 'Wren Former', 'omc-w@example.invalid', true, false, false),
    (x, o2, 'Xan Elsewhere', 'omc-x@example.invalid', true, true, false),
    (y, o2, 'Yui Elsewhere', 'omc-y@example.invalid', true, false, false);
  insert into public.office_managers (agency_id, profile_id, wording, approved_via, approved_by, approved_by_name) values
    (o1, m, 'I authorise Max Manager to manage OMC Office One''s RealComply account as office manager.', 'team', l, 'Lee Licensee'),
    (o2, y, 'I authorise Yui Elsewhere to manage OMC Office Two''s RealComply account as office manager.', 'team', x, 'Xan Elsewhere');
  insert into public.office_managers (agency_id, profile_id, wording, approved_via, approved_by, approved_by_name,
                                      withdrawn_at, withdrawn_via, withdrawn_by, withdrawn_by_name)
  values (o1, w, 'I authorise Wren Former to manage OMC Office One''s RealComply account as office manager.', 'team', l,
          'Lee Licensee', now(), 'team', l, 'Lee Licensee');
  insert into public.properties (id, agency_id, created_by, address) values
    (pm, o1, m, '1 Made Up Street, Nowhere NSW (made up)'),
    (pa, o1, a, '2 Made Up Street, Nowhere NSW (made up)');
  insert into public.complaints (id, agency_id, received_date, complainant, nature, status, resolved_date, created_by) values
    (c1, o1, date '2026-10-12', 'K. Adams, buyer (made up)', 'Not told about the strata report', 'open', null, l),
    (c2, o1, date '2026-10-02', 'P. Lim, vendor (made up)', 'Slow to return calls', 'resolved', date '2026-10-20', l),
    (c9, o2, date '2026-10-14', 'R. Diaz, buyer (made up)', 'Deposit question', 'open', null, x);

  -- The licensee adds a file to c1, and removes another, so the office
  -- manager has both kinds to read.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.complaint_files (agency_id, complaint_id, file_path, file_name)
  values (o1, c1, o1 || '/_complaints/' || c1 || '/1-complaint-email.eml', 'complaint-email.eml')
  returning id into f1;
  insert into public.complaint_files (agency_id, complaint_id, file_path, file_name)
  values (o1, c1, o1 || '/_complaints/' || c1 || '/2-wrong-file.pdf', 'wrong-file.pdf');
  update public.complaint_files set removed_at = now() where file_path = o1 || '/_complaints/' || c1 || '/2-wrong-file.pdf';
  reset role;
  insert into storage.objects (bucket_id, name, owner_id) values
    ('compliance-evidence', o1 || '/_complaints/' || c1 || '/1-complaint-email.eml', l::text);

  -- 1. The office manager reads the whole register: every complaint, open and
  --    resolved, and every file, removed ones included. Nothing of o2's.
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.complaints;
  if n <> 2 then raise exception 'FAIL 1: the office manager sees % complaints, expected 2', n; end if;
  select count(*) into n from public.complaint_files;
  if n <> 2 then raise exception 'FAIL 1b: the office manager sees % complaint files, expected 2', n; end if;
  if exists (select 1 from public.complaints where agency_id = o2) then
    raise exception 'FAIL 1c: the office manager sees another office''s complaint';
  end if;

  -- 2. Logs a new complaint: Open, logged by them, linked to their own listing.
  insert into public.complaints (agency_id, received_date, complainant, nature, property_id, status, created_by)
  values (o1, date '2026-10-30', 'J. Okafor, buyer (made up)', 'Open home ran late', pm, 'open', m)
  returning id into cm;
  if cm is null then raise exception 'FAIL 2: the office manager could not log a complaint'; end if;

  -- 2b. But not one that is already resolved or under review, not as someone
  --     else, not in another office, and not on a listing they can't open.
  begin
    insert into public.complaints (agency_id, received_date, complainant, nature, status, resolved_date, created_by)
    values (o1, date '2026-10-30', 'Made up', 'x', 'resolved', date '2026-10-30', m);
    raise exception 'FAIL 2b: the office manager logged a resolved complaint';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into public.complaints (agency_id, received_date, complainant, nature, status, created_by)
    values (o1, date '2026-10-30', 'Made up', 'x', 'under_review', m);
    raise exception 'FAIL 2c: the office manager logged a complaint as under review';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into public.complaints (agency_id, received_date, complainant, nature, status, resolved_date, created_by)
    values (o1, date '2026-10-30', 'Made up', 'x', 'open', date '2026-10-30', m);
    raise exception 'FAIL 2d: the office manager logged a complaint with a resolved date';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into public.complaints (agency_id, received_date, complainant, nature, status, created_by)
    values (o1, date '2026-10-30', 'Made up', 'x', 'open', l);
    raise exception 'FAIL 2e: the office manager logged a complaint as the licensee';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into public.complaints (agency_id, received_date, complainant, nature, status, created_by)
    values (o2, date '2026-10-30', 'Made up', 'x', 'open', m);
    raise exception 'FAIL 2f: the office manager logged a complaint in another office';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into public.complaints (agency_id, received_date, complainant, nature, property_id, status, created_by)
    values (o1, date '2026-10-30', 'Made up', 'x', pa, 'open', m);
    raise exception 'FAIL 2g: the office manager linked a complaint to a listing they can''t open';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 3. Can't Review, Resolve or Remove a complaint, theirs included.
  update public.complaints set status = 'under_review' where id in (c1, cm);
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 3: the office manager changed % complaints', n; end if;
  update public.complaints set status = 'resolved', resolved_date = current_date where id in (c1, cm);
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 3b: the office manager resolved % complaints', n; end if;
  update public.complaints set nature = 'Changed' where id = c2;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 3c: the office manager edited a complaint'; end if;
  delete from public.complaints where id in (c1, c2, cm);
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 3d: the office manager deleted % complaints', n; end if;

  -- 4. Adds files: to an open complaint and to a resolved one. Who and when
  --    are the database's, not whatever was sent.
  insert into public.complaint_files (agency_id, complaint_id, file_path, file_name, added_by, added_at)
  values (o1, c1, o1 || '/_complaints/' || c1 || '/3-reply.pdf', 'reply.pdf', l, '2001-01-01')
  returning id into fm;
  insert into public.complaint_files (agency_id, complaint_id, file_path, file_name)
  values (o1, c2, o1 || '/_complaints/' || c2 || '/1-outcome-letter.pdf', 'outcome-letter.pdf');
  reset role;
  select added_by, added_at into who, at from public.complaint_files where id = fm;
  if who is distinct from m then raise exception 'FAIL 4: added_by is %, not the office manager', who; end if;
  if at < now() - interval '1 minute' then raise exception 'FAIL 4b: added_at was taken from the caller'; end if;

  -- 4c. Only in that complaint's own folder in this office, never removed.
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.complaint_files (agency_id, complaint_id, file_path, file_name)
    values (o1, c1, o1 || '/_complaints/' || c2 || '/x.pdf', 'x.pdf');
    raise exception 'FAIL 4c: a file was put in another complaint''s folder';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into public.complaint_files (agency_id, complaint_id, file_path, file_name)
    values (o2, c9, o2 || '/_complaints/' || c9 || '/x.pdf', 'x.pdf');
    raise exception 'FAIL 4d: a file was added to another office''s complaint';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into public.complaint_files (agency_id, complaint_id, file_path, file_name, removed_at)
    values (o1, c1, o1 || '/_complaints/' || c1 || '/4-x.pdf', 'x.pdf', now());
    raise exception 'FAIL 4e: a file started out removed';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 5. Can't remove a file, theirs included, and can't delete a file's record.
  update public.complaint_files set removed_at = now() where id in (f1, fm);
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 5: the office manager removed % files', n; end if;
  begin
    delete from public.complaint_files where id in (f1, fm);
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL 5b: the office manager deleted a file''s record'; end if;
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;
  select count(*) into n from public.complaint_files where id in (f1, fm) and removed_at is null;
  if n <> 2 then raise exception 'FAIL 5c: a file came off its complaint'; end if;

  -- 6. Storage: opens the files; adds new ones straight inside a complaint's
  --    folder on this register; never replaces one.
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.evidence_path_readable(o1 || '/_complaints/' || c1 || '/1-complaint-email.eml') then
    raise exception 'FAIL 6: the office manager can''t open a complaint''s file';
  end if;
  select count(*) into n from storage.objects where name = o1 || '/_complaints/' || c1 || '/1-complaint-email.eml';
  if n <> 1 then raise exception 'FAIL 6b: the office manager can''t see the stored file'; end if;
  if public.evidence_path_writable(o1 || '/_complaints/' || c1 || '/1-complaint-email.eml') then
    raise exception 'FAIL 6c: the office manager can replace a complaint''s file';
  end if;
  if not public.complaint_file_addable(o1 || '/_complaints/' || c1 || '/5-new.pdf')
     or not public.complaint_file_addable(o1 || '/_complaints/' || cm || '/1-new.pdf') then
    raise exception 'FAIL 6d: the office manager can''t add a file to a complaint';
  end if;
  if public.complaint_file_addable(o1 || '/_complaints/' || gen_random_uuid() || '/x.pdf')
     or public.complaint_file_addable(o1 || '/_complaints/' || c1 || '/deeper/x.pdf')
     or public.complaint_file_addable(o1 || '/_complaints/x.pdf')
     or public.complaint_file_addable(o2 || '/_complaints/' || c9 || '/x.pdf')
     or public.complaint_file_addable(o1 || '/_sg-manual/x.pdf') then
    raise exception 'FAIL 6e: the office manager can add a file outside a complaint''s own folder';
  end if;
  insert into storage.objects (bucket_id, name, owner_id)
  values ('compliance-evidence', o1 || '/_complaints/' || c1 || '/5-new.pdf', m::text);
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('compliance-evidence', o1 || '/_complaints/' || gen_random_uuid() || '/x.pdf', m::text);
    raise exception 'FAIL 6f: a file went into the folder of a complaint that isn''t on the register';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  update storage.objects set metadata = '{"size": 5}'::jsonb
   where name = o1 || '/_complaints/' || c1 || '/1-complaint-email.eml';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 6g: the office manager replaced a stored complaint file'; end if;
  update storage.objects set name = o1 || '/_complaints/' || c1 || '/moved.eml'
   where name = o1 || '/_complaints/' || c1 || '/1-complaint-email.eml';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 6h: the office manager moved a stored complaint file'; end if;

  -- 7. Deleting in Storage: never a file on the register; only their own
  --    upload that never made it onto it, within 15 minutes.
  delete from storage.objects where name = o1 || '/_complaints/' || c1 || '/1-complaint-email.eml';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 7: the office manager deleted a file on the register'; end if;
  reset role;
  insert into storage.objects (bucket_id, name, owner_id, created_at) values
    ('compliance-evidence', o1 || '/_complaints/' || c1 || '/3-reply.pdf', m::text, now()),
    ('compliance-evidence', o1 || '/_complaints/' || c1 || '/6-old.pdf', m::text, now() - interval '20 minutes'),
    ('compliance-evidence', o1 || '/_complaints/' || c1 || '/7-licensees.pdf', l::text, now());
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from storage.objects where name = o1 || '/_complaints/' || c1 || '/3-reply.pdf';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 7b: the office manager deleted their own file once it was on the register'; end if;
  delete from storage.objects where name = o1 || '/_complaints/' || c1 || '/6-old.pdf';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 7c: the office manager deleted an unrecorded file after 15 minutes'; end if;
  delete from storage.objects where name = o1 || '/_complaints/' || c1 || '/7-licensees.pdf';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 7d: the office manager deleted someone else''s upload'; end if;
  delete from storage.objects where name = o1 || '/_complaints/' || c1 || '/5-new.pdf';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 7e: the office manager could not take back their own unrecorded upload'; end if;
  reset role;
  select count(*) into n from public.deletion_log
   where agency_id = o1 and what = 'file' and refs ->> 'folder' = '_complaints' and deleted_by = m;
  if n <> 1 then raise exception 'FAIL 7f: the taken-back upload was not logged (% rows)', n; end if;

  -- 8. Nobody else gained anything: an agent, a former office manager, and
  --    another office's office manager see none of it and add nothing.
  foreach who in array array[a, w, y] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.complaints where agency_id = o1;
    if n <> 0 then raise exception 'FAIL 8: % sees % of o1''s complaints', who, n; end if;
    select count(*) into n from public.complaint_files where agency_id = o1;
    if n <> 0 then raise exception 'FAIL 8b: % sees % of o1''s complaint files', who, n; end if;
    begin
      insert into public.complaints (agency_id, received_date, complainant, nature, status, created_by)
      values (o1, date '2026-10-30', 'Made up', 'x', 'open', who);
      raise exception 'FAIL 8c: % logged a complaint in o1', who;
    exception when others then
      if sqlerrm like 'FAIL%' then raise; end if;
    end;
    begin
      insert into public.complaint_files (agency_id, complaint_id, file_path, file_name)
      values (o1, c1, o1 || '/_complaints/' || c1 || '/9-x.pdf', 'x.pdf');
      raise exception 'FAIL 8d: % added a file in o1', who;
    exception when others then
      if sqlerrm like 'FAIL%' then raise; end if;
    end;
    if public.evidence_path_readable(o1 || '/_complaints/' || c1 || '/1-complaint-email.eml')
       or public.complaint_file_addable(o1 || '/_complaints/' || c1 || '/9-x.pdf') then
      raise exception 'FAIL 8e: % can reach o1''s complaints folder', who;
    end if;
    begin
      insert into storage.objects (bucket_id, name, owner_id)
      values ('compliance-evidence', o1 || '/_complaints/' || c1 || '/9-x.pdf', who::text);
      raise exception 'FAIL 8f: % uploaded into o1''s complaints folder', who;
    exception when others then
      if sqlerrm like 'FAIL%' then raise; end if;
    end;
    reset role;
  end loop;

  -- 9. The licensee keeps everything, the office manager's additions included.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.complaints;
  if n <> 3 then raise exception 'FAIL 9: the licensee sees % complaints, expected 3', n; end if;
  update public.complaints set status = 'resolved', resolved_date = current_date where id = cm;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 9b: the licensee could not resolve the office manager''s complaint'; end if;
  update public.complaint_files set removed_at = now() where id = fm;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 9c: the licensee could not remove the office manager''s file'; end if;
  if not public.evidence_path_writable(o1 || '/_complaints/' || c1 || '/8-new.pdf') then
    raise exception 'FAIL 9d: the licensee lost the complaints folder';
  end if;
  reset role;
  select status into st from public.complaints where id = cm;
  if st <> 'resolved' then raise exception 'FAIL 9e: the complaint is %', st; end if;

  -- 10. Once the subscription has ended, the office manager adds nothing.
  perform set_config('request.jwt.claims', '', true);
  update public.agencies set status = 'canceled' where id = o1;
  if not public.agency_has_ended(o1) then raise exception 'FAIL 10 setup: the office did not end'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.complaints (agency_id, received_date, complainant, nature, status, created_by)
    values (o1, date '2026-10-31', 'Made up', 'x', 'open', m);
    raise exception 'FAIL 10: a complaint was logged after the subscription ended';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into public.complaint_files (agency_id, complaint_id, file_path, file_name)
    values (o1, c1, o1 || '/_complaints/' || c1 || '/10-x.pdf', 'x.pdf');
    raise exception 'FAIL 10b: a file was added after the subscription ended';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('compliance-evidence', o1 || '/_complaints/' || c1 || '/10-x.pdf', m::text);
    raise exception 'FAIL 10c: a file was uploaded after the subscription ended';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;

  raise notice 'Office manager complaints: all checks passed';
end $$;

rollback;
