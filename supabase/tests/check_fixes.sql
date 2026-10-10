-- ===== READ ONLY. Check-fixes test, 10 October 2026 =====
--
-- Proves migration 0060 (fixes from the full function check). Run after 0060.
-- Safe on the live database: one transaction, rolled back at the end, so the
-- made-up office, people, listing and files never exist outside it.
--
-- Pass: the last line says "Check fixes: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  office uuid := gen_random_uuid();
  lic uuid := gen_random_uuid();      -- licensee in charge
  ag1 uuid := gen_random_uuid();      -- agent
  ag2 uuid := gen_random_uuid();      -- another agent
  newbie uuid := gen_random_uuid();   -- joins after the SG Manual is published
  p1 uuid; doc uuid;
  n integer;
  blocked boolean;
  got text;
begin
  -- Deleting a file the way the Storage service does (see agent_access.sql).
  perform set_config('storage.allow_delete_query', 'true', true);

  insert into auth.users (id, email) values
    (lic, 'cf-lic@example.invalid'), (ag1, 'cf-ag1@example.invalid'),
    (ag2, 'cf-ag2@example.invalid'), (newbie, 'cf-new@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_email) values
    (office, 'Check fixes test office', 'office_1', 'active', 'cf-lic@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent) values
    (lic, office, 'Test Licensee', 'cf-lic@example.invalid', true, false, true),
    (ag1, office, 'Test Agent One', 'cf-ag1@example.invalid', false, false, true),
    (ag2, office, 'Test Agent Two', 'cf-ag2@example.invalid', false, false, true);
  update public.profiles set created_at = now() + interval '1 minute' where id in (ag1, ag2);

  insert into public.properties (agency_id, created_by, address) values (office, ag1, '1 Test St') returning id into p1;
  insert into public.property_items (agency_id, property_id, item_key, status, evidence_path)
    values (office, p1, 'a1', 'open', office || '/' || p1 || '/a1/2-attached.pdf');
  insert into storage.buckets (id, name) values ('compliance-evidence', 'compliance-evidence') on conflict do nothing;
  insert into storage.objects (bucket_id, name, owner_id, created_at) values
    -- ID-document uploads on the a1 card
    ('compliance-evidence', office || '/' || p1 || '/a1/1-refused-id.pdf', ag1::text, now()),
    ('compliance-evidence', office || '/' || p1 || '/a1/2-attached.pdf', ag1::text, now()),
    ('compliance-evidence', office || '/' || p1 || '/a1/3-old.pdf', ag1::text, now() - interval '1 hour'),
    ('compliance-evidence', office || '/' || p1 || '/a1/4-colleague.pdf', ag2::text, now()),
    ('compliance-evidence', office || '/' || p1 || '/a2/5-other-card.pdf', ag1::text, now()),
    -- licence uploads
    ('compliance-evidence', office || '/_licences/' || ag1 || '/6-refused-licence.pdf', ag1::text, now()),
    ('compliance-evidence', office || '/_licences/' || ag1 || '/7-on-record.pdf', ag1::text, now());
  update public.profiles set licence_document_path = office || '/_licences/' || ag1 || '/7-on-record.pdf' where id = ag1;

  -- An SG Manual version, published while the licensee and the two agents are here.
  insert into public.signoff_documents (agency_id, category, title, file_path, file_name, signer_scope, uploaded_by)
    values (office, 'sg_manual', 'SG Manual', office || '/_sg-manual/1.pdf', 'sg.pdf', 'all_staff', lic)
    returning id into doc;
  insert into public.signoff_signatures (document_id, agency_id, signer_id) values (doc, office, lic), (doc, office, ag1), (doc, office, ag2);

  -- ══════════════ As agent 1 ══════════════
  perform set_config('request.jwt.claims', json_build_object('sub', ag1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. A refused ID document the agent just uploaded can be deleted by them.
  delete from storage.objects where name like '%/a1/1-refused-id.pdf';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 1: the agent could not delete their own refused ID upload'; end if;

  -- 2. But not a file attached to the card, an old one, a colleague's, or one on another card.
  delete from storage.objects where name like '%/a1/2-attached.pdf';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2: the agent deleted a file attached to the card'; end if;
  delete from storage.objects where name like '%/a1/3-old.pdf';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2: the agent deleted an upload older than 15 minutes'; end if;
  delete from storage.objects where name like '%/a1/4-colleague.pdf';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2: the agent deleted a colleague''s upload'; end if;
  delete from storage.objects where name like '%/a2/5-other-card.pdf';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2: the agent deleted a file on a card that keeps ID documents out by other means'; end if;

  -- 3. Their own refused licence upload can go; their licence document on record cannot.
  delete from storage.objects where name like '%/_licences/%/6-refused-licence.pdf';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 3: the agent could not remove their own refused licence upload'; end if;
  delete from storage.objects where name like '%/_licences/%/7-on-record.pdf';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 3: the agent deleted the licence document on their record'; end if;

  -- 4. An agent cannot record the agency's Stripe customer.
  blocked := false;
  begin
    perform public.set_agency_stripe_customer('cus_TestAgent1');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 4: an agent recorded the Stripe customer'; end if;

  -- ══════════════ As the licensee ══════════════
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 5. The licensee records the customer once; a second attempt keeps the first.
  got := public.set_agency_stripe_customer('cus_TestFirst1');
  if got <> 'cus_TestFirst1' then raise exception 'FAIL 5: the customer id was not recorded'; end if;
  got := public.set_agency_stripe_customer('cus_TestSecond2');
  if got <> 'cus_TestFirst1' then raise exception 'FAIL 5: a second checkout replaced the first customer'; end if;

  -- 6. Everything else about billing is still the platform's alone.
  blocked := false;
  begin
    update public.agencies set stripe_customer_id = 'cus_Direct3' where id = office;
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 6: the licensee changed the customer id directly'; end if;
  blocked := false;
  begin
    update public.agencies set status = 'comped' where id = office;
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 6: the licensee changed the billing status'; end if;

  -- ══════════════ Someone joins after the SG Manual was published ══════════════
  reset role;
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent)
    values (newbie, office, 'Test New Starter', 'cf-new@example.invalid', false, false, true);

  -- 7. They are asked to sign the current version, unsigned.
  select count(*) into n from public.signoff_signatures where document_id = doc and signer_id = newbie and signed_at is null;
  if n <> 1 then raise exception 'FAIL 7: a new starter was not asked to sign the current SG Manual'; end if;

  -- 8. An ordinary edit to a profile adds nothing, and nobody gets a second row.
  update public.profiles set full_name = 'Test New Starter Renamed' where id = newbie;
  select count(*) into n from public.signoff_signatures where document_id = doc;
  if n <> 4 then raise exception 'FAIL 8: a profile edit changed the sign-off rows (% rows)', n; end if;

  -- 9. A trust account can say when it opened.
  insert into public.trust_accounts (agency_id, name, opened_on) values (office, 'Test trust', date '2026-10-01');

  raise notice 'Check fixes: all checks passed';
end
$$;

rollback;
