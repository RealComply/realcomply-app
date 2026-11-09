-- ===== READ ONLY. Licensee sign-off links: per item and the monthly pack, for a licensee with no login, 3 November 2026 =====
--
-- Proves supabase/migrations/0113_licensee_links.sql, with the engine from
-- 0109. Run after 0113. (Split out of 0109's test on 4 Nov 2026; 0109's own
-- test is licensee_signoff_engine.sql.)
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up office, people and records it
-- creates never exist outside it.
--
-- Pass: the last line says "Licensee sign-off links: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1 uuid := gen_random_uuid();   -- an office whose licensee has no login
  m  uuid := gen_random_uuid();   -- its office manager
  a  uuid := gen_random_uuid();   -- an agent
  pa uuid := gen_random_uuid();   -- a's listing
  ta uuid := gen_random_uuid();   -- the sales trust account
  req uuid;                       -- a's sign-off request
  rec uuid;                       -- September's reconciliation
  rec_old uuid;                   -- an earlier upload for September
  sg uuid;                        -- the SG Manual version
  aud uuid;                       -- the yearly trust audit
  tp uuid;                        -- a's training plan
  cp uuid;                        -- a resolved complaint
  gf uuid;                        -- a gift over the limit
  pk uuid;                        -- October's pack
  held uuid;                      -- the pack item held back
  r record;
  n integer;
begin
  insert into auth.users (id, email) values (m, 'lse-m@example.invalid'), (a, 'lse-a@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'LSE Office (made up)', 'office_3', 'active', 'Lou Licensee', 'lse-lou@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (m, o1, 'Mel Manager', 'lse-m@example.invalid', true, false, false),
    (a, o1, 'Ana Agent', 'lse-a@example.invalid', true, false, false);
  insert into public.office_managers (agency_id, profile_id, wording, approved_via, approved_by_name)
  values (o1, m, 'I authorise Mel Manager to manage LSE Office''s RealComply account as office manager.', 'email_link', 'Lou Licensee');
  insert into public.properties (id, agency_id, created_by, address) values (pa, o1, a, '5 Made Up Street, Nowhere NSW (made up)');
  insert into public.trust_accounts (id, agency_id, name) values (ta, o1, 'Sales trust account (made up)');
  insert into public.property_signoff_requests (agency_id, property_id, statement, sent_to, created_by)
  values (o1, pa, 'I sign off this file (made up).', 'lse-lou@example.invalid', a) returning id into req;
  insert into public.signoff_documents (agency_id, category, title, file_path, file_name, signer_scope, uploaded_by,
                                        period_month, trust_account_id, created_at)
  values (o1, 'trust_reconciliation', 'September (made up)', o1 || '/_signoffs/old.pdf', 'old.pdf', 'licensee_only', m,
          date '2026-09-01', ta, now() - interval '1 day') returning id into rec_old;
  insert into public.signoff_documents (agency_id, category, title, file_path, file_name, signer_scope, uploaded_by,
                                        period_month, trust_account_id)
  values (o1, 'trust_reconciliation', 'September (made up)', o1 || '/_signoffs/sep.pdf', 'sep.pdf', 'licensee_only', m,
          date '2026-09-01', ta) returning id into rec;
  insert into public.signoff_documents (agency_id, category, title, file_path, file_name, signer_scope, uploaded_by)
  values (o1, 'sg_manual', 'SG Manual v2 (made up)', o1 || '/_sg-manual/v2.pdf', 'v2.pdf', 'all_staff', m) returning id into sg;
  insert into public.training_plans (agency_id, profile_id, cpd_year_start, staff_signed_name, staff_signed_at, created_by)
  values (o1, a, date '2026-07-01', 'Ana Agent', now(), m) returning id into tp;
  insert into public.complaints (agency_id, received_date, complainant, nature, status, resolved_date, created_by)
  values (o1, date '2026-10-02', 'P. Lim (made up)', 'Calls', 'resolved', date '2026-10-20', m) returning id into cp;
  insert into public.gifts (agency_id, profile_id, gift_date, description, value, direction, status, created_by)
  values (o1, a, current_date, 'Wine (made up)', 90, 'received', 'flagged', a) returning id into gf;

  -- 1. The office manager enters the trust audit; it isn't confirmed, and
  --    a confirmation they send is ignored.
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.trust_audits (agency_id, trust_account_id, period_end, auditor_name, confirmed_by, confirmed_at)
  values (o1, ta, date '2026-06-30', 'A. Auditor (made up)', m, now()) returning id into aud;
  reset role;
  select entered_by, entered_by_name, confirmed_at into r from public.trust_audits where id = aud;
  if r.entered_by <> m or r.entered_by_name <> 'Mel Manager' or r.confirmed_at is not null then
    raise exception 'FAIL 1: the audit was recorded as %', row_to_json(r);
  end if;

  -- 2. Everything is waiting; the earlier September upload is not.
  if not (public.licensee_item_waiting(o1, 'sales_file', req) and public.licensee_item_waiting(o1, 'trust_reconciliation', rec)
          and public.licensee_item_waiting(o1, 'sg_manual', sg) and public.licensee_item_waiting(o1, 'trust_audit', aud)
          and public.licensee_item_waiting(o1, 'training_plan', tp) and public.licensee_item_waiting(o1, 'complaint', cp)
          and public.licensee_item_waiting(o1, 'gift', gf)) then
    raise exception 'FAIL 2: not every item reads as waiting';
  end if;
  if public.licensee_item_waiting(o1, 'trust_reconciliation', rec_old) then
    raise exception 'FAIL 2b: a replaced upload reads as waiting';
  end if;

  -- 3. Nobody signed in can sign through the engine directly.
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.licensee_sign_item(o1, 'gift', gf, null, 'Mel Manager', 'app');
    raise exception 'FAIL 3: the office manager signed through the engine';
  exception when insufficient_privilege then null;
  end;
  begin
    perform token from public.licensee_links;
    raise exception 'FAIL 3b: a link token was readable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_licensee_signoff_mode('monthly');
  end;
  reset role;
  select licensee_signoff_mode, licensee_signoff_mode_set_by_name into r from public.agencies where id = o1;
  if r.licensee_signoff_mode <> 'monthly' or r.licensee_signoff_mode_set_by_name <> 'Mel Manager' then
    raise exception 'FAIL 3c: the setting was recorded as %', row_to_json(r);
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_licensee_signoff_mode('as_they_come');
    raise exception 'FAIL 3d: an agent changed the setting';
  exception when insufficient_privilege then null;
  end;
  update public.agencies set licensee_signoff_mode = 'as_they_come' where id = o1;
  reset role;
  if (select licensee_signoff_mode from public.agencies where id = o1) <> 'monthly' then
    raise exception 'FAIL 3e: the setting was changed directly';
  end if;

  -- 4. The pack is sent (as the server does) with every item; one held back at signing.
  insert into public.signoff_packs (agency_id, month, sent_at, sent_by, sent_by_name)
  values (o1, date '2026-10-01', now(), m, 'Mel Manager') returning id into pk;
  insert into public.signoff_pack_items (pack_id, agency_id, item_type, item_id, grp, title) values
    (pk, o1, 'sales_file', req, 'sales', '5 Made Up Street'),
    (pk, o1, 'trust_reconciliation', rec, 'trust', 'September reconciliation'),
    (pk, o1, 'trust_audit', aud, 'trust', 'Trust audit'),
    (pk, o1, 'sg_manual', sg, 'office', 'SG Manual v2'),
    (pk, o1, 'training_plan', tp, 'office', 'Training plan for Ana Agent'),
    (pk, o1, 'complaint', cp, 'office', 'Complaint resolved'),
    (pk, o1, 'gift', gf, 'office', 'Gift over $60');
  select id into held from public.signoff_pack_items where pack_id = pk and item_type = 'gift';
  -- The gift is reviewed some other way? No: held back, with a note.
  begin
    perform * from public.licensee_sign_pack(pk, null, 'Lou Licensee', 'link', jsonb_build_array(jsonb_build_object('id', held)));
    raise exception 'FAIL 4: held back without a note';
  exception when raise_exception then
    if sqlerrm not like 'Add a short note%' then raise; end if;
  end;
  select * into r from public.licensee_sign_pack(pk, null, 'Lou Licensee', 'link',
    jsonb_build_array(jsonb_build_object('id', held, 'note', 'Ask the agent who gave it (made up).')));
  if r.signed <> 6 or r.held <> 1 or r.skipped <> 0 then raise exception 'FAIL 4b: the pack signed as %', row_to_json(r); end if;

  -- 5. Each item is completed in its own place, as if signed singly.
  select signed_name into r from public.property_signoff_requests where id = req;
  if r.signed_name <> 'Lou Licensee' then raise exception 'FAIL 5: the sales file request wasn''t signed'; end if;
  select status, data into r from public.property_items where property_id = pa and item_key = 'sign_licensee';
  if r.status <> 'done' or r.data ->> 'signedVia' <> 'link' or r.data ->> 'packId' <> pk::text then
    raise exception 'FAIL 5b: the licensee signature card reads %', row_to_json(r);
  end if;
  select signer_id, typed_name, signed_via into r from public.signoff_signatures where document_id = rec and signed_at is not null;
  if r.signer_id is not null or r.typed_name <> 'Lou Licensee' or r.signed_via <> 'link' then
    raise exception 'FAIL 5c: the reconciliation signature reads %', row_to_json(r);
  end if;
  select count(*) into n from public.signoff_signatures where document_id = sg and signed_at is not null and signer_id is null;
  if n <> 1 then raise exception 'FAIL 5d: the SG Manual wasn''t signed for the licensee'; end if;
  select confirmed_name, confirmed_via, confirmed_by into r from public.trust_audits where id = aud;
  if r.confirmed_name <> 'Lou Licensee' or r.confirmed_via <> 'link' or r.confirmed_by is not null then
    raise exception 'FAIL 5e: the audit confirmation reads %', row_to_json(r);
  end if;
  select principal_signed_name, principal_signed_via into r from public.training_plans where id = tp;
  if r.principal_signed_name <> 'Lou Licensee' or r.principal_signed_via <> 'link' then raise exception 'FAIL 5f: training plan'; end if;
  select signed_off_name, signed_off_via into r from public.complaints where id = cp;
  if r.signed_off_name <> 'Lou Licensee' or r.signed_off_via <> 'link' then raise exception 'FAIL 5g: complaint'; end if;
  -- The held-back gift is still waiting, with the licensee's note on the pack.
  if not public.licensee_item_waiting(o1, 'gift', gf) then raise exception 'FAIL 5h: the held-back gift was signed'; end if;
  select held_back_note into r from public.signoff_pack_items where id = held;
  if r.held_back_note <> 'Ask the agent who gave it (made up).' then raise exception 'FAIL 5i: the hold-back note was lost'; end if;
  select signed_name, signed_via into r from public.signoff_packs where id = pk;
  if r.signed_name <> 'Lou Licensee' or r.signed_via <> 'link' then raise exception 'FAIL 5j: the pack reads %', row_to_json(r); end if;

  -- 6. Signed once: the pack can't be signed again, and nothing signs twice.
  begin
    perform * from public.licensee_sign_pack(pk, null, 'Lou Licensee', 'link', '[]'::jsonb);
    raise exception 'FAIL 6: a signed pack was signed again';
  exception when raise_exception then
    if sqlerrm not like 'That pack is already signed%' then raise; end if;
  end;
  if public.licensee_sign_item(o1, 'complaint', cp, null, 'Lou Licensee', 'link') then
    raise exception 'FAIL 6b: a signed complaint was signed again';
  end if;
  begin
    insert into public.signoff_signatures (document_id, agency_id, signer_id, typed_name, signed_at, signed_via)
    values (rec, o1, null, 'Someone else', now(), 'link');
    raise exception 'FAIL 6c: a second signature without a login went on a reconciliation';
  exception when unique_violation then null;
  end;

  -- 7. The office manager changes a confirmed audit's details: it needs confirming again.
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.trust_audits set auditor_name = 'B. Auditor (made up)' where id = aud;
  reset role;
  select confirmed_at into r from public.trust_audits where id = aud;
  if r.confirmed_at is not null then raise exception 'FAIL 7: changed details kept the earlier confirmation'; end if;
  if not public.licensee_item_waiting(o1, 'trust_audit', aud) then raise exception 'FAIL 7b: it isn''t waiting again'; end if;

  raise notice 'Licensee sign-off links: all checks passed';
end $$;

rollback;
