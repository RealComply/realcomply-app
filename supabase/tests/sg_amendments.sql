-- ===== READ ONLY. Supervision guidelines quick amendments, 10 November 2026 =====
--
-- Proves supabase/migrations/0125_sg_amendments.sql. Run after it. Safe on
-- the live database: everything happens inside one transaction that is
-- rolled back at the end, so the made-up offices, people and documents it
-- creates never exist outside it.
--
-- Pass: the last line says "SG amendments: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1  uuid := gen_random_uuid();  -- the office
  o2  uuid := gen_random_uuid();  -- another office
  lic uuid := gen_random_uuid();  -- o1's licensee in charge
  ag  uuid := gen_random_uuid();  -- o1's agent
  om  uuid := gen_random_uuid();  -- o1's office manager
  x   uuid := gen_random_uuid();  -- o2's licensee
  d1  uuid;
  d2  uuid;
  a1  uuid;
  a2  uuid;
  a3  uuid;
  n   integer;
  r   record;
begin
  insert into auth.users (id, email) values
    (lic, 'sga-lic@example.invalid'), (ag, 'sga-ag@example.invalid'),
    (om, 'sga-om@example.invalid'), (x, 'sga-x@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'SG Amendment Office (made up)', 'office_1', 'active', 'Lou Licensee', 'sga-lou@example.invalid'),
    (o2, 'Other SG Office (made up)', 'office_1', 'active', 'Xan Licensee', 'sga-xan@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (lic, o1, 'Lou Licensee', 'sga-lic@example.invalid', true, true, false),
    (ag, o1, 'Ana Agent', 'sga-ag@example.invalid', true, false, false),
    (om, o1, 'Max Manager', 'sga-om@example.invalid', false, false, false),
    (x, o2, 'Xan Licensee', 'sga-x@example.invalid', true, true, false);
  insert into public.office_managers (agency_id, profile_id, wording, approved_via, approved_by, approved_by_name)
  values (o1, om, 'Max Manager is an office manager (made up wording).', 'team', lic, 'Lou Licensee');

  insert into public.sg_documents (agency_id, file_path, file_name, status, doc_type, version_label, saved_at, saved_by_name)
  values (o1, o1::text || '/_sg-manual/1-manual.pdf', 'Manual v7.3.pdf', 'live', 'sg_and_procedures', 'v7.3', now() - interval '90 days', 'Lou Licensee')
  returning id into d1;
  insert into public.sg_document_sections (document_id, agency_id, position, number, title, paragraphs) values
    (d1, o1, 0, '4', 'Trust money', array[
      '4.1 All money received for a client is banked by the end of the next business day.',
      '4.2 Receipts are issued on the day the money is received, and the receipt book is reconciled monthly.']),
    (d1, o1, 1, '6', 'Complaints', array['6.1 Complaints are logged on the register.']);
  -- An earlier document, replaced: never amended.
  insert into public.sg_documents (agency_id, file_path, file_name, status, doc_type, version_label, saved_at)
  values (o1, o1::text || '/_sg-manual/0-old.pdf', 'Old.pdf', 'replaced', 'sg', 'v7.2', now() - interval '400 days')
  returning id into d2;

  -- 1. The licensee approves an amendment to 4.2 straight away: A1, the
  --    wording it replaced taken from the document, signed by the approver.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  a1 := public.save_sg_amendment(null, d1, 0, 1,
    '4.2 Receipts are issued on the day the money is received, and the receipt book is reconciled weekly.',
    'audit_finding', null, date '2026-11-03', true);
  reset role;
  select * into r from public.sg_amendments where id = a1;
  if r.status <> 'approved' or r.ref_no <> 1 or r.approved_by <> lic or r.approved_by_name <> 'Lou Licensee'
     or r.approved_as <> 'licensee' or r.section_label <> '4. Trust money'
     or r.previous_text <> '4.2 Receipts are issued on the day the money is received, and the receipt book is reconciled monthly.'
     or r.created_by_name <> 'Lou Licensee' then
    raise exception 'FAIL 1a: A1 is %', row_to_json(r); end if;
  if not exists (select 1 from public.sg_amendment_signatures where amendment_id = a1 and profile_id = lic) then
    raise exception 'FAIL 1b: the approver hasn''t signed'; end if;

  -- 2. The office manager saves a draft to the same paragraph: it replaces
  --    A1's wording, not the document's. Then approves it: A2, as office manager.
  perform set_config('request.jwt.claims', json_build_object('sub', om, 'role', 'authenticated')::text, true);
  set local role authenticated;
  a2 := public.save_sg_amendment(null, d1, 0, 1,
    '4.2 Receipts are issued on the day, and reconciled with the trust account every week.',
    'other', '  New   bank ', date '2026-11-10', false);
  reset role;
  select * into r from public.sg_amendments where id = a2;
  if r.status <> 'draft' or r.ref_no is not null or r.reason_other <> 'New bank'
     or r.previous_text <> '4.2 Receipts are issued on the day the money is received, and the receipt book is reconciled weekly.' then
    raise exception 'FAIL 2a: the draft is %', row_to_json(r); end if;

  -- 3. A draft is seen only by whoever runs the office.
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.sg_amendments where document_id = d1;
  reset role;
  if n <> 1 then raise exception 'FAIL 3: the agent sees % amendments (the approved one only)', n; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', om, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.save_sg_amendment(a2, d1, 0, 1,
    '4.2 Receipts are issued on the day, and reconciled with the trust account every week.',
    'other', 'New bank', date '2026-11-10', true);
  reset role;
  select * into r from public.sg_amendments where id = a2;
  if r.status <> 'approved' or r.ref_no <> 2 or r.approved_as <> 'office_manager' or r.approved_by_name <> 'Max Manager' then
    raise exception 'FAIL 3b: A2 is %', row_to_json(r); end if;

  -- 4. Adding a paragraph at the end of a section, then another after it.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  a3 := public.save_sg_amendment(null, d1, 1, 1, '6.2 Each complaint is acknowledged in writing within 2 business days.',
    'complaint', null, date '2026-11-10', true);
  perform public.save_sg_amendment(null, d1, 1, 2, '6.3 The licensee reviews every complaint monthly.',
    'complaint', null, date '2026-11-10', true);
  reset role;
  select * into r from public.sg_amendments where id = a3;
  if r.previous_text <> '' or r.ref_no <> 3 then raise exception 'FAIL 4: an added paragraph is %', row_to_json(r); end if;

  -- 5. Refused: the same wording, no reason words for Other, a paragraph
  --    past the end, a section that isn't there, a document that isn't live.
  set local role authenticated;
  begin
    perform public.save_sg_amendment(null, d1, 0, 0,
      '4.1 All money received for a client is banked by the end of the next business day.', 'staffing', null, current_date, true);
    raise exception 'FAIL 5a: the same wording was taken';
  exception when raise_exception then
    if sqlerrm <> 'The new wording is the same as the current wording.' then raise; end if;
  end;
  begin
    perform public.save_sg_amendment(null, d1, 0, 0, 'Something new', 'other', '   ', current_date, false);
    raise exception 'FAIL 5b: Other with no words';
  exception when raise_exception then
    if sqlerrm <> 'Say what the other reason is.' then raise; end if;
  end;
  begin
    perform public.save_sg_amendment(null, d1, 0, 9, 'Something new', 'staffing', null, current_date, false);
    raise exception 'FAIL 5c: a paragraph past the end';
  exception when raise_exception then
    if sqlerrm <> 'Choose the paragraph to amend.' then raise; end if;
  end;
  begin
    perform public.save_sg_amendment(null, d1, 7, 0, 'Something new', 'staffing', null, current_date, false);
    raise exception 'FAIL 5d: a section that isn''t there';
  exception when raise_exception then
    if sqlerrm <> 'Choose a section.' then raise; end if;
  end;
  begin
    perform public.save_sg_amendment(null, d2, 0, 0, 'Something new', 'staffing', null, current_date, false);
    raise exception 'FAIL 5e: a replaced document amended';
  exception when raise_exception then
    if sqlerrm not like 'That isn''t the office''s current document.%' then raise; end if;
  end;
  begin
    perform public.save_sg_amendment(a1, d1, 0, 1, 'Changed again', 'staffing', null, current_date, false);
    raise exception 'FAIL 5f: an approved amendment was changed';
  exception when raise_exception then
    if sqlerrm not like 'That draft has already been approved or thrown away.%' then raise; end if;
  end;
  reset role;

  -- 6. An agent (not running the office) can't amend; another office can't touch it.
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.save_sg_amendment(null, d1, 0, 0, 'Something new', 'staffing', null, current_date, false);
    raise exception 'FAIL 6a: an agent amended it';
  exception when insufficient_privilege then null;
  end;
  -- 7. The agent signs A1, once; signing twice is fine and changes nothing.
  perform public.sign_sg_amendment(a1);
  perform public.sign_sg_amendment(a1);
  reset role;
  if (select count(*) from public.sg_amendment_signatures where amendment_id = a1) <> 2 then
    raise exception 'FAIL 7a: A1 has % signatures (licensee and agent)', (select count(*) from public.sg_amendment_signatures where amendment_id = a1); end if;
  if (select signed_name from public.sg_amendment_signatures where amendment_id = a1 and profile_id = ag) <> 'Ana Agent' then
    raise exception 'FAIL 7b: the agent''s signature is unnamed'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.sg_amendments;
  if n <> 0 then raise exception 'FAIL 6b: another office sees % amendments', n; end if;
  select count(*) into n from public.sg_amendment_signatures;
  if n <> 0 then raise exception 'FAIL 6c: another office sees % signatures', n; end if;
  begin
    perform public.sign_sg_amendment(a1);
    raise exception 'FAIL 6d: another office signed it';
  exception when raise_exception then
    if sqlerrm <> 'That change isn''t one to sign.' then raise; end if;
  end;
  begin
    perform public.save_sg_amendment(null, d1, 0, 0, 'Something new', 'staffing', null, current_date, false);
    raise exception 'FAIL 6e: another office amended it';
  exception when raise_exception then
    if sqlerrm not like 'That isn''t the office''s current document.%' then raise; end if;
  end;
  reset role;

  -- 8. Signed in, nobody writes the tables directly; signed out, nobody reads them.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.sg_amendments set new_text = 'Rewritten' where id = a1;
    raise exception 'FAIL 8a: an amendment was rewritten directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.sg_amendment_signatures (amendment_id, agency_id, profile_id) values (a2, o1, ag);
    raise exception 'FAIL 8b: a signature was written for someone else';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    perform count(*) from public.sg_amendments;
    raise exception 'FAIL 8c: signed out read the amendments';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 9. A draft thrown away; then it can't be approved.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  a3 := public.save_sg_amendment(null, d1, 0, 0, '4.1 Banked the same day.', 'law_change', null, current_date, false);
  perform public.discard_sg_amendment(a3);
  begin
    perform public.save_sg_amendment(a3, d1, 0, 0, '4.1 Banked the same day.', 'law_change', null, current_date, true);
    raise exception 'FAIL 9: a thrown-away draft was approved';
  exception when raise_exception then
    if sqlerrm not like 'That draft has already been approved or thrown away.%' then raise; end if;
  end;
  reset role;

  raise notice 'SG amendments: all checks passed';
end $$;

rollback;
