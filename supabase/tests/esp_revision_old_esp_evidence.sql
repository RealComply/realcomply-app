-- ===== READ ONLY. Each ESP revision: the ESP before it, its evidence, market feedback, 9 November 2026 =====
--
-- Proves supabase/migrations/0117_esp_revision_old_esp_evidence.sql. Run after
-- it. Safe on the live database: everything happens inside one transaction
-- that is rolled back at the end, so the made-up offices, people and listings
-- it creates never exist outside it.
--
-- Pass: the last line says "ESP revision old ESP and evidence: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1  uuid := gen_random_uuid();  -- the office
  o2  uuid := gen_random_uuid();  -- another office
  a   uuid := gen_random_uuid();  -- o1's agent, whose listing p1 is
  x   uuid := gen_random_uuid();  -- an agent in o2
  p1  uuid;
  p2  uuid;                       -- o2's listing
  n   integer;
  r   record;
  folder text;
  other_folder text;
begin
  insert into auth.users (id, email) values (a, 'eo-a@example.invalid'), (x, 'eo-x@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'EO Office One (made up)', 'office_1', 'active', 'Lou Licensee', 'eo-lou@example.invalid'),
    (o2, 'EO Office Two (made up)', 'office_1', 'active', 'Other Licensee', 'eo-other@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (a, o1, 'Ana Agent', 'eo-a@example.invalid', true, false, false),
    (x, o2, 'Xan Agent', 'eo-x@example.invalid', true, false, false);
  insert into public.properties (agency_id, created_by, address) values (o1, a, '14 Harbour Street (made up)') returning id into p1;
  insert into public.properties (agency_id, created_by, address) values (o2, x, '15 Harbour Street (made up)') returning id into p2;
  folder := o1::text || '/' || p1::text || '/d3/';
  other_folder := o1::text || '/' || p1::text || '/a4/';
  insert into public.property_items (agency_id, property_id, item_key, status, data) values
    (o1, p1, 'a4', 'done', '{"espLow": 1400000, "espHigh": 1450000}'),
    (o1, p1, 'd3', 'open', '{"espRevised": true}');

  -- 1. The new form keeps the ESP before the revision and the evidence file.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := public.record_esp_revision(p1, 1300000, 1360000, date '2026-11-18', folder || '1-notice.pdf', 'Notice 18 Nov.pdf',
                                  false, 'Email', 'Buyer feedback', '{}', 'open',
                                  1400000, 1450000, folder || '1-evidence.pdf', 'Comparable sales.pdf', false, '[]');
  reset role;
  if n <> 1 then raise exception 'FAIL 1: numbered %', n; end if;
  select * into r from public.esp_revisions where property_id = p1 and revision_no = 1;
  if r.previous_esp_low <> 1400000 or r.previous_esp_high <> 1450000 or r.evidence_path <> folder || '1-evidence.pdf'
     or r.evidence_file_name <> 'Comparable sales.pdf' or r.evidence_in_notice or r.market_feedback <> '[]'::jsonb then
    raise exception 'FAIL 1b: revision 1 was recorded as %', row_to_json(r); end if;
  if (select (data ->> 'revisedEspLow')::numeric from public.property_items where property_id = p1 and item_key = 'd3') <> 1300000 then
    raise exception 'FAIL 1c: the card''s latest figures did not change'; end if;

  -- 2. Evidence in the notice itself, no ESP before stated, market feedback kept.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := public.record_esp_revision(p1, 1250000, 1300000, date '2026-11-25', folder || '2-notice.pdf', 'Notice 25 Nov.pdf',
                                  false, 'Email', null, '{}', 'open',
                                  null, null, null, null, true,
                                  '[{"who": "A buyer (made up)", "how": "phone", "on": "2026-11-24"}]');
  reset role;
  select * into r from public.esp_revisions where property_id = p1 and revision_no = 2;
  if r.previous_esp_low is not null or not r.evidence_in_notice or r.evidence_path is not null
     or jsonb_array_length(r.market_feedback) <> 1 then
    raise exception 'FAIL 2: revision 2 was recorded as %', row_to_json(r); end if;

  -- 3. Refused: half the ESP before; evidence outside the d3 folder; feedback not a list.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.record_esp_revision(p1, 1200000, 1250000, date '2026-11-26', folder || '3-notice.pdf', 'n.pdf',
                                       false, null, null, '{}', 'open', 1250000, null, null, null, false, '[]');
    raise exception 'FAIL 3a: half the ESP before was taken';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.record_esp_revision(p1, 1200000, 1250000, date '2026-11-26', folder || '3-notice.pdf', 'n.pdf',
                                       false, null, null, '{}', 'open', null, null, other_folder || 'x.pdf', 'x.pdf', false, '[]');
    raise exception 'FAIL 3b: evidence outside the d3 folder was taken';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.record_esp_revision(p1, 1200000, 1250000, date '2026-11-26', folder || '3-notice.pdf', 'n.pdf',
                                       false, null, null, '{}', 'open', null, null, null, null, false, '{"who": "x"}');
    raise exception 'FAIL 3c: market feedback that is not a list was taken';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- A direct insert can't put evidence outside the folder either (the constraint).
  begin
    insert into public.esp_revisions (agency_id, property_id, esp_low, esp_high, notice_path, evidence_path)
    values (o1, p1, 1, 1, folder || 'n.pdf', other_folder || 'x.pdf');
    raise exception 'FAIL 3d: a direct insert put evidence outside the folder';
  exception when check_violation then null;
  end;
  reset role;
  select count(*) into n from public.esp_revisions where property_id = p1;
  if n <> 2 then raise exception 'FAIL 3e: % revisions after the refusals', n; end if;

  -- 4. The 0110 form still works (the app as it is today), and leaves the new columns empty.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := public.record_esp_revision(p1, 1200000, 1250000, date '2026-11-27', folder || '3-notice.pdf', 'Notice 27 Nov.pdf',
                                  false, null, null, '{}', 'open');
  reset role;
  select * into r from public.esp_revisions where property_id = p1 and revision_no = 3;
  if n <> 3 or r.previous_esp_low is not null or r.evidence_path is not null or r.evidence_in_notice or r.market_feedback <> '[]'::jsonb then
    raise exception 'FAIL 4: the 0110 form recorded %', row_to_json(r); end if;

  -- 5. Nobody signed in changes or deletes a revision.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.esp_revisions set evidence_path = null where property_id = p1;
    raise exception 'FAIL 5a: a revision was changed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.esp_revisions where property_id = p1;
    raise exception 'FAIL 5b: a revision was deleted';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 6. Another office sees none of it.
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.esp_revisions where property_id = p1;
  if n <> 0 then raise exception 'FAIL 6: another office saw % revisions', n; end if;
  reset role;

  raise notice 'ESP revision old ESP and evidence: all checks passed';
end $$;

rollback;
