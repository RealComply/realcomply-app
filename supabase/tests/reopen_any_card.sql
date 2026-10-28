-- ===== READ ONLY. Every card can be reopened, 28 October 2026 =====
--
-- Proves supabase/migrations/0100_reopen_any_card.sql. Run after it. Safe on
-- the live database: everything happens inside one transaction that is
-- rolled back at the end, so the made-up offices and people never exist
-- outside it.
--
-- Pass: the last line says "Reopen any card: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1 uuid := gen_random_uuid();   -- an office
  o2 uuid := gen_random_uuid();   -- another office
  l   uuid := gen_random_uuid();  -- o1's licensee in charge
  a   uuid := gen_random_uuid();  -- an agent in o1, whose listing this is
  s   uuid := gen_random_uuid();  -- a's assistant
  m   uuid := gen_random_uuid();  -- o1's office manager
  x   uuid := gen_random_uuid();  -- o2's licensee
  p1  uuid;                       -- a's listing
  pm  uuid;                       -- the office manager's own listing
  link uuid;
  req  uuid;
  n integer;
  t text;
  r record;
begin
  insert into auth.users (id, email) values
    (l, 'ro-l@example.invalid'), (a, 'ro-a@example.invalid'), (s, 'ro-s@example.invalid'),
    (m, 'ro-m@example.invalid'), (x, 'ro-x@example.invalid');
  insert into public.agencies (id, name, plan, status) values
    (o1, 'RO Office One', 'office_1', 'active'), (o2, 'RO Office Two', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (l, o1, 'Lee Licensee', 'ro-l@example.invalid', true, true, false),
    (a, o1, 'Ana Agent', 'ro-a@example.invalid', true, false, false),
    (s, o1, 'Sam Assistant', 'ro-s@example.invalid', false, false, true),
    (m, o1, 'Max Manager', 'ro-m@example.invalid', true, false, false),
    (x, o2, 'Xan Elsewhere', 'ro-x@example.invalid', true, true, false);
  insert into public.assistant_agents (assistant_id, agent_id, agency_id) values (s, a, o1);
  insert into public.office_managers (agency_id, profile_id, wording, approved_via, approved_by, approved_by_name)
  values (o1, m, 'I authorise Max Manager to manage RO Office One''s RealComply account as office manager.',
          'team', l, 'Lee Licensee');
  insert into public.properties (agency_id, created_by, address) values (o1, a, '1 Reopen St (made up)') returning id into p1;
  insert into public.properties (agency_id, created_by, address) values (o1, m, '2 Reopen St (made up)') returning id into pm;

  -- The listing as the owner writes it: the ESP, the reasoning, two ordinary
  -- cards and the licensee's price statement approval, plus a request out.
  insert into public.property_items (agency_id, property_id, item_key, status, data, completed_by) values
    (o1, p1, 'a4', 'done', '{"espLow": 900000, "espHigh": 950000, "note": "ESP"}', a),
    (o1, p1, 'a4c', 'done', '{"reasoning": "Three sales nearby."}', a),
    (o1, p1, 'a5', 'done', '{"note": "Commission 2%"}', a),
    (o1, p1, 'a6', 'done', '{"note": "Waived"}', a),
    (o1, p1, 'c1', 'done', '{"guideLow": 900000, "guideHigh": 950000, "note": "Guide"}', a),
    (o1, p1, 'b4', 'done', jsonb_build_object('note', '$900,000 to $950,000', 'signedAt', now(), 'signedBy', l), l),
    (o1, pm, 'b4', 'done', jsonb_build_object('note', 'Guide', 'signedAt', now(), 'signedBy', l), l);
  insert into public.property_signoff_requests (agency_id, property_id, item_key, sent_to, statement, price_statement, esp_low, esp_high)
  values (o1, p1, 'b4', 'ro-l@example.invalid', 'Statement', '$900,000 to $950,000', 900000, 950000) returning id into link;

  -- 1. The agent reopens an ordinary card: open, everything kept, who and when on it.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  t := public.reopen_listing_card(p1, 'a5');
  reset role;
  if (select status from public.property_items where property_id = p1 and item_key = 'a5') <> 'open' then
    raise exception 'FAIL 1: a5 did not reopen'; end if;
  if (select data ->> 'note' from public.property_items where property_id = p1 and item_key = 'a5') <> 'Commission 2%' then
    raise exception 'FAIL 1b: the note was not kept'; end if;
  if (select data ->> 'reopenedBy' from public.property_items where property_id = p1 and item_key = 'a5') <> a::text then
    raise exception 'FAIL 1c: who reopened it is not on the card'; end if;

  -- 2. The app's own Reopen (a plain update) is stamped the same way.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.property_items set status = 'open' where property_id = p1 and item_key = 'a6';
  reset role;
  if (select data ->> 'reopenedBy' from public.property_items where property_id = p1 and item_key = 'a6') is distinct from a::text then
    raise exception 'FAIL 2: a plain reopen was not stamped'; end if;

  -- 3. The agent reopens the ESP card: the price statement approval is
  --    cancelled and kept, b4 is open and says why, the link is revoked.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.property_items set status = 'open' where property_id = p1 and item_key = 'a4';
  reset role;
  if (select status from public.property_items where property_id = p1 and item_key = 'b4') <> 'open' then
    raise exception 'FAIL 3: b4 is still approved after the ESP card was reopened'; end if;
  select because_item_key, because, cancelled_by, card -> 'data' ->> 'note' as note into r
    from public.listing_signoff_cancellations where property_id = p1 and item_key = 'b4';
  if r.because_item_key <> 'a4' or r.because <> 'reopened' or r.cancelled_by <> a or r.note <> '$900,000 to $950,000' then
    raise exception 'FAIL 3b: the cancelled approval reads %', row_to_json(r); end if;
  if (select data ->> 'reopenedBecause' from public.property_items where property_id = p1 and item_key = 'b4') <> 'a4' then
    raise exception 'FAIL 3c: b4 does not say which card was reopened'; end if;
  if (select revoked_at from public.property_signoff_requests where id = link) is null then
    raise exception 'FAIL 3d: the approval link still works'; end if;

  -- 4. Approval not given yet: reopening the ESP reasoning only stops the link.
  update public.property_items set status = 'done' where property_id = p1 and item_key = 'a4';
  insert into public.property_signoff_requests (agency_id, property_id, item_key, sent_to, statement, price_statement, esp_low, esp_high)
  values (o1, p1, 'b4', 'ro-l@example.invalid', 'Statement', '$900,000 to $950,000', 900000, 950000) returning id into link;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.property_items set status = 'open' where property_id = p1 and item_key = 'a4c';
  reset role;
  if (select revoked_at from public.property_signoff_requests where id = link) is null then
    raise exception 'FAIL 4: the open approval link was not stopped'; end if;
  select count(*) into n from public.listing_signoff_cancellations where property_id = p1;
  if n <> 1 then raise exception 'FAIL 4b: % cancellations, expected 1', n; end if;
  update public.property_items set status = 'done' where property_id = p1 and item_key = 'a4c';

  -- 5. The ESP changes on a done card: the approval is cancelled.
  update public.property_items set status = 'done', completed_by = l,
         data = jsonb_build_object('note', 'Approved', 'signedAt', now(), 'signedBy', l)
   where property_id = p1 and item_key = 'b4';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.property_items set data = data || '{"espLow": 880000}' where property_id = p1 and item_key = 'a4';
  reset role;
  if not exists (select 1 from public.listing_signoff_cancellations
                  where property_id = p1 and because = 'esp_changed' and because_item_key = 'a4')
     or (select status from public.property_items where property_id = p1 and item_key = 'b4') <> 'open' then
    raise exception 'FAIL 5: changing the ESP left the approval in place'; end if;

  -- 6. A revised ESP read off the notice (d3) cancels it too; reopening d3
  --    while it holds the revised ESP does; a "No" answer reopened doesn't.
  update public.property_items set status = 'done', completed_by = l,
         data = jsonb_build_object('note', 'Approved', 'signedAt', now(), 'signedBy', l)
   where property_id = p1 and item_key = 'b4';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.property_items (agency_id, property_id, item_key, status, data)
  values (o1, p1, 'd3', 'open', '{"espRevised": true, "revisedEspLow": 850000, "revisedEspHigh": 880000}');
  reset role;
  if (select status from public.property_items where property_id = p1 and item_key = 'b4') <> 'open' then
    raise exception 'FAIL 6: a revised ESP left the approval in place'; end if;
  update public.property_items set status = 'done' where property_id = p1 and item_key = 'd3';
  update public.property_items set status = 'done', completed_by = l,
         data = jsonb_build_object('note', 'Approved', 'signedAt', now(), 'signedBy', l)
   where property_id = p1 and item_key = 'b4';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.property_items set status = 'open' where property_id = p1 and item_key = 'd3';
  reset role;
  if (select status from public.property_items where property_id = p1 and item_key = 'b4') <> 'open' then
    raise exception 'FAIL 6b: reopening the ESP revision left the approval in place'; end if;
  update public.property_items set status = 'done', data = '{"espRevised": false}' where property_id = p1 and item_key = 'd3';
  update public.property_items set status = 'done', completed_by = l,
         data = jsonb_build_object('note', 'Approved', 'signedAt', now(), 'signedBy', l)
   where property_id = p1 and item_key = 'b4';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.property_items set status = 'open' where property_id = p1 and item_key = 'd3';
  reset role;
  if (select status from public.property_items where property_id = p1 and item_key = 'b4') <> 'done' then
    raise exception 'FAIL 6c: a "No" answer reopened cancelled the approval'; end if;

  -- 7. An agent, the office manager and an assistant can't reopen the approval.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.reopen_listing_card(p1, 'b4');
    raise exception 'FAIL 7: the agent reopened b4';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm <> 'Only the licensee in charge can reopen a licensee sign-off.' then
      raise exception 'FAIL 7b: the agent was told "%"', sqlerrm; end if;
  end;
  begin
    update public.property_items set status = 'open' where property_id = p1 and item_key = 'b4';
    raise exception 'FAIL 7c: the agent reopened b4 directly';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.reopen_listing_card(pm, 'b4');
    raise exception 'FAIL 7d: the office manager reopened b4';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.reopen_listing_card(p1, 'b4');
    raise exception 'FAIL 7e: the assistant reopened b4';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;

  -- 8. The licensee reopens the approval: cancelled and kept.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  t := public.reopen_listing_card(p1, 'b4');
  reset role;
  if (select status from public.property_items where property_id = p1 and item_key = 'b4') <> 'open'
     or not exists (select 1 from public.listing_signoff_cancellations
                     where property_id = p1 and item_key = 'b4' and because = 'withdrawn' and cancelled_by = l) then
    raise exception 'FAIL 8: the licensee could not reopen the approval'; end if;

  -- 9. The agent reopens their own signature before the licensee signs: kept,
  --    the sign-off link stops, the file goes back to not sent.
  insert into public.property_items (agency_id, property_id, item_key, status, data, completed_by) values
    (o1, p1, 'sign_agent', 'done', jsonb_build_object('typedName', 'Ana Agent', 'signedAt', now(), 'signedBy', a), a),
    (o1, p1, 'send_licensee', 'done', '{}', a);
  insert into public.property_signoff_requests (agency_id, property_id, item_key, sent_to, statement)
  values (o1, p1, 'sign_licensee', 'ro-l@example.invalid', 'File') returning id into link;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  t := public.reopen_listing_card(p1, 'sign_agent');
  reset role;
  if (select status from public.property_items where property_id = p1 and item_key = 'sign_agent') <> 'open'
     or (select status from public.property_items where property_id = p1 and item_key = 'send_licensee') <> 'open'
     or (select revoked_at from public.property_signoff_requests where id = link) is null
     or not exists (select 1 from public.listing_signoff_cancellations where property_id = p1 and item_key = 'sign_agent') then
    raise exception 'FAIL 9: reopening the agent''s signature did not reset the file'; end if;

  -- 10. Signed off: nobody but the licensee can change anything.
  update public.property_items set status = 'done', completed_by = a,
         data = jsonb_build_object('typedName', 'Ana Agent', 'signedAt', now(), 'signedBy', a)
   where property_id = p1 and item_key = 'sign_agent';
  update public.property_items set status = 'done' where property_id = p1 and item_key = 'send_licensee';
  insert into public.property_signoff_requests (agency_id, property_id, item_key, sent_to, statement, signed_at, signed_name)
  values (o1, p1, 'sign_licensee', 'ro-l@example.invalid', 'File', now(), 'Lee Licensee') returning id into link;
  insert into public.property_items (agency_id, property_id, item_key, status, data) values
    (o1, p1, 'sign_licensee', 'done', jsonb_build_object('signedVia', 'link', 'signedName', 'Lee Licensee', 'signoffRequestId', link));
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.property_items set status = 'open' where property_id = p1 and item_key = 'c1';
    raise exception 'FAIL 10: the agent reopened a card on a signed-off file';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm <> 'Only the licensee can reopen a signed-off file.' then
      raise exception 'FAIL 10b: the agent was told "%"', sqlerrm; end if;
  end;
  begin
    perform public.reopen_listing_card(p1, 'c1');
    raise exception 'FAIL 10c: the agent reopened a card on a signed-off file';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into public.property_comparables (agency_id, property_id, address) values (o1, p1, '9 Late St (made up)');
    raise exception 'FAIL 10d: the agent added a comparable sale to a signed-off file';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- The finalised file can still be generated.
  insert into public.property_items (agency_id, property_id, item_key, status, data)
  values (o1, p1, 'f2', 'done', jsonb_build_object('generatedAt', now()));
  reset role;

  -- 11. Asking the licensee: one waiting request a card, with a reason; the
  --     licensee can't ask, only answer; an agent can't answer.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.request_listing_reopen(p1, 'c1', '   ');
    raise exception 'FAIL 11: a request with no reason was taken';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  req := public.request_listing_reopen(p1, 'c1', 'The guide changed after sign-off.');
  begin
    perform public.request_listing_reopen(p1, 'c1', 'Again');
    raise exception 'FAIL 11b: a second waiting request was taken';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.decline_listing_reopen(req);
    raise exception 'FAIL 11c: the agent answered their own request';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.decline_listing_reopen(req);
  reset role;
  if (select status from public.listing_reopen_requests where id = req) <> 'declined' then
    raise exception 'FAIL 11d: the licensee''s answer was not recorded'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  req := public.request_listing_reopen(p1, 'c1', 'The guide changed after sign-off, please.');
  reset role;

  -- 12. The licensee reopens a card on the signed-off file: asked first, then
  --     both signatures are cancelled and kept, the file goes back to not
  --     sent and not generated, the signed link stops counting, the card is
  --     open and the request is answered.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.reopen_listing_card(p1, 'c1');
    raise exception 'FAIL 12: the sign-off was cancelled without asking';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  t := public.reopen_listing_card(p1, 'c1', true);
  reset role;
  select count(*) into n from public.listing_signoff_cancellations
   where property_id = p1 and item_key in ('sign_licensee', 'sign_agent') and because = 'file_reopened' and because_item_key = 'c1';
  if n <> 2 then raise exception 'FAIL 12b: % signatures kept as cancelled, expected 2', n; end if;
  if public.listing_signed_off(p1) then raise exception 'FAIL 12c: the file is still signed off'; end if;
  if (select status from public.property_items where property_id = p1 and item_key = 'c1') <> 'open'
     or (select status from public.property_items where property_id = p1 and item_key = 'f2') <> 'open'
     or (select status from public.property_items where property_id = p1 and item_key = 'send_licensee') <> 'open' then
    raise exception 'FAIL 12d: the card or the file did not reopen'; end if;
  if (select revoked_at from public.property_signoff_requests where id = link) is null then
    raise exception 'FAIL 12e: the signed link still counts'; end if;
  if (select status from public.listing_reopen_requests where id = req) <> 'reopened' then
    raise exception 'FAIL 12f: the request was not answered'; end if;

  -- 13. Read: the agent sees their listing's history; another office sees
  --     none; nobody signed in can write it directly.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.listing_signoff_cancellations;
  if n < 5 then raise exception 'FAIL 13: the agent sees % cancellations', n; end if;
  begin
    insert into public.listing_signoff_cancellations (agency_id, property_id, item_key, card, because)
    values (o1, p1, 'b4', '{}', 'reopened');
    raise exception 'FAIL 13b: the agent wrote the history directly';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.listing_signoff_cancellations;
  if n <> 0 then raise exception 'FAIL 13c: another office sees % cancellations', n; end if;
  select count(*) into n from public.listing_reopen_requests;
  if n <> 0 then raise exception 'FAIL 13d: another office sees % requests', n; end if;
  begin
    perform public.reopen_listing_card(p1, 'a5');
    raise exception 'FAIL 13e: another office reopened a card';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;

  -- 14. The 7-year record carries the cancellations and requests.
  if jsonb_array_length(public.build_activity_record(o1) -> 'signoff_cancellations') < 5
     or jsonb_array_length(public.build_activity_record(o1) -> 'reopen_requests') <> 2 then
    raise exception 'FAIL 14: the activity record is missing them'; end if;

  raise notice 'Reopen any card: all checks passed';
end
$$;

rollback;
