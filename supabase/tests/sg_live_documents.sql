-- ===== READ ONLY. Supervision guidelines as a live document, part 1, 10 November 2026 =====
--
-- Proves supabase/migrations/0122_sg_live_documents.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up offices and people it creates
-- never exist outside it.
--
-- Pass: the last line says "Supervision guidelines live document: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1  uuid := gen_random_uuid();  -- the office
  o2  uuid := gen_random_uuid();  -- another office
  lic uuid := gen_random_uuid();  -- o1's licensee in charge
  ag  uuid := gen_random_uuid();  -- o1's agent
  oli uuid := gen_random_uuid();  -- o2's licensee in charge
  d1  uuid;
  d2  uuid;
  d3  uuid;
  mv  uuid;
  n   integer;
  r   record;
  j   jsonb;
  folder text;
begin
  insert into auth.users (id, email) values
    (lic, 'sg-lic@example.invalid'), (ag, 'sg-ag@example.invalid'), (oli, 'sg-oli@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'SG Live Office (made up)', 'office_1', 'active', 'Lou Licensee', 'sg-lou@example.invalid'),
    (o2, 'Other SG Office (made up)', 'office_1', 'active', 'Oli Licensee', 'sg-oli2@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (lic, o1, 'Lou Licensee', 'sg-lic@example.invalid', true, true, false),
    (ag, o1, 'Ana Agent', 'sg-ag@example.invalid', true, false, false),
    (oli, o2, 'Oli Licensee', 'sg-oli@example.invalid', true, true, false);
  folder := o1::text || '/_sg-manual/';

  -- 1. An agent can't start a read.
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.start_sg_document(folder || '1-manual.pdf', 'manual.pdf');
    raise exception 'FAIL 1: an agent started a read';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'Only the licensee in charge%' then raise exception 'FAIL 1: refused with %', sqlerrm; end if;
  end;
  reset role;

  -- 2. The licensee: only their own folder, and only Word (.docx) or PDF.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.start_sg_document(o2::text || '/_sg-manual/1-manual.pdf', 'manual.pdf');
    raise exception 'FAIL 2a: another office''s folder was taken';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%folder%' then raise exception 'FAIL 2a: refused with %', sqlerrm; end if;
  end;
  begin
    perform public.start_sg_document(o1::text || '/somewhere/1-manual.pdf', 'manual.pdf');
    raise exception 'FAIL 2b: a file outside _sg-manual was taken';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%folder%' then raise exception 'FAIL 2b: refused with %', sqlerrm; end if;
  end;
  begin
    perform public.start_sg_document(folder || '1-manual.doc', 'manual.doc');
    raise exception 'FAIL 2c: an old .doc file was taken';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Upload a Word (.docx) or PDF file.' then raise exception 'FAIL 2c: refused with %', sqlerrm; end if;
  end;

  -- 3. A good upload starts a read, stamped with who.
  d1 := public.start_sg_document(folder || '1-manual.pdf', 'Harbour Manual v7.3.pdf');
  select * into r from public.sg_documents where id = d1;
  if r.status <> 'reading' or r.created_by <> lic or r.agency_id <> o1 or r.from_file_on_record then
    raise exception 'FAIL 3: started as %', row_to_json(r); end if;

  -- 4. Signed in, nobody writes a row directly: only through the functions.
  begin
    insert into public.sg_documents (agency_id, file_path, file_name) values (o1, folder || 'x.pdf', 'x.pdf');
    raise exception 'FAIL 4a: a row was inserted directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.sg_documents set status = 'live' where id = d1;
    raise exception 'FAIL 4b: a row was changed directly';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- The app's reader finishes the read (the service key, here the owner).
  update public.sg_documents set status = 'draft', version_read = 'v7.3', read_at = now() where id = d1;
  insert into public.sg_document_sections (document_id, agency_id, position, number, title, paragraphs) values
    (d1, o1, 0, '1', 'Introduction', array['This manual applies to SG Live Office (made up).']),
    (d1, o1, 1, '4', 'Trust money', array['4.1 Money is banked by the next business day.', '4.2 Receipts are reconciled weekly.']);

  -- 5. Drafts: whoever runs the office sees them; an agent doesn't.
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.sg_documents;
  if n <> 0 then raise exception 'FAIL 5a: an agent saw % draft(s)', n; end if;
  select count(*) into n from public.sg_document_sections;
  if n <> 0 then raise exception 'FAIL 5b: an agent saw % draft section(s)', n; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.sg_document_sections where document_id = d1;
  if n <> 2 then raise exception 'FAIL 5c: the licensee saw % section(s)', n; end if;
  reset role;

  -- 6. Another office sees nothing and can't save it.
  perform set_config('request.jwt.claims', json_build_object('sub', oli, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.sg_documents;
  if n <> 0 then raise exception 'FAIL 6a: another office saw % document(s)', n; end if;
  begin
    perform public.save_sg_document(d1, 'sg', 'v7.3');
    raise exception 'FAIL 6b: another office saved it';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%isn''t in this office%' then raise exception 'FAIL 6b: refused with %', sqlerrm; end if;
  end;
  reset role;

  -- 7. Saving needs exactly one kind of document and a version.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.save_sg_document(d1, null, 'v7.3');
    raise exception 'FAIL 7a: saved with no kind of document';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Choose what kind of document this is.' then raise exception 'FAIL 7a: refused with %', sqlerrm; end if;
  end;
  begin
    perform public.save_sg_document(d1, 'manual', 'v7.3');
    raise exception 'FAIL 7b: saved as a kind that isn''t one of the three';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Choose what kind of document this is.' then raise exception 'FAIL 7b: refused with %', sqlerrm; end if;
  end;
  begin
    perform public.save_sg_document(d1, 'sg_and_procedures', '   ');
    raise exception 'FAIL 7c: saved with no version';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Confirm the version number.' then raise exception 'FAIL 7c: refused with %', sqlerrm; end if;
  end;

  -- 8. Saved: live, stamped, and filed as a new SG Manual version for staff to sign.
  j := public.save_sg_document(d1, 'sg_and_procedures', ' v7.3 ');
  if (j ->> 'new_file')::boolean is not true or j ->> 'version_label' <> 'v7.3' then
    raise exception 'FAIL 8a: save said %', j; end if;
  select * into r from public.sg_documents where id = d1;
  if r.status <> 'live' or r.doc_type <> 'sg_and_procedures' or r.version_label <> 'v7.3'
     or r.saved_by <> lic or r.saved_by_name <> 'Lou Licensee' or r.saved_at is null or r.manual_version_id is null then
    raise exception 'FAIL 8b: saved as %', row_to_json(r); end if;
  select count(*) into n from public.sg_manual_versions where agency_id = o1 and file_path = folder || '1-manual.pdf' and version_label = 'v7.3' and uploaded_by = lic;
  if n <> 1 then raise exception 'FAIL 8c: % SG Manual version(s) filed', n; end if;
  begin
    perform public.save_sg_document(d1, 'sg', 'v8');
    raise exception 'FAIL 8d: saved twice';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%already been saved%' then raise exception 'FAIL 8d: refused with %', sqlerrm; end if;
  end;
  reset role;

  -- 9. Now the agent reads the live document and its sections.
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.sg_documents where status = 'live';
  if n <> 1 then raise exception 'FAIL 9a: the agent saw % live document(s)', n; end if;
  select count(*) into n from public.sg_document_sections where document_id = d1;
  if n <> 2 then raise exception 'FAIL 9b: the agent saw % live section(s)', n; end if;
  reset role;

  -- 10. A new upload starts a new draft; a second one throws the first away.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  d2 := public.start_sg_document(folder || '2-manual.docx', 'Manual v8.docx');
  d3 := public.start_sg_document(folder || '3-manual.docx', 'Manual v8 final.docx');
  select status into r from public.sg_documents where id = d2;
  if r.status <> 'discarded' then raise exception 'FAIL 10a: the first draft is %', r.status; end if;
  select count(*) into n from public.sg_documents where status = 'live';
  if n <> 1 then raise exception 'FAIL 10b: % live document(s) after a new upload', n; end if;

  -- 11. Throwing a draft away, and only once.
  perform public.discard_sg_document(d3);
  begin
    perform public.discard_sg_document(d3);
    raise exception 'FAIL 11: thrown away twice';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%already been saved or thrown away%' then raise exception 'FAIL 11: refused with %', sqlerrm; end if;
  end;
  begin
    perform public.discard_sg_document(d1);
    raise exception 'FAIL 11b: the live document was thrown away';
  exception when sqlstate 'P0001' then null;
  end;
  reset role;

  -- 12. A failed read can be read again; nothing else can.
  update public.sg_documents set status = 'read_failed', read_error = 'made up' where id = d3;
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.retry_sg_document(d3);
  select * into r from public.sg_documents where id = d3;
  if r.status <> 'reading' or r.read_error is not null or r.read_parts <> '[]'::jsonb then
    raise exception 'FAIL 12a: read again as %', row_to_json(r); end if;
  begin
    perform public.retry_sg_document(d1);
    raise exception 'FAIL 12b: the live document was read again';
  exception when sqlstate 'P0001' then null;
  end;
  reset role;

  -- 13. A manual already on file, read in (Master, 10 Nov 2026): saved, it
  -- replaces the live document but isn't filed or sent to sign again, and
  -- its version fills in the file's label if it had none.
  update public.sg_documents set status = 'discarded' where id = d3;
  insert into public.sg_manual_versions (agency_id, version_label, file_path, file_name, uploaded_by)
    values (o1, null, folder || '0-old-manual.pdf', 'Old manual.pdf', lic) returning id into mv;
  insert into public.sg_documents (agency_id, manual_version_id, file_path, file_name, status, from_file_on_record, version_read)
    values (o1, mv, folder || '0-old-manual.pdf', 'Old manual.pdf', 'draft', true, '6.0') returning id into d2;
  select count(*) into n from public.sg_manual_versions where agency_id = o1;
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.save_sg_document(d2, 'procedures', '6.0');
  if (j ->> 'new_file')::boolean is not false then raise exception 'FAIL 13a: save said %', j; end if;
  reset role;
  if (select count(*) from public.sg_manual_versions where agency_id = o1) <> n then
    raise exception 'FAIL 13b: a manual already on file was filed again'; end if;
  if (select version_label from public.sg_manual_versions where id = mv) <> '6.0' then
    raise exception 'FAIL 13c: the file''s label wasn''t filled in'; end if;
  if (select status from public.sg_documents where id = d1) <> 'replaced'
     or (select status from public.sg_documents where id = d2) <> 'live' then
    raise exception 'FAIL 13d: the live document didn''t move on'; end if;

  -- 14. Once the office's subscription has ended, nothing can be started.
  -- (Ended as the database itself would: no signed-in claims for the billing guard.)
  perform set_config('request.jwt.claims', '', true);
  update public.agencies set status = 'canceled', ended_at = now() where id = o1;
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.start_sg_document(folder || '9-manual.pdf', 'manual.pdf');
    raise exception 'FAIL 14: started after the subscription ended';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%subscription has ended%' then raise exception 'FAIL 14: refused with %', sqlerrm; end if;
  end;
  reset role;

  raise notice 'Supervision guidelines live document: all checks passed';
end
$$;

rollback;
