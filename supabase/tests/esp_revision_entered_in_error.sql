-- ===== READ ONLY. "Entered in error" on ESP revisions, 10 November 2026 =====
--
-- Proves supabase/migrations/0124_esp_revision_entered_in_error.sql. Run after
-- it. Safe on the live database: everything happens inside one transaction
-- that is rolled back at the end, so the made-up offices, people and listing
-- it creates never exist outside it.
--
-- Pass: the last line says "Entered in error: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1   uuid := gen_random_uuid();  -- the office
  o2   uuid := gen_random_uuid();  -- another office
  lic  uuid := gen_random_uuid();  -- o1's licensee in charge
  ag   uuid := gen_random_uuid();  -- o1's agent, whose listing it is
  asst uuid := gen_random_uuid();  -- o1's assistant
  x    uuid := gen_random_uuid();  -- an agent in o2
  p1   uuid;
  folder text;
  n    integer;
  r    record;
begin
  insert into auth.users (id, email) values
    (lic, 'eie-lic@example.invalid'), (ag, 'eie-ag@example.invalid'),
    (asst, 'eie-asst@example.invalid'), (x, 'eie-x@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'Entered In Error Office (made up)', 'office_1', 'active', 'Lou Licensee', 'eie-lou@example.invalid'),
    (o2, 'Other Error Office (made up)', 'office_1', 'active', 'Oli Licensee', 'eie-oli@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (lic, o1, 'Lou Licensee', 'eie-lic@example.invalid', true, true, false),
    (ag, o1, 'Ana Agent', 'eie-ag@example.invalid', true, false, false),
    (asst, o1, 'Asha Assistant', 'eie-asst@example.invalid', false, false, true),
    (x, o2, 'Xan Agent', 'eie-x@example.invalid', true, false, false);
  insert into public.properties (agency_id, created_by, address) values (o1, ag, '8 Error Lane (made up)') returning id into p1;
  folder := o1::text || '/' || p1::text || '/d3/';
  insert into public.property_items (agency_id, property_id, item_key, status, data) values
    (o1, p1, 'a4', 'done', '{"espLow": 1400000, "espHigh": 1450000}'),
    (o1, p1, 'd3', 'open', '{"espRevised": true}');

  -- Revisions 1 and 2, by the agent; then the price statement approved
  -- against Revision 2.
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.record_esp_revision(p1, 1300000, 1360000, date '2026-10-14', folder || '1-notice.pdf', 'Notice 1.pdf',
                                     false, 'Email', 'Buyer feedback', '{"advertisingUpdated": true}', 'done');
  perform public.record_esp_revision(p1, 1200000, 1250000, date '2026-10-28', folder || '2-notice.pdf', 'Notice 2.pdf',
                                     true, 'By hand', 'Typed wrong listing', '{"advertisingUpdated": true}', 'done');
  reset role;
  insert into public.property_items (agency_id, property_id, item_key, status, data)
  values (o1, p1, 'b4', 'done', jsonb_build_object('tickedBy', ag, 'tickedAt', now(), 'note', 'Price guide $1.2m'));
  if (select esp_low from public.listing_effective_esp(p1)) <> 1200000 then
    raise exception 'FAIL 0: the checks don''t read Revision 2 to start with'; end if;
  select count(*) into n from public.listing_signoff_cancellations where property_id = p1 and item_key = 'b4';

  -- 1. A reason is required, and kept to 500 characters.
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.mark_esp_revision_in_error(p1, 2, '   ');
    raise exception 'FAIL 1a: marked with no reason';
  exception when raise_exception then
    if sqlerrm <> 'Say why it was entered in error.' then raise; end if;
  end;
  begin
    perform public.mark_esp_revision_in_error(p1, 2, repeat('x', 501));
    raise exception 'FAIL 1b: marked with a 501-character reason';
  exception when raise_exception then
    if sqlerrm <> 'Keep the reason to 500 characters.' then raise; end if;
  end;
  begin
    perform public.mark_esp_revision_in_error(p1, 9, 'No such revision');
    raise exception 'FAIL 1c: marked a revision that isn''t there';
  exception when raise_exception then
    if sqlerrm <> 'That revision isn''t on this listing.' then raise; end if;
  end;

  -- 2. The listing's agent marks Revision 2. It stays, marked, by name; the
  --    card and every check go back to Revision 1; the approval given against
  --    Revision 2 is cancelled.
  perform public.mark_esp_revision_in_error(p1, 2, '  Typed from   the wrong notice. ');
  reset role;
  select * into r from public.esp_revisions where property_id = p1 and revision_no = 2;
  if r.entered_in_error_at is null or r.entered_in_error_by <> ag or r.entered_in_error_by_name <> 'Ana Agent'
     or r.entered_in_error_reason <> 'Typed from the wrong notice.' or r.esp_low <> 1200000 or r.notice_path <> folder || '2-notice.pdf' then
    raise exception 'FAIL 2a: Revision 2 is %', row_to_json(r); end if;
  if (select count(*) from public.esp_revisions where property_id = p1) <> 2 then
    raise exception 'FAIL 2b: a revision went'; end if;
  select * into r from public.property_items where property_id = p1 and item_key = 'd3';
  if (r.data ->> 'latestRevision')::int <> 1 or (r.data ->> 'revisedEspLow')::numeric <> 1300000
     or (r.data ->> 'revisedEspHigh')::numeric <> 1360000 or r.evidence_path <> folder || '1-notice.pdf'
     or r.data ->> 'evidenceFileName' <> 'Notice 1.pdf' or (r.data ->> 'enteredManually')::boolean
     or r.data ->> 'methodOfService' <> 'Email' or r.data ->> 'noticeServedOn' <> '2026-10-14' or r.status <> 'done' then
    raise exception 'FAIL 2c: the card holds %', row_to_json(r); end if;
  if (select esp_low from public.listing_effective_esp(p1)) <> 1300000 then
    raise exception 'FAIL 2d: the checks still read the revision entered in error'; end if;
  if (select count(*) from public.listing_signoff_cancellations
       where property_id = p1 and item_key = 'b4' and because_item_key = 'd3' and because = 'esp_changed') <= n
     or (select status from public.property_items where property_id = p1 and item_key = 'b4') <> 'open' then
    raise exception 'FAIL 2e: the approval given against Revision 2 still stands'; end if;
  select * into r from public.esp_revision_error_log where property_id = p1;
  if r.action <> 'marked' or r.revision_no <> 2 or r.reason <> 'Typed from the wrong notice.' or r.done_by <> ag
     or r.done_by_name <> 'Ana Agent' or r.agency_id <> o1 then
    raise exception 'FAIL 2f: the log holds %', row_to_json(r); end if;

  -- 3. Not twice.
  set local role authenticated;
  begin
    perform public.mark_esp_revision_in_error(p1, 2, 'Again');
    raise exception 'FAIL 3: marked twice';
  exception when raise_exception then
    if sqlerrm <> 'That revision is already marked entered in error.' then raise; end if;
  end;

  -- 4. The agent can't undo it; an assistant can't mark one; nor can another office.
  begin
    perform public.undo_esp_revision_in_error(p1, 2);
    raise exception 'FAIL 4a: the agent undid it';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', asst, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.mark_esp_revision_in_error(p1, 1, 'Assistant tried');
    raise exception 'FAIL 4b: an assistant marked one';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.mark_esp_revision_in_error(p1, 1, 'Other office tried');
    raise exception 'FAIL 4c: another office marked one';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from public.esp_revision_error_log;
  if n <> 0 then raise exception 'FAIL 4d: another office sees % log rows', n; end if;
  reset role;

  -- 5. Nobody signed in writes the mark or the log directly, and a revision
  --    added with the mark already on it arrives standing.
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.esp_revisions set entered_in_error_at = null where property_id = p1;
    raise exception 'FAIL 5a: the mark was changed directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.esp_revision_error_log (agency_id, property_id, revision_no, action, done_by_name)
      values (o1, p1, 1, 'undone', 'Someone');
    raise exception 'FAIL 5b: the log was written directly';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from public.esp_revision_error_log where property_id = p1;
  if n <> 1 then raise exception 'FAIL 5c: the agent sees % of 1 log rows', n; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    perform count(*) from public.esp_revision_error_log;
    raise exception 'FAIL 5d: signed out read the log';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.mark_esp_revision_in_error(p1, 1, 'Signed out');
    raise exception 'FAIL 5e: signed out marked one';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 6. The licensee undoes it: Revision 2 stands again and drives the card.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.undo_esp_revision_in_error(p1, 2);
  reset role;
  select * into r from public.esp_revisions where property_id = p1 and revision_no = 2;
  if r.entered_in_error_at is not null or r.entered_in_error_reason is not null or r.entered_in_error_by is not null then
    raise exception 'FAIL 6a: Revision 2 is still marked: %', row_to_json(r); end if;
  select * into r from public.property_items where property_id = p1 and item_key = 'd3';
  if (r.data ->> 'latestRevision')::int <> 2 or (r.data ->> 'revisedEspLow')::numeric <> 1200000
     or r.evidence_path <> folder || '2-notice.pdf' or not (r.data ->> 'enteredManually')::boolean then
    raise exception 'FAIL 6b: after the undo the card holds %', row_to_json(r); end if;
  if (select esp_low from public.listing_effective_esp(p1)) <> 1200000 then
    raise exception 'FAIL 6c: the checks don''t read Revision 2 after the undo'; end if;
  select * into r from public.esp_revision_error_log where property_id = p1 and action = 'undone';
  if r.revision_no <> 2 or r.done_by <> lic or r.done_by_name <> 'Lou Licensee' or r.reason is not null then
    raise exception 'FAIL 6d: the undo logged as %', row_to_json(r); end if;
  set local role authenticated;
  begin
    perform public.undo_esp_revision_in_error(p1, 2);
    raise exception 'FAIL 6e: undid a revision that isn''t marked';
  exception when raise_exception then
    if sqlerrm <> 'That revision isn''t marked entered in error.' then raise; end if;
  end;

  -- 7. Every revision entered in error: the card asks again, and the checks
  --    go back to the ESP on the agreement.
  perform public.mark_esp_revision_in_error(p1, 2, 'Wrong listing.');
  perform public.mark_esp_revision_in_error(p1, 1, 'Wrong listing too.');
  reset role;
  select * into r from public.property_items where property_id = p1 and item_key = 'd3';
  if r.data ?| array['espRevised', 'revisedEspLow', 'latestRevision', 'advertisingUpdated', 'evidenceFileName']
     or r.evidence_path is not null or r.status <> 'open' or r.completed_by is not null then
    raise exception 'FAIL 7a: with none standing the card holds %', row_to_json(r); end if;
  if (select esp_low from public.listing_effective_esp(p1)) <> 1400000 then
    raise exception 'FAIL 7b: with none standing the checks don''t read the agreement''s ESP'; end if;
  if (select count(*) from public.esp_revisions where property_id = p1) <> 2 then
    raise exception 'FAIL 7c: a revision went'; end if;

  -- 8. A new revision then is Revision 3, and drives the card.
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := public.record_esp_revision(p1, 1350000, 1390000, date '2026-11-05', folder || '3-notice.pdf', 'Notice 3.pdf',
                                  false, null, null, '{}', 'done');
  reset role;
  if n <> 3 then raise exception 'FAIL 8a: the next revision was numbered %', n; end if;
  if (select esp_low from public.listing_effective_esp(p1)) <> 1350000 then
    raise exception 'FAIL 8b: the checks don''t read Revision 3'; end if;
  if (select entered_in_error_at from public.esp_revisions where property_id = p1 and revision_no = 3) is not null then
    raise exception 'FAIL 8c: Revision 3 arrived marked'; end if;

  -- 9. A revision added by hand with the mark on it arrives standing.
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.esp_revisions (agency_id, property_id, esp_low, esp_high, notice_path,
                                    entered_in_error_at, entered_in_error_reason, entered_in_error_by_name)
  values (o1, p1, 1, 2, folder || '4.pdf', now(), 'Forged', 'Someone');
  reset role;
  if (select entered_in_error_at from public.esp_revisions where property_id = p1 and revision_no = 4) is not null then
    raise exception 'FAIL 9: a revision arrived already marked'; end if;

  -- 10. Withdrawn from sale: nothing changes until it's put back.
  insert into public.listing_withdrawals (agency_id, property_id, withdrawn_on, reason, withdrawn_by)
  values (o1, p1, date '2026-11-06', 'seller_changed_mind', ag);
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.mark_esp_revision_in_error(p1, 3, 'While withdrawn');
    raise exception 'FAIL 10: marked on a withdrawn listing';
  exception when raise_exception then
    if sqlerrm not like 'This listing is withdrawn from sale.%' then raise; end if;
  end;
  reset role;
  update public.listing_withdrawals set put_back_at = now(), put_back_by = ag where property_id = p1;

  -- 11. Signed off: reopen first, the licensee too.
  insert into public.property_items (agency_id, property_id, item_key, status, data)
  values (o1, p1, 'sign_licensee', 'done', '{}');
  set local role authenticated;
  begin
    perform public.mark_esp_revision_in_error(p1, 3, 'While signed off');
    raise exception 'FAIL 11a: marked on a signed-off file';
  exception when raise_exception then
    if sqlerrm not like 'This file is signed off.%' then raise; end if;
  end;
  begin
    perform public.undo_esp_revision_in_error(p1, 1);
    raise exception 'FAIL 11b: undone on a signed-off file';
  exception when raise_exception then
    if sqlerrm not like 'This file is signed off.%' then raise; end if;
  end;
  reset role;

  -- 12. The whole log, oldest first: marked, undone, marked, marked.
  if (select string_agg(action || ' ' || revision_no, ', ' order by done_at, id) from public.esp_revision_error_log
       where property_id = p1) is null
     or (select count(*) from public.esp_revision_error_log where property_id = p1) <> 4 then
    raise exception 'FAIL 12: the log has % rows', (select count(*) from public.esp_revision_error_log where property_id = p1); end if;

  raise notice 'Entered in error: all checks passed';
end $$;

rollback;
