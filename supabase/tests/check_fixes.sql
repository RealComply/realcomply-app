-- ===== READ ONLY. Check-fixes test, 10 October 2026 =====
--
-- Proves migration 0060 (fixes from the full function check). Run after 0060.
-- Safe on the live database: one transaction, rolled back at the end, so the
-- made-up offices, people, listing and files never exist outside it.
--
-- Not tested here, because it would mean writing to Cass Property: the two
-- updates in 0060 section G1a leave Cass out, by id and by name. Read them.
--
-- Pass: the last line says "Check fixes: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  office uuid := gen_random_uuid();
  other uuid := gen_random_uuid();    -- another office, with a Stripe customer of its own
  solo uuid := gen_random_uuid();     -- an agent plan
  lic uuid := gen_random_uuid();      -- licensee in charge
  ag1 uuid := gen_random_uuid();      -- agent
  ag2 uuid := gen_random_uuid();      -- another agent
  newbie uuid := gen_random_uuid();   -- joins after the SG Manual is published
  solo_ag uuid := gen_random_uuid();  -- the agent on the agent plan (its account holder)
  solo_asst uuid := gen_random_uuid(); -- their assistant
  p1 uuid; p2 uuid; doc uuid; old_doc uuid; recon uuid; recon2 uuid; other_doc uuid;
  n integer;
  blocked boolean;
  got text;
  state text;
begin
  -- Deleting a file the way the Storage service does (see agent_access.sql).
  perform set_config('storage.allow_delete_query', 'true', true);

  insert into auth.users (id, email) values
    (lic, 'cf-lic@example.invalid'), (ag1, 'cf-ag1@example.invalid'),
    (ag2, 'cf-ag2@example.invalid'), (newbie, 'cf-new@example.invalid'),
    (solo_ag, 'cf-solo@example.invalid'), (solo_asst, 'cf-solo-asst@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_email, stripe_customer_id) values
    (office, 'Check fixes test office', 'office_1', 'active', 'cf-lic@example.invalid', null),
    (other, 'Check fixes other office', 'office_1', 'active', 'cf-other@example.invalid', 'cus_TestOtherOffice9'),
    (solo, 'Check fixes agent plan', 'agent_1', 'active', 'cf-solo@example.invalid', null);
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent) values
    (lic, office, 'Test Licensee', 'cf-lic@example.invalid', true, false, true),
    (ag1, office, 'Test Agent One', 'cf-ag1@example.invalid', false, false, true),
    (ag2, office, 'Test Agent Two', 'cf-ag2@example.invalid', false, false, true),
    (solo_ag, solo, 'Test Solo Agent', 'cf-solo@example.invalid', false, false, true),
    (solo_asst, solo, 'Test Solo Assistant', 'cf-solo-asst@example.invalid', false, true, false);
  update public.profiles set created_at = now() + interval '1 minute' where id in (ag1, ag2, solo_asst);

  insert into public.properties (agency_id, created_by, address) values (office, ag1, '1 Test St') returning id into p1;
  insert into public.properties (agency_id, created_by, address) values (office, ag1, '2 Test St') returning id into p2;
  insert into public.property_items (agency_id, property_id, item_key, status) values (office, p2, 'a1', 'open');
  -- a1 holds the VOI certificate that is about to be replaced; b1 and a3 hold
  -- the licensee's fresh uploads.
  insert into public.property_items (agency_id, property_id, item_key, status, evidence_path) values
    (office, p1, 'a1', 'open', office || '/' || p1 || '/a1/8-replaced.pdf'),
    (office, p1, 'b1', 'open', office || '/' || p1 || '/b1/9-contract.pdf'),
    (office, p1, 'a3', 'open', office || '/' || p1 || '/a3/10-agreement.pdf');
  insert into storage.buckets (id, name) values ('compliance-evidence', 'compliance-evidence') on conflict do nothing;
  insert into storage.objects (bucket_id, name, owner_id, created_at) values
    -- ID-document uploads on the a1 card
    ('compliance-evidence', office || '/' || p1 || '/a1/1-refused-id.pdf', ag1::text, now()),
    ('compliance-evidence', office || '/' || p1 || '/a1/2-attached.pdf', ag1::text, now()),
    ('compliance-evidence', office || '/' || p1 || '/a1/3-old.pdf', ag1::text, now() - interval '1 hour'),
    ('compliance-evidence', office || '/' || p1 || '/a1/4-colleague.pdf', ag2::text, now()),
    ('compliance-evidence', office || '/' || p1 || '/a2/5-other-card.pdf', ag1::text, now()),
    -- once on a record: replaced, and the licensee's on other cards
    ('compliance-evidence', office || '/' || p1 || '/a1/8-replaced.pdf', ag1::text, now() - interval '5 minutes'),
    ('compliance-evidence', office || '/' || p1 || '/b1/9-contract.pdf', lic::text, now() - interval '3 minutes'),
    ('compliance-evidence', office || '/' || p1 || '/a3/10-agreement.pdf', lic::text, now() - interval '2 minutes'),
    -- licence uploads
    ('compliance-evidence', office || '/_licences/' || ag1 || '/6-refused-licence.pdf', ag1::text, now()),
    ('compliance-evidence', office || '/_licences/' || ag1 || '/7-on-record.pdf', ag1::text, now());
  update public.profiles set licence_document_path = office || '/_licences/' || ag1 || '/7-on-record.pdf' where id = ag1;

  -- An SG Manual version, published while the licensee and the two agents are
  -- here, and the one before it, which only the licensee was asked to sign.
  insert into public.signoff_documents (agency_id, category, title, file_path, file_name, signer_scope, uploaded_by, created_at)
    values (office, 'sg_manual', 'SG Manual v1', office || '/_sg-manual/0.pdf', 'sg0.pdf', 'all_staff', lic, now() - interval '1 day')
    returning id into old_doc;
  insert into public.signoff_documents (agency_id, category, title, file_path, file_name, signer_scope, uploaded_by)
    values (office, 'sg_manual', 'SG Manual', office || '/_sg-manual/1.pdf', 'sg.pdf', 'all_staff', lic)
    returning id into doc;
  insert into public.signoff_signatures (document_id, agency_id, signer_id) values
    (old_doc, office, lic), (doc, office, lic), (doc, office, ag1), (doc, office, ag2);
  -- Two trust reconciliations, the licensee's only: one listing them, one not yet.
  insert into public.signoff_documents (agency_id, category, title, file_path, file_name, signer_scope, uploaded_by)
    values (office, 'trust_reconciliation', 'Recon', office || '/_signoffs/trust_reconciliation/1.pdf', 'r.pdf', 'licensee_only', lic)
    returning id into recon;
  insert into public.signoff_documents (agency_id, category, title, file_path, file_name, signer_scope, uploaded_by)
    values (office, 'trust_reconciliation', 'Recon 2', office || '/_signoffs/trust_reconciliation/2.pdf', 'r2.pdf', 'licensee_only', lic)
    returning id into recon2;
  insert into public.signoff_signatures (document_id, agency_id, signer_id) values (recon, office, lic);
  -- Another office's document for all staff.
  insert into public.signoff_documents (agency_id, category, title, file_path, file_name, signer_scope, uploaded_by)
    values (other, 'sg_manual', 'Other SG Manual', other || '/_sg-manual/1.pdf', 'o.pdf', 'all_staff', null)
    returning id into other_doc;

  -- ══════════════ As agent 1 ══════════════
  perform set_config('request.jwt.claims', json_build_object('sub', ag1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. A refused ID document the agent just uploaded can be deleted by them.
  delete from storage.objects where name like '%/a1/1-refused-id.pdf';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 1: the agent could not delete their own refused ID upload'; end if;

  -- The agent attaches 2-attached.pdf in place of 8-replaced.pdf, the way
  -- finalizeEvidenceRecord does (its remove of the old file is refused for them).
  update public.property_items set evidence_path = office || '/' || p1 || '/a1/2-attached.pdf'
   where property_id = p1 and item_key = 'a1';

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

  -- 2a. Nor one that was on the card and was replaced.
  delete from storage.objects where name like '%/a1/8-replaced.pdf';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2a: the agent deleted a VOI certificate that was replaced'; end if;

  -- 2b. Nor one they took off the card first.
  update public.property_items set evidence_path = null where property_id = p1 and item_key = 'a1';
  delete from storage.objects where name like '%/a1/2-attached.pdf';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2b: the agent deleted a VOI certificate after taking it off the card'; end if;

  -- 2c. They cannot move the licensee's contract off b1 at all (H6: only the
  --     licensee moves or overwrites a filed document).
  update public.property_items set evidence_path = null where property_id = p1 and item_key = 'b1';
  update storage.objects set name = office || '/' || p1 || '/a1/9-moved.pdf', owner_id = ag1::text
   where name like '%/b1/9-contract.pdf';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2c: the agent moved a filed contract'; end if;

  -- 2d. And had a move happened anyway (here done with full rights), the file
  --     moved into a1 still counts as once on record, so it cannot be deleted
  --     as a refused upload. Same for the agreement moved while still on a3.
  reset role;
  update storage.objects set name = office || '/' || p1 || '/a1/9-moved.pdf', owner_id = ag1::text
   where name like '%/b1/9-contract.pdf';
  update storage.objects set name = office || '/' || p1 || '/a1/10-moved.pdf', owner_id = ag1::text
   where name like '%/a3/10-agreement.pdf';
  set local role authenticated;
  delete from storage.objects where name like '%/a1/9-moved.pdf';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2d: the agent deleted a contract moved into a1'; end if;
  delete from storage.objects where name like '%/a1/10-moved.pdf';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2d: the agent deleted an agreement moved into a1'; end if;

  -- 14. Moving files (H6). The agent moves their own unsaved upload into the
  --     new listing, the way moveStagedEvidence does...
  reset role;
  insert into storage.objects (bucket_id, name, owner_id, created_at) values
    ('compliance-evidence', office || '/_pending/s1/a3/11-staged.pdf', ag1::text, now()),
    ('compliance-evidence', office || '/_pending/s2/a3/12-colleague-staged.pdf', ag2::text, now());
  set local role authenticated;
  update storage.objects set name = office || '/' || p1 || '/a3/11-staged.pdf'
   where name = office || '/_pending/s1/a3/11-staged.pdf';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 14: the agent could not move their own staged upload into the listing'; end if;
  -- ...but not a colleague's staged upload,
  update storage.objects set name = office || '/' || p1 || '/a3/12-taken.pdf'
   where name = office || '/_pending/s2/a3/12-colleague-staged.pdf';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 14: the agent moved a colleague''s staged upload'; end if;
  -- ...and cannot write over a filed document (the row half of an overwrite).
  update storage.objects set owner_id = ag1::text, metadata = '{}'::jsonb
   where name like '%/a3/10-moved.pdf' or name like '%/a3/11-staged.pdf';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 14: the agent overwrote a filed document'; end if;

  -- 15. A card names only a file in its own listing's folder (H7): not another
  --     listing's contract, not a path too long to be a file, and a card
  --     cannot be moved to another listing.
  blocked := false;
  begin
    update public.property_items set evidence_path = office || '/' || p1 || '/b1/9-contract.pdf'
     where property_id = p2 and item_key = 'a1';
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 15: a card was pointed at another listing''s file'; end if;
  blocked := false;
  begin
    update public.property_items set evidence_path = office || '/' || p2 || '/a1/' || repeat('x', 3200)
     where property_id = p2 and item_key = 'a1';
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 15: a card took a path longer than any file'; end if;
  blocked := false;
  begin
    update public.property_items set property_id = p2 where property_id = p1 and item_key = 'b1';
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 15: a card was moved to another listing'; end if;
  -- ...while a file in its own folder is still fine.
  update public.property_items set evidence_path = office || '/' || p2 || '/a1/13-own.pdf'
   where property_id = p2 and item_key = 'a1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 15: a card could not take a file in its own folder'; end if;

  -- 15a. A CPD record names only a file in that person's CPD folder (H7).
  blocked := false;
  begin
    insert into public.cpd_records (agency_id, profile_id, activity_name, evidence_path)
      values (office, ag1, 'Test CPD', office || '/' || p1 || '/b1/9-contract.pdf');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 15a: a CPD record was pointed at a listing''s file'; end if;
  insert into public.cpd_records (agency_id, profile_id, activity_name, evidence_path)
    values (office, ag1, 'Test CPD', office || '/_cpd/' || ag1 || '/14-cert.pdf');

  -- 15b. A file another card points at is "on a record", even when the card is
  --      on a different listing from the path (here written with full rights,
  --      as old data might be).
  reset role;
  insert into storage.objects (bucket_id, name, owner_id, created_at) values
    ('compliance-evidence', office || '/' || p1 || '/a1/15-fresh.pdf', ag1::text, now());
  update public.property_items set evidence_path = office || '/' || p1 || '/a1/15-fresh.pdf'
   where property_id = p2 and item_key = 'a1';
  set local role authenticated;
  delete from storage.objects where name like '%/a1/15-fresh.pdf';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 15b: the agent deleted a file a card on another listing points at'; end if;

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

  -- 10. Sign-off rows. Not on the licensee's trust reconciliation, so they
  --     cannot read it either.
  blocked := false;
  begin
    insert into public.signoff_signatures (document_id, agency_id, signer_id) values (recon, office, ag1);
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 10: an agent added themselves to a licensee-only document'; end if;
  blocked := false;
  begin
    insert into public.signoff_signatures (document_id, agency_id, signer_id, typed_name, signed_at)
      values (recon2, office, ag1, 'x', now());
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 10: an agent signed a licensee-only document'; end if;
  select count(*) into n from public.signoff_documents where id in (recon, recon2);
  if n <> 0 then raise exception 'FAIL 10: an agent can see a trust reconciliation'; end if;
  if public.evidence_path_readable(office || '/_signoffs/trust_reconciliation/1.pdf') then
    raise exception 'FAIL 10: an agent can read a trust reconciliation file';
  end if;
  -- Nor on another office's document.
  blocked := false;
  begin
    insert into public.signoff_signatures (document_id, agency_id, signer_id) values (other_doc, office, ag1);
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 10: an agent added themselves to another office''s document'; end if;

  -- 11. Signing the SG Manual the way signDocument does (an upsert of their own
  --     row with the signature on it) still works, and so does adding their own
  --     row to a document for all staff.
  insert into public.signoff_signatures (document_id, agency_id, signer_id, typed_name, signed_at)
    values (doc, office, ag1, 'Test Agent One', now())
    on conflict (document_id, signer_id) do update set typed_name = excluded.typed_name, signed_at = excluded.signed_at;
  select count(*) into n from public.signoff_signatures where document_id = doc and signer_id = ag1 and signed_at is not null;
  if n <> 1 then raise exception 'FAIL 11: the agent could not sign the SG Manual'; end if;
  insert into public.signoff_signatures (document_id, agency_id, signer_id) values (old_doc, office, ag1);

  -- 16. That row cannot be repointed at the licensee's trust reconciliation or
  --     another office's document (reading and signing it that way).
  blocked := false;
  begin
    update public.signoff_signatures set document_id = recon2 where document_id = old_doc and signer_id = ag1;
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 16: the agent repointed their sign-off row at a reconciliation'; end if;
  blocked := false;
  begin
    update public.signoff_signatures set document_id = other_doc where document_id = old_doc and signer_id = ag1;
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 16: the agent repointed their sign-off row at another office''s document'; end if;
  select count(*) into n from public.signoff_documents where id = recon2;
  if n <> 0 then raise exception 'FAIL 16: the agent can see the reconciliation'; end if;

  -- ══════════════ As the assistant on the agent plan ══════════════
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', solo_asst, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 4a. An assistant cannot record the customer, even on an agent plan...
  blocked := false;
  begin
    perform public.set_agency_stripe_customer('cus_TestSoloAsst1');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 4a: an assistant on an agent plan recorded the Stripe customer'; end if;

  -- ══════════════ As the agent on the agent plan ══════════════
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', solo_ag, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 4a. ...but the agent whose plan it is can.
  got := public.set_agency_stripe_customer('cus_TestSoloAgent1');
  if got is distinct from 'cus_TestSoloAgent1' then raise exception 'FAIL 4a: the agent on an agent plan could not record the customer'; end if;

  -- ══════════════ As the licensee ══════════════
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 14a. The licensee can still move a filed document (putting the contract back).
  update storage.objects set name = office || '/' || p1 || '/b1/9-contract.pdf'
   where name = office || '/' || p1 || '/a1/9-moved.pdf';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 14a: the licensee could not move a filed document'; end if;

  -- 6. The customer id cannot be written directly, even while it is empty:
  --    only set_agency_stripe_customer gets past the billing guard.
  blocked := false;
  begin
    update public.agencies set stripe_customer_id = 'cus_Direct3' where id = office;
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 6: the licensee set the customer id directly'; end if;

  -- 5. The licensee records the customer, and can replace it until there is
  --    a subscription.
  got := public.set_agency_stripe_customer('cus_TestFirst1');
  if got is distinct from 'cus_TestFirst1' then raise exception 'FAIL 5: the customer id was not recorded'; end if;
  got := public.set_agency_stripe_customer('cus_TestSecond2');
  if got is distinct from 'cus_TestSecond2' then raise exception 'FAIL 5: a customer could not be replaced before there was a subscription'; end if;

  -- 5a. Not with another office's customer, or something that isn't one.
  state := null;
  begin
    perform public.set_agency_stripe_customer('cus_TestOtherOffice9');
  exception when others then state := sqlstate; end;
  if state is distinct from '23505' then raise exception 'FAIL 5a: another office''s Stripe customer was recorded (%)', state; end if;
  state := null;
  begin
    perform public.set_agency_stripe_customer('sub_NotACustomer');
  exception when others then state := sqlstate; end;
  if state is distinct from '22023' then raise exception 'FAIL 5a: something that is not a customer id was recorded (%)', state; end if;

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

  -- 10a. The licensee signs a reconciliation they had no row on (signDocument's
  --      upsert), and lists someone missing from a document, unsigned.
  insert into public.signoff_signatures (document_id, agency_id, signer_id, typed_name, signed_at)
    values (recon2, office, lic, 'Test Licensee', now())
    on conflict (document_id, signer_id) do update set typed_name = excluded.typed_name, signed_at = excluded.signed_at;
  insert into public.signoff_signatures (document_id, agency_id, signer_id) values (old_doc, office, ag2);
  select count(*) into n from public.signoff_signatures
   where (document_id = recon2 and signer_id = lic and signed_at is not null)
      or (document_id = old_doc and signer_id = ag2 and signed_at is null);
  if n <> 2 then raise exception 'FAIL 10a: the licensee could not sign or list a signer'; end if;

  -- 16a. But not on another office's document.
  blocked := false;
  begin
    insert into public.signoff_signatures (document_id, agency_id, signer_id) values (other_doc, office, ag2);
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 16a: the licensee listed a signer on another office''s document'; end if;

  -- 17. A listing whose card holds a path too long to be a file (old data,
  --     written here with full rights) can still be deleted.
  reset role;
  -- (random characters: a repeated one compresses and would fit the index)
  update public.property_items
     set evidence_path = office || '/' || p2 || '/a1/' || (select string_agg(md5(g::text || clock_timestamp()::text), '') from generate_series(1, 100) g)
   where property_id = p2 and item_key = 'a1';
  set local role authenticated;
  delete from public.properties where id = p2;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 17: the licensee could not delete a listing with a very long card path'; end if;

  -- ══════════════ The webhook records a subscription ══════════════
  reset role;
  perform set_config('request.jwt.claims', '', true);
  update public.agencies set stripe_subscription_id = 'sub_TestOffice1' where id = office;
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 5b. From then on, the subscription's customer stays.
  got := public.set_agency_stripe_customer('cus_TestThird3');
  if got is distinct from 'cus_TestSecond2' then raise exception 'FAIL 5b: the customer of a running subscription was replaced'; end if;
  select stripe_customer_id into got from public.agencies where id = office;
  if got is distinct from 'cus_TestSecond2' then raise exception 'FAIL 5b: the recorded customer changed'; end if;

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

  -- 12. Someone the licensee has removed can tell that they were removed;
  --     nobody else is.
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set archived_at = now() where id = ag2;
  perform set_config('request.jwt.claims', json_build_object('sub', ag2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.my_profile_is_archived() then raise exception 'FAIL 12: a removed person was not told they were removed'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', newbie, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.my_profile_is_archived() then raise exception 'FAIL 12: someone still in the office was told they were removed'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.my_profile_is_archived() then raise exception 'FAIL 12: someone with no profile was told they were removed'; end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- 13. The office can still be deleted (the end-of-subscription job deletes
  --     the agency row and everything cascades from it), with files on record.
  delete from public.agencies where id = office;
  select count(*) into n from public.evidence_files_once_on_record where agency_id = office;
  if n <> 0 then raise exception 'FAIL 13: % file records outlived their agency', n; end if;

  raise notice 'Check fixes: all checks passed';
end
$$;

rollback;
