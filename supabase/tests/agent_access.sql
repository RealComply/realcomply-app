-- ===== READ ONLY. Agent access test, 9 October 2026 =====
--
-- Proves the rules in migration 0058 (an agent sees only their own work, only
-- the licensee deletes, sign-offs only by the signer). Run after 0058. Safe
-- on the live database: everything happens inside one transaction that is
-- rolled back at the end, so the made-up offices, people and listings it
-- creates never exist outside it.
--
-- Pass: the last line says "Agent access: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  office uuid := gen_random_uuid();   -- an office on an office plan
  solo uuid := gen_random_uuid();     -- an agent on their own plan
  lic uuid := gen_random_uuid();      -- licensee in charge of the office
  ag1 uuid := gen_random_uuid();      -- agent 1
  ag2 uuid := gen_random_uuid();      -- agent 2
  asst uuid := gen_random_uuid();     -- assistant to agent 1
  q uuid := gen_random_uuid();        -- the agent on their own plan
  p1 uuid; p2 uuid; pq uuid; doc uuid; ta uuid;
  n integer;
  blocked boolean;
  r record;
begin
  -- Deleting a file the way the app does. Supabase refuses a plain SQL delete
  -- on storage.objects (storage.protect_delete) unless this flag is on, which
  -- is what its Storage service sets for every real request. With it on, the
  -- rules in 0058 decide, exactly as they do for the app. Transaction only.
  perform set_config('storage.allow_delete_query', 'true', true);

  -- ── Made-up offices, people and listings (as the database owner). ──
  insert into auth.users (id, email) values
    (lic, 'aa-lic@example.invalid'), (ag1, 'aa-ag1@example.invalid'),
    (ag2, 'aa-ag2@example.invalid'), (asst, 'aa-asst@example.invalid'),
    (q, 'aa-solo@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_email) values
    (office, 'Agent access test office', 'office_1', 'active', 'aa-lic@example.invalid'),
    (solo, 'Agent access test solo', 'agent_1', 'active', 'outside-licensee@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent) values
    (lic, office, 'Test Licensee', 'aa-lic@example.invalid', true, false, true),
    (ag1, office, 'Test Agent One', 'aa-ag1@example.invalid', false, false, true),
    (ag2, office, 'Test Agent Two', 'aa-ag2@example.invalid', false, false, true),
    (asst, office, 'Test Assistant', 'aa-asst@example.invalid', false, true, false),
    (q, solo, 'Test Solo', 'aa-solo@example.invalid', false, false, true);
  insert into public.assistant_agents (agency_id, assistant_id, agent_id) values (office, asst, ag1);

  insert into public.properties (agency_id, created_by, address) values (office, ag1, '1 Test St') returning id into p1;
  insert into public.properties (agency_id, created_by, address) values (office, ag2, '2 Test St') returning id into p2;
  insert into public.properties (agency_id, created_by, address) values (solo, q, '3 Test St') returning id into pq;
  insert into public.property_items (agency_id, property_id, item_key, status) values
    (office, p1, 'a1', 'done'), (office, p2, 'a1', 'done'), (solo, pq, 'a1', 'done');
  insert into public.property_comparables (agency_id, property_id, address, source) values
    (office, p1, 'Comp 1', 'agent'), (office, p2, 'Comp 2', 'agent');
  insert into public.property_market_listings (agency_id, property_id, address, source) values
    (office, p1, 'Market 1', 'agent'), (office, p2, 'Market 2', 'agent');
  insert into storage.buckets (id, name) values ('compliance-evidence', 'compliance-evidence') on conflict do nothing;
  insert into storage.objects (bucket_id, name) values
    ('compliance-evidence', office || '/' || p1 || '/a1/1-test.pdf'),
    ('compliance-evidence', office || '/' || p2 || '/a1/1-test.pdf'),
    ('compliance-evidence', office || '/_cpd/' || ag2 || '/1-cert.pdf');
  insert into public.trust_accounts (agency_id, name) values (office, 'Test trust') returning id into ta;
  insert into public.agency_invites (agency_id, email) values (office, 'aa-invite@example.invalid');
  insert into public.complaints (agency_id, received_date, complainant, nature, status, created_by)
    values (office, current_date, 'A complainant', 'Test', 'open', lic);
  insert into public.breaches (agency_id, identified_date, description, category, severity, status, agent_id, created_by)
    values (office, current_date, 'Agent two''s breach', 'other', 'minor', 'open', ag2, ag2);
  insert into public.gifts (agency_id, profile_id, gift_date, description, direction, status, created_by)
    values (office, ag2, current_date, 'Agent two''s gift', 'received', 'logged', ag2);
  insert into public.signoff_documents (agency_id, category, title, file_path, file_name, signer_scope, uploaded_by)
    values (office, 'other', 'Test document', office || '/_signoffs/other/1-doc.pdf', 'doc.pdf', 'licensee_only', lic)
    returning id into doc;
  insert into public.signoff_signatures (document_id, agency_id, signer_id) values (doc, office, lic);

  -- ══════════════ As agent 1 ══════════════
  perform set_config('request.jwt.claims', json_build_object('sub', ag1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. Sees their own listing and what hangs off it, not agent 2's.
  select count(*) into n from public.properties;
  if n <> 1 then raise exception 'FAIL 1: agent sees % listings, expected 1', n; end if;
  if exists (select 1 from public.properties where id = p2) then raise exception 'FAIL 1: agent sees a colleague''s listing'; end if;
  if exists (select 1 from public.property_items where property_id = p2) then raise exception 'FAIL 1: agent sees a colleague''s checklist'; end if;
  if exists (select 1 from public.property_comparables where property_id = p2) then raise exception 'FAIL 1: agent sees a colleague''s comparables'; end if;
  if exists (select 1 from public.property_market_listings where property_id = p2) then raise exception 'FAIL 1: agent sees a colleague''s on-market list'; end if;
  if exists (select 1 from storage.objects where name like '%' || p2 || '%') then raise exception 'FAIL 1: agent sees a colleague''s documents'; end if;
  if exists (select 1 from storage.objects where name like '%/_cpd/%') then raise exception 'FAIL 1: agent sees a colleague''s CPD certificate'; end if;
  select count(*) into n from public.property_items where property_id = p1;
  if n <> 1 then raise exception 'FAIL 1: agent cannot see their own checklist'; end if;

  -- 2. Cannot change, add to or sign on a colleague's listing.
  update public.properties set address = 'changed' where id = p2;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2: agent changed a colleague''s listing'; end if;
  blocked := false;
  begin
    insert into public.property_items (agency_id, property_id, item_key, status) values (office, p2, 'a2', 'done');
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 2: agent added to a colleague''s checklist'; end if;
  blocked := false;
  begin
    insert into public.property_items (agency_id, property_id, item_key, status) values (office, p2, 'sign_agent', 'done');
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 2: agent signed on a colleague''s listing'; end if;

  -- 3. Cannot create a listing in a colleague's name.
  blocked := false;
  begin
    insert into public.properties (agency_id, created_by, address) values (office, ag2, '9 Fake St');
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 3: agent created a listing for a colleague'; end if;

  -- 4. Cannot delete any compliance record or file, even on their own listing.
  delete from public.property_items where property_id = p1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 4: agent deleted a checklist item'; end if;
  delete from public.property_comparables where property_id = p1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 4: agent deleted a comparable'; end if;
  delete from public.property_market_listings where property_id = p1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 4: agent deleted an on-market listing'; end if;
  delete from storage.objects where name like '%' || p1 || '%';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 4: agent deleted an evidence file'; end if;
  delete from public.properties where id = p1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 4: agent deleted their own listing'; end if;

  -- 5. Cannot change the licensee's name or email, the listings page or the PM records system.
  blocked := false;
  begin perform public.set_agency_licensee('Fake Licensee', 'fake@example.invalid');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 5: agent changed the licensee''s name and email'; end if;
  blocked := false;
  begin perform public.set_agency_licensee_email('fake@example.invalid');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 5: agent changed the licensee''s email'; end if;
  blocked := false;
  begin perform public.set_agency_website('https://fake.example.invalid');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 5: agent changed the listings page'; end if;
  blocked := false;
  begin perform public.set_agency_pm_records_system('Fake');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 5: agent changed the PM records system'; end if;

  -- 6. Cannot read trust accounts, the team, invites, complaints or a colleague's breach or gift.
  if exists (select 1 from public.trust_accounts) then raise exception 'FAIL 6: agent can read trust accounts'; end if;
  if exists (select 1 from public.agency_invites) then raise exception 'FAIL 6: agent can read invites'; end if;
  if exists (select 1 from public.complaints) then raise exception 'FAIL 6: agent can read complaints'; end if;
  if exists (select 1 from public.breaches) then raise exception 'FAIL 6: agent can read a colleague''s breach'; end if;
  if exists (select 1 from public.gifts) then raise exception 'FAIL 6: agent can read a colleague''s gift'; end if;
  if exists (select 1 from public.profiles where id not in (ag1, asst)) then raise exception 'FAIL 6: agent can read colleagues'' profiles beyond their own assistant'; end if;
  select count(*) into n from public.agency_people();
  if n <> 4 then raise exception 'FAIL 6: names-only list has % people, expected 4', n; end if;

  -- 7. Can log and read their own breach; cannot log one against a colleague.
  insert into public.breaches (agency_id, identified_date, description, category, severity, status, agent_id, created_by)
    values (office, current_date, 'My breach', 'other', 'minor', 'open', ag1, ag1);
  select count(*) into n from public.breaches;
  if n <> 1 then raise exception 'FAIL 7: agent cannot read their own breach'; end if;
  blocked := false;
  begin
    insert into public.breaches (agency_id, identified_date, description, category, severity, status, agent_id, created_by)
      values (office, current_date, 'Blaming a colleague', 'other', 'minor', 'open', ag2, ag1);
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 7: agent logged a breach against a colleague'; end if;
  blocked := false;
  begin
    insert into public.complaints (agency_id, received_date, complainant, nature, status, created_by)
      values (office, current_date, 'x', 'x', 'open', ag1);
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 7: agent added a complaint'; end if;

  -- 8. Cannot record a licensee sign-off, even on their own listing.
  blocked := false;
  begin
    insert into public.property_items (agency_id, property_id, item_key, status, data)
      values (office, p1, 'sign_licensee', 'done', '{"typedName":"Test Licensee"}');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 8: agent recorded a licensee sign-off'; end if;

  -- 9. Signs their own agent sign-off; who and when come from the login; then it is locked.
  insert into public.property_items (agency_id, property_id, item_key, status, completed_by, data)
    values (office, p1, 'sign_agent', 'done', ag2, '{"typedName":"Test Agent One","signedAt":"2020-01-01"}');
  select completed_by, data into r from public.property_items where property_id = p1 and item_key = 'sign_agent';
  if r.completed_by <> ag1 or (r.data ->> 'signedAt') = '2020-01-01' then
    raise exception 'FAIL 9: who or when was taken from the browser';
  end if;
  blocked := false;
  begin
    update public.property_items set status = 'open' where property_id = p1 and item_key = 'sign_agent';
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 9: a signed sign-off was changed'; end if;

  -- 10. Cannot forge a signature on an office document.
  blocked := false;
  begin
    insert into public.signoff_signatures (document_id, agency_id, signer_id, typed_name, signed_at)
      values (doc, office, lic, 'Test Licensee', now());
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 10: agent forged a document signature'; end if;

  -- 11. A licensee sign-off link always goes to the agency's licensee email,
  --     and the agent cannot mark it signed.
  insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement, created_by, signed_at, signed_name)
    values (office, p1, 'me@example.invalid', '{}', ag2, now(), 'Fake');
  select sent_to, signed_at, created_by into r from public.property_signoff_requests where property_id = p1;
  if r.sent_to <> 'aa-lic@example.invalid' or r.signed_at is not null or r.created_by <> ag1 then
    raise exception 'FAIL 11: sign-off link took its recipient or signature from the browser';
  end if;
  blocked := false;
  begin
    update public.property_signoff_requests set signed_at = now(), signed_name = 'Fake' where property_id = p1;
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 11: agent marked a sign-off link as signed'; end if;
  blocked := false;
  begin
    perform token from public.property_signoff_requests where property_id = p1;
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 11: agent can read the licensee''s sign-off link'; end if;

  -- ══════════════ As the assistant to agent 1 ══════════════
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', asst, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 12. Sees agent 1's listing only, and cannot sign as the agent.
  select count(*) into n from public.properties;
  if n <> 1 or not exists (select 1 from public.properties where id = p1) then
    raise exception 'FAIL 12: assistant sees % listings, expected agent one''s only', n;
  end if;
  blocked := false;
  begin
    update public.property_items set status = 'done' where property_id = p1 and item_key = 'a1';
  exception when others then blocked := true; end;
  if blocked then raise exception 'FAIL 12: assistant cannot work on their agent''s listing'; end if;
  if exists (select 1 from public.trust_accounts) then raise exception 'FAIL 12: assistant can read trust accounts'; end if;

  -- ══════════════ As the licensee in charge ══════════════
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 13. Nothing changed for the licensee: sees everything, deletes, signs.
  select count(*) into n from public.properties;
  if n <> 2 then raise exception 'FAIL 13: licensee sees % listings, expected 2', n; end if;
  if not exists (select 1 from public.trust_accounts) then raise exception 'FAIL 13: licensee cannot read trust accounts'; end if;
  if not exists (select 1 from public.complaints) then raise exception 'FAIL 13: licensee cannot read complaints'; end if;
  select count(*) into n from public.breaches;
  if n <> 2 then raise exception 'FAIL 13: licensee sees % breaches, expected 2', n; end if;
  if not exists (select 1 from public.profiles where id = ag2) then raise exception 'FAIL 13: licensee cannot read the team'; end if;
  insert into public.property_items (agency_id, property_id, item_key, status, data)
    values (office, p2, 'sign_licensee', 'done', '{"typedName":"Test Licensee"}');
  blocked := false;
  begin
    insert into public.property_items (agency_id, property_id, item_key, status) values (office, p2, 'sign_agent', 'done');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 13: licensee signed as another agent'; end if;
  perform public.set_agency_website('https://office.example.invalid/listings');

  -- 14. A licensee delete is recorded: what, who, when.
  delete from public.property_comparables where property_id = p2;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 14: licensee could not delete a comparable'; end if;
  delete from storage.objects where name like '%' || p2 || '%';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 14: licensee could not delete an evidence file'; end if;
  select count(*) into n from public.deletion_log
   where agency_id = office and deleted_by = lic and what in ('property_comparables', 'file');
  if n <> 2 then raise exception 'FAIL 14: % of 2 deletes were recorded', n; end if;

  -- 15. Replacing a signed document keeps the old signature on record.
  update public.signoff_signatures set signed_at = now() where document_id = doc and signer_id = lic;
  perform public.void_document_signatures(doc);
  if exists (select 1 from public.signoff_signatures where document_id = doc and signed_at is not null) then
    raise exception 'FAIL 15: the old signature still counts after a replace';
  end if;
  if not exists (select 1 from public.signoff_signature_voids where document_id = doc and signer_id = lic) then
    raise exception 'FAIL 15: the replaced signature was not kept on record';
  end if;

  -- ══════════════ As the agent on their own plan ══════════════
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', q, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 16. Counts as the licensee for their own account, except complaints.
  delete from public.property_items where property_id = pq and item_key = 'a1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 16: agent on their own plan cannot delete their own record'; end if;
  perform public.set_agency_website('https://solo.example.invalid');
  blocked := false;
  begin
    insert into public.complaints (agency_id, received_date, complainant, nature, status, created_by)
      values (solo, current_date, 'x', 'x', 'open', q);
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 16: agent on their own plan has a complaints register'; end if;
  if exists (select 1 from public.properties where agency_id = office) then
    raise exception 'FAIL 16: agent on their own plan can see another office';
  end if;

  reset role;
  raise notice 'Agent access: all checks passed';
end
$$;

rollback;
