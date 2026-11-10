-- ===== READ ONLY. Delete an ESP revision, 10 November 2026 =====
--
-- Proves supabase/migrations/0124_esp_revision_delete.sql. Run after it. Safe
-- on the live database: everything happens inside one transaction that is
-- rolled back at the end, so the made-up offices, people and listings it
-- creates never exist outside it.
--
-- Pass: the last line says "Delete an ESP revision: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1   uuid := gen_random_uuid();  -- the office
  o2   uuid := gen_random_uuid();  -- another office
  lic  uuid := gen_random_uuid();  -- o1's licensee in charge
  ag   uuid := gen_random_uuid();  -- o1's agent, whose listings they are
  asst uuid := gen_random_uuid();  -- o1's assistant
  x    uuid := gen_random_uuid();  -- an agent in o2
  p1   uuid;
  p2   uuid;
  f1   text;
  f2   text;
  n    integer;
  c0   integer;  -- price statement cancellations before a step
  gone text[];
  r    record;
begin
  insert into auth.users (id, email) values
    (lic, 'del-lic@example.invalid'), (ag, 'del-ag@example.invalid'),
    (asst, 'del-asst@example.invalid'), (x, 'del-x@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'Delete Revision Office (made up)', 'office_1', 'active', 'Lou Licensee', 'del-lou@example.invalid'),
    (o2, 'Other Delete Office (made up)', 'office_1', 'active', 'Oli Licensee', 'del-oli@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (lic, o1, 'Lou Licensee', 'del-lic@example.invalid', true, true, false),
    (ag, o1, 'Ana Agent', 'del-ag@example.invalid', true, false, false),
    (asst, o1, 'Asha Assistant', 'del-asst@example.invalid', false, false, true),
    (x, o2, 'Xan Agent', 'del-x@example.invalid', true, false, false);
  insert into public.properties (agency_id, created_by, address) values (o1, ag, '8 Delete Lane (made up)') returning id into p1;
  insert into public.properties (agency_id, created_by, address) values (o1, ag, '10 Delete Lane (made up)') returning id into p2;
  f1 := o1::text || '/' || p1::text || '/d3/';
  f2 := o1::text || '/' || p2::text || '/d3/';
  insert into public.property_items (agency_id, property_id, item_key, status, data) values
    (o1, p1, 'a4', 'done', '{"espLow": 1400000, "espHigh": 1450000}'),
    (o1, p1, 'd3', 'open', '{"espRevised": true}'),
    (o1, p2, 'a4', 'done', '{"espLow": 900000, "espHigh": 950000}'),
    (o1, p2, 'd3', 'open', '{"espRevised": true}');

  -- Revisions 1, 2 and 3 on p1, by the agent. Revision 2 has its own
  -- evidence file and a market feedback record.
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.record_esp_revision(p1, 1300000, 1360000, date '2026-10-14', f1 || '1-notice.pdf', 'Notice 1.pdf',
                                     false, 'Email', null, '{"evidenceProvidedBeforeNotice": true, "advertisingUpdated": true}', 'done');
  perform public.record_esp_revision(p1, 1200000, 1250000, date '2026-10-28', f1 || '2-notice.pdf', 'Notice 2.pdf',
                                     true, 'By hand', null, '{"evidenceProvidedBeforeNotice": true, "advertisingUpdated": true}', 'done',
                                     1300000, 1360000, f1 || '2-evidence.pdf', 'Evidence 2.pdf', false,
                                     jsonb_build_array(jsonb_build_object('kind', 'file', 'path', f1 || '2-feedback.pdf', 'name', 'Feedback.pdf')),
                                     '[]'::jsonb, null, null);
  perform public.record_esp_revision(p1, 1150000, 1200000, date '2026-11-03', f1 || '3-notice.pdf', 'Notice 3.pdf',
                                     false, 'Email', null, '{"evidenceProvidedBeforeNotice": true, "advertisingUpdated": true}', 'done');
  reset role;
  -- The price statement approved against Revision 3.
  insert into public.property_items (agency_id, property_id, item_key, status, data)
  values (o1, p1, 'b4', 'done', jsonb_build_object('tickedBy', ag, 'tickedAt', now(), 'note', 'Price guide $1.15m'));
  select count(*) into c0 from public.listing_signoff_cancellations where property_id = p1 and item_key = 'b4';

  -- 1. Nobody else deletes one: not an assistant, not another office, not signed out.
  perform set_config('request.jwt.claims', json_build_object('sub', asst, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.delete_esp_revision(p1, 2);
    raise exception 'FAIL 1a: an assistant deleted a revision';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.delete_esp_revision(p1, 2);
    raise exception 'FAIL 1b: another office deleted a revision';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    perform public.delete_esp_revision(p1, 2);
    raise exception 'FAIL 1c: signed out deleted a revision';
  exception when insufficient_privilege then null;
  end;
  reset role;
  -- Signed in, nobody deletes or renumbers a revision directly either.
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    delete from public.esp_revisions where property_id = p1;
    raise exception 'FAIL 1d: a revision was deleted directly';
  exception when insufficient_privilege then null;
  end;

  -- 2. The agent deletes Revision 2, an earlier one. It's gone, with no trace;
  --    Revision 3 becomes Revision 2 and still drives every check; the
  --    approval given against those figures stands; its three files come back
  --    for the app to remove.
  gone := public.delete_esp_revision(p1, 2);
  reset role;
  select count(*) into n from public.esp_revisions where property_id = p1;
  if n <> 2 then raise exception 'FAIL 2a: % revisions left of 2', n; end if;
  if (select string_agg(revision_no || ':' || esp_low::bigint, ',' order by revision_no) from public.esp_revisions where property_id = p1)
     <> '1:1300000,2:1150000' then
    raise exception 'FAIL 2b: the revisions now read %',
      (select string_agg(revision_no || ':' || esp_low::bigint, ',' order by revision_no) from public.esp_revisions where property_id = p1); end if;
  select * into r from public.property_items where property_id = p1 and item_key = 'd3';
  if (r.data ->> 'latestRevision')::int <> 2 or (r.data ->> 'revisedEspLow')::numeric <> 1150000 or r.status <> 'done'
     or r.evidence_path <> f1 || '3-notice.pdf' then
    raise exception 'FAIL 2c: the card holds %', row_to_json(r); end if;
  if (select esp_low from public.listing_effective_esp(p1)) <> 1150000 then
    raise exception 'FAIL 2d: the checks don''t read the newest revision'; end if;
  if (select status from public.property_items where property_id = p1 and item_key = 'b4') <> 'done'
     or (select count(*) from public.listing_signoff_cancellations where property_id = p1 and item_key = 'b4') <> c0 then
    raise exception 'FAIL 2e: deleting an earlier revision cancelled the approval of an ESP that didn''t change'; end if;
  if gone is null or array_length(gone, 1) <> 3
     or not (f1 || '2-notice.pdf' = any (gone) and f1 || '2-evidence.pdf' = any (gone) and f1 || '2-feedback.pdf' = any (gone)) then
    raise exception 'FAIL 2f: files to remove: %', gone; end if;

  -- 3. The licensee deletes the newest. The card goes back to Revision 1 and
  --    asks again whether the advertising matches it; the approval given
  --    against the figures that went is cancelled.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  gone := public.delete_esp_revision(p1, 2);
  reset role;
  select * into r from public.property_items where property_id = p1 and item_key = 'd3';
  if (r.data ->> 'latestRevision')::int <> 1 or (r.data ->> 'revisedEspLow')::numeric <> 1300000
     or (r.data ->> 'revisedEspHigh')::numeric <> 1360000 or r.evidence_path <> f1 || '1-notice.pdf'
     or r.data ->> 'evidenceFileName' <> 'Notice 1.pdf' or r.data ->> 'noticeServedOn' <> '2026-10-14'
     or r.status <> 'open' or (r.data ->> 'advertisingUpdated')::boolean
     or r.data -> 'outstanding' <> jsonb_build_array('The advertising has not been confirmed as updated to the revised price (s73(3)).') then
    raise exception 'FAIL 3a: the card holds %', row_to_json(r); end if;
  if (select esp_low from public.listing_effective_esp(p1)) <> 1300000 then
    raise exception 'FAIL 3b: the checks don''t read Revision 1'; end if;
  if (select status from public.property_items where property_id = p1 and item_key = 'b4') <> 'open'
     or (select count(*) from public.listing_signoff_cancellations
          where property_id = p1 and item_key = 'b4' and because_item_key = 'd3' and because = 'esp_changed') < 1 then
    raise exception 'FAIL 3c: the approval of the figures that went still stands'; end if;
  if gone <> array[f1 || '3-notice.pdf'] then raise exception 'FAIL 3d: files to remove: %', gone; end if;

  -- 4. The last one: the card asks again, and the checks read the agreement's ESP.
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated')::text, true);
  set local role authenticated;
  gone := public.delete_esp_revision(p1, 1);
  reset role;
  select * into r from public.property_items where property_id = p1 and item_key = 'd3';
  if r.data ?| array['espRevised', 'revisedEspLow', 'latestRevision', 'advertisingUpdated', 'outstanding', 'evidenceFileName']
     or r.evidence_path is not null or r.status <> 'open' or r.completed_by is not null then
    raise exception 'FAIL 4a: with none left the card holds %', row_to_json(r); end if;
  if (select esp_low from public.listing_effective_esp(p1)) <> 1400000 then
    raise exception 'FAIL 4b: the checks don''t read the agreement''s ESP'; end if;
  if (select count(*) from public.esp_revisions where property_id = p1) <> 0 then
    raise exception 'FAIL 4c: a revision is left'; end if;

  -- 5. A new one is Revision 1 again, and a new revision still cancels an approval.
  update public.property_items set status = 'done' where property_id = p1 and item_key = 'b4';
  select count(*) into c0 from public.listing_signoff_cancellations where property_id = p1 and item_key = 'b4';
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.record_esp_revision(p1, 1350000, 1390000, date '2026-11-05', f1 || '4-notice.pdf', 'Notice 4.pdf',
                                     false, null, null, '{}', 'done');
  reset role;
  if (select revision_no from public.esp_revisions where property_id = p1) <> 1 then
    raise exception 'FAIL 5a: the next revision isn''t Revision 1'; end if;
  if (select count(*) from public.listing_signoff_cancellations where property_id = p1 and item_key = 'b4') <> c0 + 1 then
    raise exception 'FAIL 5b: a new revision no longer cancels the approval'; end if;

  -- 6. The newest deleted where the one before has the same figures: the
  --    card stays done, nothing to confirm again, the approval stands.
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.record_esp_revision(p2, 850000, 900000, date '2026-10-20', f2 || 'a.pdf', 'A.pdf', false, null, null,
                                     '{"evidenceProvidedBeforeNotice": true, "advertisingUpdated": true}', 'done');
  perform public.record_esp_revision(p2, 850000, 900000, date '2026-10-21', f2 || 'b.pdf', 'B.pdf', false, null, null,
                                     '{"evidenceProvidedBeforeNotice": true, "advertisingUpdated": true}', 'done');
  reset role;
  insert into public.property_items (agency_id, property_id, item_key, status, data)
  values (o1, p2, 'b4', 'done', jsonb_build_object('tickedBy', ag, 'tickedAt', now()));
  set local role authenticated;
  gone := public.delete_esp_revision(p2, 2);
  reset role;
  select * into r from public.property_items where property_id = p2 and item_key = 'd3';
  if r.status <> 'done' or (r.data ->> 'latestRevision')::int <> 1 or r.evidence_path <> f2 || 'a.pdf'
     or not (r.data ->> 'advertisingUpdated')::boolean then
    raise exception 'FAIL 6a: the card holds %', row_to_json(r); end if;
  if (select status from public.property_items where property_id = p2 and item_key = 'b4') <> 'done' then
    raise exception 'FAIL 6b: the approval of unchanged figures was cancelled'; end if;

  -- 7. A file the card's draft still uses is never handed back for removal.
  set local role authenticated;
  perform public.record_esp_revision(p2, 800000, 840000, date '2026-11-01', f2 || 'c.pdf', 'C.pdf', false, null, null, '{}', 'done');
  reset role;
  update public.property_items set data = data || jsonb_build_object('pending', jsonb_build_object('path', f2 || 'c.pdf'))
   where property_id = p2 and item_key = 'd3';
  set local role authenticated;
  gone := public.delete_esp_revision(p2, 2);
  reset role;
  if coalesce(array_length(gone, 1), 0) <> 0 then raise exception 'FAIL 7: a file in use was handed back: %', gone; end if;

  -- 8. Signed off: reopen first, the licensee too. Withdrawn: put it back first.
  insert into public.property_items (agency_id, property_id, item_key, status, data) values (o1, p2, 'sign_licensee', 'done', '{}');
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.delete_esp_revision(p2, 1);
    raise exception 'FAIL 8a: deleted on a signed-off file';
  exception when raise_exception then
    if sqlerrm not like 'This file is signed off.%' then raise; end if;
  end;
  reset role;
  delete from public.property_items where property_id = p2 and item_key = 'sign_licensee';
  insert into public.listing_withdrawals (agency_id, property_id, withdrawn_on, reason, withdrawn_by)
  values (o1, p2, date '2026-11-06', 'seller_changed_mind', ag);
  set local role authenticated;
  begin
    perform public.delete_esp_revision(p2, 1);
    raise exception 'FAIL 8b: deleted on a withdrawn listing';
  exception when raise_exception then
    if sqlerrm not like 'This listing is withdrawn from sale.%' then raise; end if;
  end;
  reset role;
  update public.listing_withdrawals set put_back_at = now(), put_back_by = ag where property_id = p2;

  -- 9. A statement of information prepared for it keeps it.
  insert into public.statements_of_information (agency_id, property_id, version_no, source, pdf_path, esp_revision_no)
  values (o1, p2, 1, 'uploaded', o1::text || '/' || p2::text || '/soi/s.pdf', 1);
  set local role authenticated;
  begin
    perform public.delete_esp_revision(p2, 1);
    raise exception 'FAIL 9: deleted a revision a statement of information was prepared for';
  exception when raise_exception then
    if sqlerrm not like 'A statement of information was prepared%' then raise; end if;
  end;
  begin
    perform public.delete_esp_revision(p2, 9);
    raise exception 'FAIL 9b: deleted a revision that isn''t there';
  exception when raise_exception then
    if sqlerrm not like 'That revision isn''t on this listing.%' then raise; end if;
  end;
  reset role;

  raise notice 'Delete an ESP revision: all checks passed';
end $$;

rollback;
