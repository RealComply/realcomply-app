-- ===== READ ONLY. ESP revision history, 3 November 2026 =====
--
-- Proves supabase/migrations/0110_esp_revision_history.sql. Run after it. Safe
-- on the live database: everything happens inside one transaction that is
-- rolled back at the end, so the made-up offices, people and listings it
-- creates never exist outside it.
--
-- Pass: the last line says "ESP revision history: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1  uuid := gen_random_uuid();  -- the office
  o2  uuid := gen_random_uuid();  -- another office
  a   uuid := gen_random_uuid();  -- o1's agent, whose listing p1 is
  x   uuid := gen_random_uuid();  -- an agent in o2
  p1  uuid;
  n   integer;
  r   record;
  folder text;
begin
  insert into auth.users (id, email) values (a, 'er-a@example.invalid'), (x, 'er-x@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'ER Office One (made up)', 'office_1', 'active', 'Lou Licensee', 'er-lou@example.invalid'),
    (o2, 'ER Office Two (made up)', 'office_1', 'active', 'Other Licensee', 'er-other@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (a, o1, 'Ana Agent', 'er-a@example.invalid', true, false, false),
    (x, o2, 'Xan Agent', 'er-x@example.invalid', true, false, false);
  insert into public.properties (agency_id, created_by, address) values (o1, a, '12 Harbour Street (made up)') returning id into p1;
  folder := o1::text || '/' || p1::text || '/d3/';
  -- The original ESP, and an approved price statement.
  insert into public.property_items (agency_id, property_id, item_key, status, data) values
    (o1, p1, 'a4', 'done', '{"espLow": 1400000, "espHigh": 1450000}'),
    (o1, p1, 'b4', 'done', jsonb_build_object('tickedBy', a, 'tickedAt', now() - interval '3 days', 'note', 'Price guide $1.4m'));
  -- The agent answered Yes on the card.
  insert into public.property_items (agency_id, property_id, item_key, status, data)
  values (o1, p1, 'd3', 'open', '{"espRevised": true}');

  -- 1. Revision 1, recorded by the agent: the row, the card's latest, the approval cancelled.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := public.record_esp_revision(p1, 1300000, 1360000, date '2026-10-14', folder || '1-notice.jpg', 'Revised ESP notice 14 Oct.jpg',
                                  false, 'Email', 'Buyer feedback', '{"evidenceProvidedBeforeNotice": true, "advertisingUpdated": true}', 'done');
  reset role;
  if n <> 1 then raise exception 'FAIL 1: the first revision was numbered %', n; end if;
  select * into r from public.esp_revisions where property_id = p1 and revision_no = 1;
  if r.esp_low <> 1300000 or r.esp_high <> 1360000 or r.notice_given_on <> date '2026-10-14' or r.recorded_by <> a
     or r.recorded_by_name <> 'Ana Agent' or r.notice_file_name <> 'Revised ESP notice 14 Oct.jpg' then
    raise exception 'FAIL 1b: revision 1 was recorded as %', row_to_json(r); end if;
  select * into r from public.property_items where property_id = p1 and item_key = 'd3';
  if r.status <> 'done' or r.evidence_path <> folder || '1-notice.jpg' or (r.data ->> 'revisedEspLow')::numeric <> 1300000
     or (r.data ->> 'latestRevision')::int <> 1 or r.completed_by <> a then
    raise exception 'FAIL 1c: the card holds %', row_to_json(r); end if;
  select count(*) into n from public.listing_signoff_cancellations
   where property_id = p1 and item_key = 'b4' and because_item_key = 'd3' and because = 'esp_changed';
  if n <> 1 then raise exception 'FAIL 1d: % approval cancellations after revision 1', n; end if;
  if (select status from public.property_items where property_id = p1 and item_key = 'b4') <> 'open' then
    raise exception 'FAIL 1e: the price statement approval is still done'; end if;
  if (select esp_low from public.listing_effective_esp(p1)) <> 1300000 then
    raise exception 'FAIL 1f: the checks don''t read revision 1'; end if;

  -- 2. Approved again; Revision 2 with the SAME figures still cancels it, and
  --    Revision 1 and its notice stay exactly as they were.
  update public.property_items set status = 'done', data = data || jsonb_build_object('tickedBy', a, 'tickedAt', now())
   where property_id = p1 and item_key = 'b4';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := public.record_esp_revision(p1, 1300000, 1360000, date '2026-10-28', folder || '2-notice.pdf', 'Revised ESP notice 28 Oct.pdf',
                                  false, null, null, '{}', 'open');
  reset role;
  if n <> 2 then raise exception 'FAIL 2: the second revision was numbered %', n; end if;
  select count(*) into n from public.listing_signoff_cancellations where property_id = p1 and item_key = 'b4';
  if n <> 2 then raise exception 'FAIL 2b: % approval cancellations after revision 2 (same figures)', n; end if;
  select * into r from public.esp_revisions where property_id = p1 and revision_no = 1;
  if r.notice_path <> folder || '1-notice.jpg' or r.notice_given_on <> date '2026-10-14' then
    raise exception 'FAIL 2c: revision 1 changed: %', row_to_json(r); end if;
  if (select evidence_path from public.property_items where property_id = p1 and item_key = 'd3') <> folder || '2-notice.pdf' then
    raise exception 'FAIL 2d: the card''s notice is not the latest'; end if;

  -- 3. Revision 3 with new figures: the checks read the latest, never the first.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := public.record_esp_revision(p1, 1250000, 1300000, date '2026-11-01', folder || '3-notice.pdf', 'Notice 3.pdf',
                                  true, null, null, '{}', 'done');
  reset role;
  select esp_low, esp_high into r from public.listing_effective_esp(p1);
  if r.esp_low <> 1250000 or r.esp_high <> 1300000 then
    raise exception 'FAIL 3: the checks read % to %, not the latest', r.esp_low, r.esp_high; end if;

  -- 4. Nobody signed in can change or delete a revision.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.esp_revisions set esp_low = 1 where property_id = p1;
    raise exception 'FAIL 4: a revision was changed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.esp_revisions where property_id = p1;
    raise exception 'FAIL 4b: a revision was deleted';
  exception when insufficient_privilege then null;
  end;

  -- 5. Who, when and the number are the database's: a forged row is stamped.
  insert into public.esp_revisions (agency_id, property_id, revision_no, esp_low, esp_high, notice_path, recorded_by, recorded_by_name, recorded_at)
  values (o1, p1, 99, 1200000, 1250000, folder || '4.pdf', x, 'Someone Else', now() - interval '1 year');
  reset role;
  select * into r from public.esp_revisions where property_id = p1 order by revision_no desc limit 1;
  if r.revision_no <> 4 or r.recorded_by <> a or r.recorded_by_name <> 'Ana Agent' or r.recorded_at < now() - interval '1 minute' then
    raise exception 'FAIL 5: a forged revision kept %', row_to_json(r); end if;

  -- 6. A notice outside the listing's own folder is refused.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.record_esp_revision(p1, 1, 2, null, o2::text || '/elsewhere/d3/x.pdf', 'x.pdf', false, null, null, '{}', 'open');
    raise exception 'FAIL 6: a notice from another folder was taken';
  exception when sqlstate 'P0001' then null;
  end;
  reset role;

  -- 7. Another office sees none of it, and can't record one.
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.esp_revisions where property_id = p1;
  if n <> 0 then raise exception 'FAIL 7: another office saw % revisions', n; end if;
  begin
    perform public.record_esp_revision(p1, 1, 2, null, folder || 'x.pdf', 'x.pdf', false, null, null, '{}', 'open');
    raise exception 'FAIL 7b: another office recorded a revision';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 8. Anonymous can't read them.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin
    perform count(*) from public.esp_revisions;
    raise exception 'FAIL 8: anonymous read the revisions';
  exception when insufficient_privilege then null;
  end;
  reset role;

  raise notice 'ESP revision history: all checks passed';
end $$;

rollback;
