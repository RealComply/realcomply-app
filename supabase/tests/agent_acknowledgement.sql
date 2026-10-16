-- ===== READ ONLY. Agent acknowledgement and annexure lock test, 14 October 2026 =====
--
-- Proves supabase/migrations/0071_agent_acknowledgement.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up offices, people, files and
-- listings it creates never exist outside it.
--
-- Pass: the last line says "Agent acknowledgement: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  solo uuid := gen_random_uuid();     -- an agent's own plan, made after 0071 (lock on)
  office uuid := gen_random_uuid();   -- an office plan, made after 0071 (lock on)
  old_office uuid := gen_random_uuid(); -- an office as it was before 0071 (lock off)
  other uuid := gen_random_uuid();    -- an unrelated agent's own plan
  sa uuid := gen_random_uuid();       -- the agent on solo
  sas uuid := gen_random_uuid();      -- someone assisting them
  ol uuid := gen_random_uuid();       -- licensee in charge of office
  oa uuid := gen_random_uuid();       -- an agent in office
  xl uuid := gen_random_uuid();       -- licensee of old_office
  ta uuid := gen_random_uuid();       -- the agent on other
  five jsonb := '["one","two","three","four","five"]';
  ack uuid;
  ack2 uuid;
  doc uuid;
  listing uuid;
  n integer;
  msg text;
  rec jsonb;
  path text;
begin
  insert into auth.users (id, email) values
    (sa, 'aak-solo@example.invalid'), (sas, 'aak-asst@example.invalid'), (ol, 'aak-lic@example.invalid'),
    (oa, 'aak-agent@example.invalid'), (xl, 'aak-old@example.invalid'), (ta, 'aak-other@example.invalid');
  insert into public.agencies (id, name, plan, status) values
    (solo, 'AAK solo', 'agent_1', 'active'),
    (office, 'AAK office', 'office_1', 'active'),
    (old_office, 'AAK old office', 'office_1', 'active'),
    (other, 'AAK other', 'agent_1', 'active');
  -- The offices made after the change have the lock on (0072 makes that the
  -- default); one made before has it off.
  update public.agencies set annexure_gate = true where id in (solo, office, other);
  update public.agencies set annexure_gate = false where id = old_office;
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent) values
    (sa, solo, 'AAK Solo', 'aak-solo@example.invalid', false, false, true),
    (sas, solo, 'AAK Assistant', 'aak-asst@example.invalid', false, true, false),
    (ol, office, 'AAK Licensee', 'aak-lic@example.invalid', true, false, true),
    (oa, office, 'AAK Agent', 'aak-agent@example.invalid', false, false, true),
    (xl, old_office, 'AAK Old Licensee', 'aak-old@example.invalid', true, false, true),
    (ta, other, 'AAK Other', 'aak-other@example.invalid', false, false, true);

  -- 1. The switch is there, and RealComply (the SQL editor) can turn it on.
  select count(*) into n from public.agencies where id in (solo, office, other) and annexure_gate;
  if n <> 3 then raise exception 'FAIL 1: the lock could not be switched on'; end if;

  -- 2. An agent's own plan, lock on: no new listing until the signed annexure is uploaded.
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.my_listing_gate() is distinct from 'signed_annexure' then
    raise exception 'FAIL 2: an agent plan without the signed annexure is not waiting on it';
  end if;
  begin
    insert into public.properties (agency_id, created_by, address) values (solo, sa, '1 AAK Street');
    raise exception 'FAIL 2b: a listing was created before the signed annexure was uploaded';
  exception when check_violation then null;
  end;

  -- 3. The upload: only a PDF, JPG or PNG of no more than 150 MB, in their own office's folder, that has arrived.
  reset role;
  path := solo::text || '/_signoffs/licensee-signed/1-signed.pdf';
  insert into storage.objects (bucket_id, name, metadata) values
    ('compliance-evidence', path, '{"mimetype":"application/pdf","size":120000}'),
    ('compliance-evidence', solo::text || '/_signoffs/licensee-signed/2-signed.docx',
      '{"mimetype":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","size":1000}'),
    ('compliance-evidence', solo::text || '/_signoffs/licensee-signed/3-huge.pdf', '{"mimetype":"application/pdf","size":200000000}'),
    ('compliance-evidence', other::text || '/_signoffs/licensee-signed/4-theirs.pdf', '{"mimetype":"application/pdf","size":1000}');
  set local role authenticated;
  begin
    perform public.record_signed_annexure_upload(solo::text || '/_signoffs/licensee-signed/2-signed.docx', 'signed.docx');
    raise exception 'FAIL 3: a Word file was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.record_signed_annexure_upload(solo::text || '/_signoffs/licensee-signed/3-huge.pdf', 'huge.pdf');
    raise exception 'FAIL 3b: a file over 150 MB was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.record_signed_annexure_upload(other::text || '/_signoffs/licensee-signed/4-theirs.pdf', 'theirs.pdf');
    raise exception 'FAIL 3c: another office''s file was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.record_signed_annexure_upload(solo::text || '/_signoffs/licensee-signed/9-missing.pdf', 'missing.pdf');
    raise exception 'FAIL 3d: a file that never arrived was accepted';
  exception when check_violation then null;
  end;

  -- 3e. Someone assisting the agent can't file it.
  perform set_config('request.jwt.claims', json_build_object('sub', sas, 'role', 'authenticated')::text, true);
  begin
    perform public.record_signed_annexure_upload(path, 'signed.pdf');
    raise exception 'FAIL 3e: an assistant filed the signed annexure';
  exception when insufficient_privilege then null;
  end;

  -- 4. The agent files it: saved in Document sign-offs with who uploaded it, and the lock lifts.
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);
  doc := public.record_signed_annexure_upload(path, 'signed.pdf');
  reset role;
  select count(*) into n from public.signoff_documents
   where id = doc and category = 'sg_annexure_licensee_signed'
     and title = 'Signed SG annexure (licensee adoption)' and uploaded_by = sa and file_path = path;
  if n <> 1 then raise exception 'FAIL 4: the signed annexure was not filed as it should be'; end if;
  set local role authenticated;
  if public.my_listing_gate() is not null then raise exception 'FAIL 4b: still locked after the upload'; end if;
  insert into public.properties (agency_id, created_by, address) values (solo, sa, '2 AAK Street') returning id into listing;

  -- 5. An office plan, lock on: nobody adds a listing until the licensee adopts the annexure.
  perform set_config('request.jwt.claims', json_build_object('sub', ol, 'role', 'authenticated')::text, true);
  if public.my_listing_gate() is distinct from 'annexure' then raise exception 'FAIL 5: office not waiting on the annexure'; end if;
  begin
    insert into public.properties (agency_id, created_by, address) values (office, ol, '3 AAK Street');
    raise exception 'FAIL 5b: the licensee added a listing before adopting';
  exception when check_violation then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', oa, 'role', 'authenticated')::text, true);
  begin
    insert into public.properties (agency_id, created_by, address) values (office, oa, '4 AAK Street');
    raise exception 'FAIL 5c: an agent in the office added a listing before adoption';
  exception when check_violation then null;
  end;

  -- 6. Once adopted, it works for everyone in the office; a listing already there stays editable throughout.
  -- (Set up as the SQL editor: a listing made before the lock. The agent's
  -- own: an agent can't edit someone else's listing anyway, 0058.)
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into public.properties (agency_id, created_by, address) values (office, oa, '5 AAK Street (already there)') returning id into listing;
  perform set_config('request.jwt.claims', json_build_object('sub', oa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.properties set address = '5 AAK Street, edited' where id = listing;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 6: an existing listing could not be edited while locked'; end if;
  reset role;
  insert into public.sg_annexure_adoptions (agency_id, annexure_version, signed_name, licence_number, sent_to)
  values (office, '1.4', 'AAK Licensee', '12345', 'aak-lic@example.invalid');
  set local role authenticated;
  insert into public.properties (agency_id, created_by, address) values (office, oa, '6 AAK Street');

  -- 7. An office with the lock off is never blocked.
  perform set_config('request.jwt.claims', json_build_object('sub', xl, 'role', 'authenticated')::text, true);
  if public.my_listing_gate() is not null then raise exception 'FAIL 7: an office with the lock off is waiting'; end if;
  insert into public.properties (agency_id, created_by, address) values (old_office, xl, '7 AAK Street');

  -- 8. Only RealComply switches the lock: not the office itself.
  begin
    update public.agencies set annexure_gate = true where id = old_office;
  exception when check_violation or insufficient_privilege then null;
  end;
  reset role;
  if (select annexure_gate from public.agencies where id = old_office) then
    raise exception 'FAIL 8: an office switched its own lock';
  end if;
  set local role authenticated;

  -- 9. The acknowledgement: only the agent on their own plan, every field, all five boxes, saved once.
  perform set_config('request.jwt.claims', json_build_object('sub', ol, 'role', 'authenticated')::text, true);
  begin
    perform public.record_agent_acknowledgement('1', 'AAK office', 'AAK Licensee', '2', 'AAK Licensee', '1.0', five);
    raise exception 'FAIL 9: an office plan recorded an agent acknowledgement';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', sas, 'role', 'authenticated')::text, true);
  begin
    perform public.record_agent_acknowledgement('1', 'AAK solo', 'Their Licensee', '2', 'AAK Assistant', '1.0', five);
    raise exception 'FAIL 9b: an assistant recorded the acknowledgement';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);
  begin
    perform public.record_agent_acknowledgement('  ', 'AAK solo', 'Their Licensee', '2', 'AAK Solo', '1.0', five);
    raise exception 'FAIL 9c: a blank licence number was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.record_agent_acknowledgement('20456789', 'AAK solo', 'Their Licensee', '10123456', 'AAK Solo', '1.0',
      '["one","two","three","four"]');
    raise exception 'FAIL 9d: four boxes were accepted';
  exception when check_violation then null;
  end;
  ack := public.record_agent_acknowledgement(' 20456789 ', 'AAK solo', 'Their Licensee', '10123456', 'AAK Solo', '1.0', five);
  ack2 := public.record_agent_acknowledgement('20456789', 'AAK solo', 'Their Licensee', '10123456', 'AAK Solo', '1.0', five);
  if ack is null or ack <> ack2 then raise exception 'FAIL 9e: a second press made a second acknowledgement'; end if;
  select count(*) into n from public.agent_acknowledgements where profile_id = sa;
  if n <> 1 then raise exception 'FAIL 9f: % acknowledgements for one person', n; end if;
  select count(*) into n from public.agent_acknowledgements
   where id = ack and agent_licence_number = '20456789' and wording_version = '1.0' and wording = five
     and typed_name = 'AAK Solo' and licensee_licence_number = '10123456' and confirmed_at is not null;
  if n <> 1 then raise exception 'FAIL 9g: the acknowledgement was not recorded as confirmed'; end if;

  -- 10. Who can read it: the agent; not another office; nobody signed out.
  perform set_config('request.jwt.claims', json_build_object('sub', ta, 'role', 'authenticated')::text, true);
  select count(*) into n from public.agent_acknowledgements;
  if n <> 0 then raise exception 'FAIL 10: another office can read the acknowledgement'; end if;
  begin
    insert into public.agent_acknowledgements (agency_id, profile_id, agent_licence_number, agency_name, licensee_name,
      licensee_licence_number, wording_version, wording, typed_name)
    values (other, ta, '1', 'x', 'x', '1', '1.0', five, 'AAK Other');
    raise exception 'FAIL 10b: the table took a direct insert';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin
    select count(*) into n from public.agent_acknowledgements;
    raise exception 'FAIL 10c: signed out can read acknowledgements';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 11. The 7-year activity record has it (who, version, when), never the numbers.
  rec := public.build_activity_record(solo);
  if jsonb_array_length(rec -> 'agent_acknowledgements') <> 1
     or (rec -> 'agent_acknowledgements' -> 0 ->> 'version') <> '1.0'
     or position('20456789' in rec::text) > 0 then
    raise exception 'FAIL 11: the activity record is wrong: %', rec -> 'agent_acknowledgements';
  end if;

  raise notice 'Agent acknowledgement: all checks passed';
end $$;

rollback;
