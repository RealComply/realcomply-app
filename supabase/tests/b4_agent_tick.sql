-- ===== READ ONLY. The price statement card is an agent's tick, 2 November 2026 =====
--
-- Proves supabase/migrations/0104_b4_agent_tick.sql. Run after it. Safe on
-- the live database: everything happens inside one transaction that is
-- rolled back at the end, so the made-up offices, people and listings it
-- creates never exist outside it.
--
-- Also proves again the parts of price_statement_link.sql (0065, 0066) that
-- still hold, because 0104 replaced the functions they rest on: the final
-- sign-off cards and the final sign-off link are unchanged.
--
-- Pass: the last line says "b4 agent tick: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1 uuid := gen_random_uuid();   -- an office plan whose licensee in charge uses RealComply
  o2 uuid := gen_random_uuid();   -- an office plan whose licensee in charge has no login
  o3 uuid := gen_random_uuid();   -- an agent on their own plan
  l   uuid := gen_random_uuid();  -- o1's licensee in charge
  a   uuid := gen_random_uuid();  -- an agent in o1, whose listings p1 and pf are
  s   uuid := gen_random_uuid();  -- a's assistant
  f   uuid := gen_random_uuid();  -- o2's founder, an agent; the licensee isn't on RealComply
  g   uuid := gen_random_uuid();  -- the agent on their own plan
  p1  uuid;                       -- a's listing, ticked
  pf  uuid;                       -- a's listing for the final sign-off
  po  uuid;                       -- a's listing with the licensee's approval from before 0104
  p2  uuid;                       -- f's listing
  p3  uuid;                       -- g's listing
  link uuid;
  tok uuid := gen_random_uuid();
  d jsonb;
  n integer;
  t text;
  r record;
begin
  -- ── Made-up offices, people and listings (as the database owner). ──
  insert into auth.users (id, email) values
    (l, 'bt-l@example.invalid'), (a, 'bt-a@example.invalid'), (s, 'bt-s@example.invalid'),
    (f, 'bt-f@example.invalid'), (g, 'bt-g@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'BT Office One (made up)', 'office_1', 'active', 'Lee Licensee', 'bt-l@example.invalid'),
    (o2, 'BT Office Two (made up)', 'office_1', 'active', 'Outside Licensee', 'bt-outside@example.invalid'),
    (o3, 'BT Solo (made up)', 'agent_1', 'active', 'Solo Licensee', 'bt-solo-lic@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (l, o1, 'Lee Licensee', 'bt-l@example.invalid', true, true, false),
    (a, o1, 'Ana Agent', 'bt-a@example.invalid', true, false, false),
    (s, o1, 'Sam Assistant', 'bt-s@example.invalid', false, false, true),
    (f, o2, 'Fay Founder', 'bt-f@example.invalid', true, false, false),
    (g, o3, 'Gus Solo', 'bt-g@example.invalid', true, false, false);
  insert into public.assistant_agents (assistant_id, agent_id, agency_id) values (s, a, o1);
  insert into public.properties (agency_id, created_by, address) values (o1, a, '1 Tick St (made up)') returning id into p1;
  insert into public.properties (agency_id, created_by, address) values (o1, a, '2 Final St (made up)') returning id into pf;
  insert into public.properties (agency_id, created_by, address) values (o1, a, '3 Earlier St (made up)') returning id into po;
  insert into public.properties (agency_id, created_by, address) values (o2, f, '4 No Login St (made up)') returning id into p2;
  insert into public.properties (agency_id, created_by, address) values (o3, g, '5 Solo St (made up)') returning id into p3;
  insert into public.property_items (agency_id, property_id, item_key, status, data, completed_by) values
    (o1, p1, 'a4', 'done', '{"espLow": 900000, "espHigh": 950000}', a),
    (o1, p1, 'a4c', 'done', '{"note": "Three sales nearby."}', a),
    -- The licensee's approval in the app from before 0104: signed time and signer, no tick.
    (o1, po, 'b4', 'done', jsonb_build_object('note', 'Guide $800,000', 'signedAt', now(), 'signedBy', l), l);

  -- ── 1. An agent in an office whose licensee uses RealComply ticks b4. ──
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.property_items (agency_id, property_id, item_key, status, data)
  values (o1, p1, 'b4', 'done', '{"note": "Guide $900,000 to $950,000"}');
  reset role;
  select status, completed_by, data into r from public.property_items where property_id = p1 and item_key = 'b4';
  if r.status <> 'done' or r.completed_by <> a or r.data ->> 'tickedBy' <> a::text or r.data ->> 'tickedAt' is null
     or r.data ->> 'note' <> 'Guide $900,000 to $950,000' then
    raise exception 'FAIL 1: the agent''s tick reads %', row_to_json(r); end if;

  -- ── 2. The agent in an office whose licensee has no login ticks it. ──
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.property_items (agency_id, property_id, item_key, status, data)
  values (o2, p2, 'b4', 'done', '{"note": "Guide $1.2m"}');
  reset role;
  if (select data ->> 'tickedBy' from public.property_items where property_id = p2 and item_key = 'b4') is distinct from f::text then
    raise exception 'FAIL 2: the agent in an office without a licensee login couldn''t tick b4'; end if;

  -- ── 3. The agent on their own plan ticks it, and can't put a licensee's
  --       approval, or someone else's tick, on it. ──
  perform set_config('request.jwt.claims', json_build_object('sub', g, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.property_items (agency_id, property_id, item_key, status, data, completed_by)
  values (o3, p3, 'b4', 'done',
          jsonb_build_object('note', 'Guide $700k', 'signedVia', 'link', 'signedName', 'A Licensee', 'signoffRequestId', gen_random_uuid(),
                             'sentTo', 'x@example.invalid', 'typedName', 'A Licensee', 'signedAt', now() - interval '9 days',
                             'signedBy', l, 'tickedBy', l, 'tickedAt', now() - interval '9 days'),
          l);
  reset role;
  select completed_by, data into r from public.property_items where property_id = p3 and item_key = 'b4';
  if r.completed_by <> g or r.data ->> 'tickedBy' <> g::text then
    raise exception 'FAIL 3: the solo agent''s tick reads %', row_to_json(r); end if;
  if r.data ?| array['signedVia', 'signedName', 'signoffRequestId', 'sentTo', 'typedName', 'signedAt', 'signedBy'] then
    raise exception 'FAIL 3b: the browser put a licensee''s approval on a tick: %', r.data; end if;
  if (r.data ->> 'tickedAt')::timestamptz < now() - interval '1 minute' then
    raise exception 'FAIL 3c: the browser chose when it was ticked'; end if;

  -- ── 4. Editing a ticked card keeps who ticked it and when; unticking
  --       takes the tick off. ──
  d := (select data from public.property_items where property_id = p1 and item_key = 'b4');
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.property_items set data = data || '{"note": "Guide $905,000 to $950,000"}', completed_by = s
   where property_id = p1 and item_key = 'b4';
  reset role;
  select completed_by, data into r from public.property_items where property_id = p1 and item_key = 'b4';
  if r.completed_by <> a or r.data -> 'tickedBy' <> d -> 'tickedBy' or r.data -> 'tickedAt' <> d -> 'tickedAt'
     or r.data ->> 'note' <> 'Guide $905,000 to $950,000' then
    raise exception 'FAIL 4: an edit changed who ticked it or when: %', row_to_json(r); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.property_items set status = 'open' where property_id = p1 and item_key = 'b4';
  reset role;
  select status, data into r from public.property_items where property_id = p1 and item_key = 'b4';
  if r.status <> 'open' or r.data ? 'tickedBy' or r.data ? 'tickedAt' or r.data ->> 'reopenedBy' is distinct from a::text then
    raise exception 'FAIL 4b: the untick reads %', row_to_json(r); end if;

  -- ── 5. The assistant ticks it again. ──
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.property_items set status = 'done' where property_id = p1 and item_key = 'b4';
  reset role;
  if (select data ->> 'tickedBy' from public.property_items where property_id = p1 and item_key = 'b4') is distinct from s::text then
    raise exception 'FAIL 5: the assistant couldn''t tick b4'; end if;

  -- ── 6. It reopens like any other card: the agent or the assistant, through
  --       the app's Reopen; nothing goes into the history; the note stays. ──
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  set local role authenticated;
  t := public.reopen_listing_card(p1, 'b4');
  reset role;
  select status, data into r from public.property_items where property_id = p1 and item_key = 'b4';
  if t <> 'reopened' or r.status <> 'open' or r.data ->> 'note' <> 'Guide $905,000 to $950,000'
     or r.data ->> 'reopenedBy' is distinct from s::text then
    raise exception 'FAIL 6: the reopened tick reads % (%)', row_to_json(r), t; end if;
  if exists (select 1 from public.listing_signoff_cancellations where property_id = p1) then
    raise exception 'FAIL 6b: reopening a tick put it in the history of cancelled approvals'; end if;

  -- ── 7. When the ESP changes, the tick goes back to open and is kept in
  --       the history (0100's rule, kept). ──
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.property_items set status = 'done' where property_id = p1 and item_key = 'b4';
  update public.property_items set data = data || '{"espLow": 880000}' where property_id = p1 and item_key = 'a4';
  reset role;
  select status, data into r from public.property_items where property_id = p1 and item_key = 'b4';
  if r.status <> 'open' or r.data ? 'tickedBy' or r.data ? 'tickedAt' or r.data ->> 'reopenedWhy' <> 'esp_changed' then
    raise exception 'FAIL 7: after the ESP changed b4 reads %', row_to_json(r); end if;
  select card -> 'data' ->> 'tickedBy' as who, because into r
    from public.listing_signoff_cancellations where property_id = p1 and item_key = 'b4';
  if r.who is distinct from a::text or r.because <> 'esp_changed' then
    raise exception 'FAIL 7b: the tick in the history reads %', row_to_json(r); end if;

  -- ── 8. The licensee's approval from before 0104 stays as it was. ──
  for t in select unnest(array[a::text, l::text]) loop
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      update public.property_items set data = data || '{"note": "Changed"}' where property_id = po and item_key = 'b4';
      raise exception 'FAIL 8: % changed the licensee''s earlier approval', t;
    exception when others then
      if sqlerrm like 'FAIL%' then raise; end if;
      if sqlerrm not like 'This approval was given by the licensee in charge before 2 November 2026%' then
        raise exception 'FAIL 8b: % was told "%"', t, sqlerrm; end if;
    end;
    reset role;
  end loop;
  if (select data ->> 'note' from public.property_items where property_id = po and item_key = 'b4') <> 'Guide $800,000' then
    raise exception 'FAIL 8c: the earlier approval changed'; end if;

  -- ── 9. The agent reopens it: kept whole in the history, as since 0100;
  --       the card starts again as a tick. ──
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  t := public.reopen_listing_card(po, 'b4');
  reset role;
  select status, data into r from public.property_items where property_id = po and item_key = 'b4';
  if r.status <> 'open' or r.data ? 'signedAt' or r.data ? 'signedBy' then
    raise exception 'FAIL 9: the reopened earlier approval reads %', row_to_json(r); end if;
  select card -> 'data' ->> 'signedBy' as who, card -> 'data' ->> 'note' as note, because, cancelled_by into r
    from public.listing_signoff_cancellations where property_id = po and item_key = 'b4';
  if r.who is distinct from l::text or r.note <> 'Guide $800,000' or r.because <> 'withdrawn' or r.cancelled_by <> a then
    raise exception 'FAIL 9b: the earlier approval in the history reads %', row_to_json(r); end if;

  -- ── 10. No price statement link can be made, in any office. ──
  for t in select unnest(array[a::text, f::text, g::text, l::text]) loop
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into public.property_signoff_requests (agency_id, property_id, item_key, price_statement)
      values (case t when f::text then o2 when g::text then o3 else o1 end,
              case t when f::text then p2 when g::text then p3 else pf end, 'b4', 'Guide $1');
      raise exception 'FAIL 10: % made a price statement link', t;
    exception when others then
      if sqlerrm like 'FAIL%' then raise; end if;
      if sqlerrm <> 'The price statement isn''t sent to the licensee any more. Tick it on its card once they have approved it.' then
        raise exception 'FAIL 10b: % was told "%"', t, sqlerrm; end if;
    end;
    reset role;
  end loop;

  -- ── 11. The final sign-off link still goes out the same way: the
  --        database chooses its token, lifetime and recipient, and one at a
  --        time. ──
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.property_signoff_requests (agency_id, property_id, statement, token, expires_at, sent_to, price_statement, esp_low)
  values (o1, pf, 'I sign off this file (made up).', tok, now() + interval '9 years', 'someone@example.invalid', 'Guide', 1)
  returning id into link;
  reset role;
  select item_key, token, expires_at, sent_to, price_statement, esp_low into r
    from public.property_signoff_requests where id = link;
  if r.item_key <> 'sign_licensee' or r.token = tok or r.expires_at > now() + interval '31 days'
     or r.sent_to <> 'bt-l@example.invalid' or r.price_statement is not null or r.esp_low is not null then
    raise exception 'FAIL 11: the final sign-off link reads %', row_to_json(r); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.property_signoff_requests (agency_id, property_id, statement) values (o1, pf, 'I sign off this file (made up).');
    raise exception 'FAIL 11b: a second final sign-off link went out';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm <> 'A request is already out for this. Send it again, or withdraw it first.' then
      raise exception 'FAIL 11c: the second link was refused with "%"', sqlerrm; end if;
  end;
  reset role;

  -- ── 12. The final sign-off cards are unchanged. ──
  -- Only the listing's agent signs the agent's sign-off; only the licensee
  -- in charge signs theirs; who and when come from the login; a link's
  -- marks never come from the browser; a signed card can't be changed.
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.property_items (agency_id, property_id, item_key, status, data)
    values (o1, pf, 'sign_agent', 'done', '{"typedName": "Sam"}');
    raise exception 'FAIL 12: the assistant signed the agent''s sign-off';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.property_items (agency_id, property_id, item_key, status, data)
  values (o1, pf, 'sign_agent', 'done', '{"typedName": "Ana Agent"}');
  begin
    insert into public.property_items (agency_id, property_id, item_key, status, data)
    values (o1, pf, 'sign_licensee', 'done', '{"typedName": "Ana Agent"}');
    raise exception 'FAIL 12b: the agent signed the licensee''s sign-off';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm <> 'Only the licensee in charge can sign this.' then
      raise exception 'FAIL 12c: the agent was told "%"', sqlerrm; end if;
  end;
  insert into public.property_items (agency_id, property_id, item_key, status, data, completed_by, event_date)
  values (o1, pf, 'sign_licensee', 'open',
          jsonb_build_object('signedVia', 'link', 'signedName', 'Lee', 'typedName', 'Lee', 'signedAt', now()), a, current_date);
  reset role;
  select completed_by, event_date, data into r from public.property_items where property_id = pf and item_key = 'sign_licensee';
  if r.completed_by is not null or r.event_date is not null
     or r.data ?| array['signedVia', 'signedName', 'typedName', 'signedAt'] then
    raise exception 'FAIL 12d: the browser put a signature on the open licensee''s card: %', row_to_json(r); end if;
  if (select data ->> 'signedBy' from public.property_items where property_id = pf and item_key = 'sign_agent') is distinct from a::text then
    raise exception 'FAIL 12e: who signed the agent''s sign-off didn''t come from the login'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.property_items set status = 'done', data = '{"typedName": "Lee Licensee"}'
   where property_id = pf and item_key = 'sign_licensee';
  begin
    update public.property_items set data = data || '{"typedName": "Someone else"}'
     where property_id = pf and item_key = 'sign_licensee';
    raise exception 'FAIL 12f: the licensee''s signature was changed';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;
  if (select completed_by from public.property_items where property_id = pf and item_key = 'sign_licensee') <> l
     or (select data ->> 'signedBy' from public.property_items where property_id = pf and item_key = 'sign_licensee') is distinct from l::text then
    raise exception 'FAIL 12g: the licensee''s signature wasn''t stamped from the login'; end if;

  -- ── 13. Reopening the licensee's sign-off is still the licensee's alone,
  --        and an assistant still can't reopen a signature. ──
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.reopen_listing_card(pf, 'sign_licensee', true);
    raise exception 'FAIL 13: the agent reopened the licensee''s sign-off';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.reopen_listing_card(pf, 'sign_agent', true);
    raise exception 'FAIL 13b: the assistant reopened the agent''s signature';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;

  raise notice 'b4 agent tick: all checks passed';
end
$$;

rollback;
