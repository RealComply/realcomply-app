-- ===== READ ONLY. Price statement link test, 12 October 2026 =====
--
-- Proves supabase/migrations/0065_price_statement_link.sql (the licensee
-- approves the price statement, b4, through an emailed link when the office's
-- licensee in charge doesn't use RealComply) and keeps proving 0064 (the
-- database chooses a link's token). Run after 0065. Safe on the live
-- database: everything happens inside one transaction that is rolled back at
-- the end, so the made-up offices, people and listings it creates never exist
-- outside it.
--
-- Pass: the last line says "Price statement link: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  office uuid := gen_random_uuid();   -- an office plan whose founder said "No, someone else"
  solo uuid := gen_random_uuid();     -- an agent on their own plan; their licensee is outside
  lo uuid := gen_random_uuid();       -- an office whose licensee uses RealComply
  nf uuid := gen_random_uuid();       -- the office's founder: account holder, not the licensee
  nm uuid := gen_random_uuid();       -- a second member of that office
  nx uuid := gen_random_uuid();       -- a past member of that office (archived)
  sa uuid := gen_random_uuid();       -- the agent on their own plan
  sas uuid := gen_random_uuid();      -- their assistant
  ll uuid := gen_random_uuid();       -- licensee in charge of lo
  la uuid := gen_random_uuid();       -- an agent in lo
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; ps uuid; pl uuid; pid uuid;
  b1 uuid; b3 uuid; b5 uuid; bs uuid; f1 uuid; f3 uuid; f4a uuid; f4b uuid;
  b1tok uuid; b3tok uuid; b5tok uuid; bstok uuid; f1tok uuid; f3tok uuid; f4btok uuid;
  chosen uuid := gen_random_uuid();
  r record;
  d jsonb;
  rec jsonb;
  n integer;
  ok boolean;
  s text;
  msg text;
  live_msg text := 'A request is already out for this. Send it again, or withdraw it first.';
  stmt_msg text := 'Type the price statement, up to 300 characters.';
begin
  -- ── Made-up offices, people and listings (as the database owner). ──
  insert into auth.users (id, email) values
    (nf, 'ps-founder@example.invalid'), (nm, 'ps-nm-login@example.invalid'),
    (nx, 'ps-nx-login@example.invalid'), (sa, 'ps-solo@example.invalid'),
    (sas, 'ps-solo-asst@example.invalid'), (ll, 'ps-l-lic@example.invalid'),
    (la, 'ps-l-agent@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (office, 'Price statement test office', 'office_1', 'active', 'Outside Licensee', 'ps-outside-lic@example.invalid'),
    (solo, 'Price statement test solo', 'agent_1', 'active', 'Solo Licensee', 'ps-solo-lic@example.invalid'),
    (lo, 'Price statement test licensee office', 'office_1', 'active', 'Test Licensee', 'ps-l-lic@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent, archived_at) values
    (nf, office, 'PS Founder', 'ps-founder@example.invalid', false, false, true, null),
    (nm, office, 'PS Member', 'ps-nm@example.invalid', false, false, true, null),
    (nx, office, 'PS Past Member', 'ps-nx@example.invalid', false, false, true, now()),
    (sa, solo, 'PS Solo', 'ps-solo@example.invalid', false, false, true, null),
    (sas, solo, 'PS Solo Assistant', 'ps-solo-asst@example.invalid', false, true, false, null),
    (ll, lo, 'PS Licensee', 'ps-l-lic@example.invalid', true, false, true, null),
    (la, lo, 'PS Agent', 'ps-l-agent@example.invalid', false, false, true, null);
  insert into public.assistant_agents (agency_id, assistant_id, agent_id) values (solo, sas, sa);
  -- Whoever created the agency comes first.
  update public.profiles set created_at = now() + interval '1 minute' where id in (nm, nx, sas, la);

  insert into public.properties (agency_id, created_by, address) values (office, nf, '1 Price St') returning id into p1;
  insert into public.properties (agency_id, created_by, address, test_mode) values (office, nf, '2 Practice St', true) returning id into p2;
  insert into public.properties (agency_id, created_by, address) values (office, nf, '3 Flagged St') returning id into p3;
  insert into public.properties (agency_id, created_by, address) values (office, nf, '4 Final St') returning id into p4;
  insert into public.properties (agency_id, created_by, address) values (office, nf, '5 Moving St') returning id into p5;
  insert into public.properties (agency_id, created_by, address) values (solo, sa, '6 Solo St') returning id into ps;
  insert into public.properties (agency_id, created_by, address) values (lo, la, '7 Licensee St') returning id into pl;
  -- The ESP on the agreement (a4), the ESP reasoning done (a4c), and a
  -- revision notice with only one figure read (d3), so a4's ESP is on foot.
  foreach pid in array array[p1, p2, p3, p4, p5, ps, pl] loop
    insert into public.property_items (agency_id, property_id, item_key, status, data)
    select x.agency_id, pid, k.key, k.status, k.data::jsonb
      from public.properties x,
           (values ('a4', 'done', '{"espLow": 750000, "espHigh": 790000}'),
                   ('a4c', 'done', '{"note": "Three recent sales nearby support the range."}'),
                   ('d3', 'open', '{"revisedEspLow": 700000}')) as k(key, status, data)
     where x.id = pid;
  end loop;
  insert into public.property_items (agency_id, property_id, item_key, status, data)
    values (office, p1, 'send_licensee', 'done', '{"sentAt": "2026-10-01T00:00:00Z"}');

  -- ══════════════ As the founder of the office with no licensee on RealComply ══════════════
  perform set_config('request.jwt.claims', json_build_object('sub', nf, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. (0064) A final sign-off link the browser tries to fill in itself: the
  --    token, expiry and email status are the database's.
  msg := null;
  begin
    insert into public.property_signoff_requests
      (agency_id, property_id, sent_to, statement, created_by, token, created_at, expires_at,
       revoked_at, email_sent_at, email_attempts, email_error)
    values (office, p4, 'me@example.invalid', 'Test statement', nm, chosen, '2000-01-01', '2099-01-01',
            '2000-01-01', now(), 5, 'made up')
    returning id into f4a;
  exception when others then msg := sqlerrm;
  end;
  if msg is not null then raise exception 'FAIL 1: a final sign-off link could not be sent (%)', msg; end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select * into r from public.property_signoff_requests where id = f4a;
  if r.token = chosen or r.expires_at > now() + interval '30 days' or r.created_at <> now()
     or r.revoked_at is not null or r.email_sent_at is not null or r.email_attempts <> 0
     or r.email_error is not null or r.created_by <> nf or r.sent_to <> 'ps-outside-lic@example.invalid'
     or r.item_key <> 'sign_licensee' then
    raise exception 'FAIL 1: a link took its token, expiry, email status or recipient from the browser';
  end if;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  if public.submit_signoff(chosen, 'Outside Licensee') then
    raise exception 'FAIL 1: the browser''s own token signed the file';
  end if;

  -- 2. Signed in, the token can't be read, and the new columns can be read but
  --    not changed.
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', nf, 'role', 'authenticated')::text, true);
  set local role authenticated;
  msg := null;
  begin
    perform token from public.property_signoff_requests where id = f4a;
  exception when others then msg := sqlerrm;
  end;
  if msg is null then raise exception 'FAIL 2: a signed-in person read a link''s token'; end if;
  perform item_key, price_statement, esp_low, esp_high from public.property_signoff_requests where id = f4a;
  msg := null;
  begin
    update public.property_signoff_requests set item_key = 'b4', price_statement = 'x' where id = f4a;
  exception when others then msg := sqlerrm;
  end;
  if msg is null then raise exception 'FAIL 2: a signed-in person changed what a link is for'; end if;

  -- ══════════════ As an agent in an office whose licensee uses RealComply ══════════════
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', la, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 3. Their licensee approves b4 in the app, so no link.
  msg := null;
  begin
    insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement, item_key, price_statement)
    values (lo, pl, 'x', 'x', 'b4', 'Guide $750,000 to $790,000');
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from 'Your licensee in charge uses RealComply, so they approve the price statement in the app.' then
    raise exception 'FAIL 3: a price statement link went out in an office whose licensee uses RealComply (%)', coalesce(msg, 'not refused');
  end if;

  -- ══════════════ The licensee email belongs to someone in the office ══════════════
  -- 4. A past member's login, then a current member's profile email.
  reset role;
  perform set_config('request.jwt.claims', '', true);
  update public.agencies set licensee_email = 'PS-NX-Login@example.invalid' where id = office;
  perform set_config('request.jwt.claims', json_build_object('sub', nf, 'role', 'authenticated')::text, true);
  set local role authenticated;
  msg := null;
  begin
    insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement, item_key, price_statement)
    values (office, p1, 'x', 'x', 'b4', 'Guide $750,000 to $790,000');
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from 'The licensee email on file belongs to someone in this office. It has to be your licensee in charge''s own address.' then
    raise exception 'FAIL 4: a price statement link went to a past member''s login (%)', coalesce(msg, 'not refused');
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  update public.agencies set licensee_email = 'ps-nm@example.invalid' where id = office;
  perform set_config('request.jwt.claims', json_build_object('sub', nf, 'role', 'authenticated')::text, true);
  set local role authenticated;
  msg := null;
  begin
    insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement, item_key, price_statement)
    values (office, p1, 'x', 'x', 'b4', 'Guide $750,000 to $790,000');
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from 'The licensee email on file belongs to someone in this office. It has to be your licensee in charge''s own address.' then
    raise exception 'FAIL 4: a price statement link went to a member''s own email (%)', coalesce(msg, 'not refused');
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  update public.agencies set licensee_email = 'ps-outside-lic@example.invalid' where id = office;
  perform set_config('request.jwt.claims', json_build_object('sub', nf, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 5. Never from a practice listing.
  msg := null;
  begin
    insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement, item_key, price_statement)
    values (office, p2, 'x', 'x', 'b4', 'Guide $750,000 to $790,000');
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from 'This is a practice listing, so nothing is sent to your licensee.' then
    raise exception 'FAIL 5: a price statement link went out from a practice listing (%)', coalesce(msg, 'not refused');
  end if;

  -- 6. The price statement is required, at most 300 characters after spaces
  --    are tidied. 300 is accepted (and undone here).
  foreach s in array array['', E'  \n\t  ', repeat('x', 301), repeat(' x', 151)] loop
    msg := null;
    begin
      insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement, item_key, price_statement)
      values (office, p1, 'x', 'x', 'b4', s);
    exception when others then msg := sqlerrm;
    end;
    if msg is distinct from stmt_msg then
      raise exception 'FAIL 6: price statement "%" was not refused (%)', left(s, 20), coalesce(msg, 'accepted');
    end if;
  end loop;
  msg := null;
  begin
    insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement, item_key)
    values (office, p1, 'x', 'x', 'b4');
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from stmt_msg then raise exception 'FAIL 6: a link with no price statement was not refused'; end if;
  msg := null;
  begin
    insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement, item_key, price_statement)
    values (office, p1, 'x', 'x', 'b4', repeat('y', 300));
    raise exception 'undo';
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from 'undo' then raise exception 'FAIL 6: a 300-character price statement was refused (%)', msg; end if;

  -- 7. A link is for the final sign-off or b4, nothing else.
  msg := null;
  begin
    insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement, item_key)
    values (office, p1, 'x', 'x', 'sign_agent');
  exception when others then msg := sqlerrm;
  end;
  if msg is null or msg not like '%property_signoff_requests_kind_check%' then
    raise exception 'FAIL 7: a link was issued for something other than the final sign-off or b4 (%)', coalesce(msg, 'accepted');
  end if;

  -- 8. The browser sends its own statement, ESP, recipient and author, with a
  --    ruleset name that tries to add a line. The database builds the
  --    statement from the listing and keeps the ESP on foot.
  insert into public.property_signoff_requests
    (agency_id, property_id, sent_to, statement, created_by, item_key, price_statement, esp_low, esp_high, ruleset_version)
  values (office, p1, 'me@example.invalid', 'FAKE', nm, 'b4', E'  Guide\n $750,000   to   $790,000 ', 1, 2,
          E'NSW Sales Ruleset 2026.2\n\nI also approve the commission.')
  returning id into b1;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select * into r from public.property_signoff_requests where id = b1;
  if r.item_key <> 'b4' or r.price_statement <> 'Guide $750,000 to $790,000'
     or r.esp_low <> 750000 or r.esp_high <> 790000
     or r.sent_to <> 'ps-outside-lic@example.invalid' or r.created_by <> nf
     or position('FAKE' in r.statement) > 0
     or position(E'Price statement to be advertised:\nGuide $750,000 to $790,000\n' in r.statement) = 0
     or position('Estimated selling price on the file: $750,000 to $790,000' in r.statement) = 0
     or position('Property: 1 Price St' in r.statement) = 0
     or position('Licensee in charge: Outside Licensee' in r.statement) = 0
     or position('Requested: ' || to_char((now() at time zone 'Australia/Sydney')::date, 'FMDD FMMonth YYYY') in r.statement) = 0 then
    raise exception 'FAIL 8: the price statement link was not built by the database: %', row_to_json(r);
  end if;
  if position(E'\n' in r.ruleset_version) > 0 or char_length(r.ruleset_version) > 80
     or position(E'\n\nI also approve' in r.statement) > 0 then
    raise exception 'FAIL 8: the ruleset name added its own lines to the statement';
  end if;

  -- 8b. Anyone who can see the listing can send it, an assistant included.
  --     It still goes only to the licensee email on file.
  perform set_config('request.jwt.claims', json_build_object('sub', sas, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement, item_key, price_statement)
  values (solo, ps, 'me@example.invalid', 'x', 'b4', 'Offers over $750,000')
  returning id into bs;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  if (select sent_to from public.property_signoff_requests where id = bs) <> 'ps-solo-lic@example.invalid' then
    raise exception 'FAIL 8: an assistant''s price statement link did not go to the licensee email';
  end if;

  -- 9. One live link per listing and purpose. A final sign-off link can be out
  --    beside a price statement link, and carries no price statement.
  perform set_config('request.jwt.claims', json_build_object('sub', nf, 'role', 'authenticated')::text, true);
  set local role authenticated;
  msg := null;
  begin
    insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement, item_key, price_statement)
    values (office, p1, 'x', 'x', 'b4', 'Guide $760,000');
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from live_msg then
    raise exception 'FAIL 9: a second price statement link went out (%)', coalesce(msg, 'accepted');
  end if;
  msg := null;
  begin
    insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement, price_statement, esp_low)
    values (office, p1, 'x', 'Test statement', 'Guide $1', 5)
    returning id into f1;
  exception when others then msg := sqlerrm;
  end;
  if msg is not null then
    raise exception 'FAIL 9: a final sign-off link could not go out beside a price statement link (%)', msg;
  end if;
  msg := null;
  begin
    insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement)
    values (office, p1, 'x', 'Test statement');
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from live_msg then
    raise exception 'FAIL 9: a second final sign-off link went out (%)', coalesce(msg, 'accepted');
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select * into r from public.property_signoff_requests where id = f1;
  if r.item_key <> 'sign_licensee' or r.price_statement is not null or r.esp_low is not null then
    raise exception 'FAIL 9: a final sign-off link kept a price statement or ESP';
  end if;

  -- 10. With b4 flagged in a send-back, a price statement link can still go
  --     out (or the flag could never clear); a final link still can't.
  insert into public.property_items (agency_id, property_id, item_key, status, data)
    values (office, p3, 'b4', 'done', '{"note": "Guide $800,000"}');
  perform set_config('request.jwt.claims', json_build_object('sub', nf, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement)
  values (office, p3, 'x', 'Test statement') returning id into f3;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select token into f3tok from public.property_signoff_requests where id = f3;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  perform public.send_back_by_token(f3tok, '[{"item_key":"b4","note":"That is not the advertised price."}]');
  reset role;
  perform set_config('request.jwt.claims', '', true);
  if not exists (select 1 from public.property_items where property_id = p3 and item_key = 'b4' and status = 'open') then
    raise exception 'FAIL 10: the flagged price statement did not reopen';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', nf, 'role', 'authenticated')::text, true);
  set local role authenticated;
  msg := null;
  begin
    insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement, item_key, price_statement)
    values (office, p3, 'x', 'x', 'b4', 'Guide $750,000 to $790,000')
    returning id into b3;
  exception when others then msg := sqlerrm;
  end;
  if msg is not null then raise exception 'FAIL 10: a flagged price statement could not be sent again (%)', msg; end if;
  msg := null;
  begin
    insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement)
    values (office, p3, 'x', 'Test statement');
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from 'Some cards your licensee flagged are not marked "Changes made" yet.' then
    raise exception 'FAIL 10: a final link went out with a card still flagged (%)', coalesce(msg, 'accepted');
  end if;

  -- 11. Withdrawing goes one way, at the database's time. Withdrawing twice
  --     keeps the first time. A signed link can't be withdrawn.
  update public.property_signoff_requests set revoked_at = '2000-01-01' where id = f4a;
  update public.property_signoff_requests set revoked_at = '2001-01-01' where id = f4a;
  msg := null;
  begin
    update public.property_signoff_requests set revoked_at = null where id = f4a;
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from 'A withdrawn link can''t be brought back. Send a new one.' then
    raise exception 'FAIL 11: a withdrawn link was brought back (%)', coalesce(msg, 'accepted');
  end if;
  insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement)
  values (office, p4, 'x', 'Test statement') returning id into f4b;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  if (select revoked_at from public.property_signoff_requests where id = f4a) is distinct from now() then
    raise exception 'FAIL 11: the withdrawal time came from the browser';
  end if;
  select token into f4btok from public.property_signoff_requests where id = f4b;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  if not public.submit_signoff(f4btok, 'Outside Licensee') then
    raise exception 'FAIL 11: the final sign-off link could not be signed';
  end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', nf, 'role', 'authenticated')::text, true);
  set local role authenticated;
  msg := null;
  begin
    update public.property_signoff_requests set revoked_at = now() where id = f4b;
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from 'That link has already been signed, so it can''t be withdrawn.' then
    raise exception 'FAIL 11: a signed link was withdrawn (%)', coalesce(msg, 'accepted');
  end if;

  -- 12. The browser can't put the link's keys on b4 or sign_licensee, even
  --     while they are open, and can't mark b4 done. (It can name someone in
  --     completed_by on an open card; check 14 shows the approval clears it.)
  insert into public.property_items (agency_id, property_id, item_key, status, completed_by, data)
  values (office, p1, 'b4', 'open', nm, jsonb_build_object(
    'note', 'Planted note', 'signedVia', 'link', 'signedName', 'Outside Licensee',
    'signoffRequestId', b1, 'sentTo', 'ps-outside-lic@example.invalid', 'signedBy', nm,
    'evidenceFileName', 'price-ad.pdf'));
  update public.property_items
     set data = data || jsonb_build_object('signedVia', 'link', 'signedName', 'Outside Licensee',
                                           'signoffRequestId', b1, 'sentTo', 'ps-outside-lic@example.invalid')
   where property_id = p1 and item_key = 'b4';
  insert into public.property_items (agency_id, property_id, item_key, status, data)
  values (office, p1, 'sign_licensee', 'open', jsonb_build_object(
    'signedVia', 'link', 'signedName', 'Outside Licensee', 'signoffRequestId', f1));
  select data into d from public.property_items where property_id = p1 and item_key = 'b4';
  if d ?| array['signedVia', 'signedName', 'signoffRequestId', 'sentTo'] or d->>'note' <> 'Planted note' then
    raise exception 'FAIL 12: the browser put the link''s keys on b4: %', d;
  end if;
  select data into d from public.property_items where property_id = p1 and item_key = 'sign_licensee';
  if d ?| array['signedVia', 'signedName', 'signoffRequestId', 'sentTo'] then
    raise exception 'FAIL 12: the browser put the link''s keys on sign_licensee: %', d;
  end if;
  msg := null;
  begin
    update public.property_items set status = 'done' where property_id = p1 and item_key = 'b4';
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from 'Only the licensee in charge can sign this.' then
    raise exception 'FAIL 12: someone other than the licensee approved b4 (%)', coalesce(msg, 'accepted');
  end if;

  -- ══════════════ Signed out, with the emailed links ══════════════
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select token into b1tok from public.property_signoff_requests where id = b1;
  select token into b3tok from public.property_signoff_requests where id = b3;
  select token into bstok from public.property_signoff_requests where id = bs;
  select token into f1tok from public.property_signoff_requests where id = f1;
  select data into d from public.property_items where property_id = p1 and item_key = 'sign_licensee';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;

  -- 13. The public page reads what the link is for and the exact words.
  select * into r from public.get_signoff_request_v3(b1tok);
  if r.request_id is distinct from b1 or r.item_key <> 'b4' or r.price_statement <> 'Guide $750,000 to $790,000'
     or r.esp_low <> 750000 or r.esp_high <> 790000 or r.property_address <> '1 Price St'
     or r.requested_by_name <> 'PS Founder' or position('Guide $750,000 to $790,000' in r.statement) = 0 then
    raise exception 'FAIL 13: the public page did not get the price statement request';
  end if;
  if (select v.item_key from public.get_signoff_request_v3(f1tok) v) is distinct from 'sign_licensee' then
    raise exception 'FAIL 13: the public page did not get the final sign-off request';
  end if;

  -- 14. Approving completes b4 with who, when, where it was sent and what was
  --     approved, all from the request. What the browser planted is gone,
  --     the attached file's name stays, and the final sign-off is untouched.
  if not public.submit_signoff(b1tok, '  Outside Licensee  ') then
    raise exception 'FAIL 14: the licensee could not approve the price statement';
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select * into r from public.property_items where property_id = p1 and item_key = 'b4';
  if r.status <> 'done' or r.completed_by is not null
     or r.data->>'note' is distinct from 'Guide $750,000 to $790,000'
     or r.data->>'signedVia' is distinct from 'link'
     or r.data->>'signedName' is distinct from 'Outside Licensee'
     or r.data->>'signoffRequestId' is distinct from b1::text
     or (r.data->>'signedAt')::timestamptz is distinct from (select signed_at from public.property_signoff_requests where id = b1)
     or r.data->>'sentTo' is distinct from 'ps-outside-lic@example.invalid'
     or r.data ? 'signedBy'
     or r.data->>'evidenceFileName' is distinct from 'price-ad.pdf' then
    raise exception 'FAIL 14: b4 was not recorded as approved by the link: %', row_to_json(r);
  end if;
  if (select data from public.property_items where property_id = p1 and item_key = 'sign_licensee') is distinct from d
     or not exists (select 1 from public.property_items
                     where property_id = p1 and item_key = 'sign_licensee' and status = 'open') then
    raise exception 'FAIL 14: approving the price statement touched the final sign-off';
  end if;
  if not exists (select 1 from public.property_items
                  where property_id = p1 and item_key = 'send_licensee' and status = 'done'
                    and data = '{"sentAt": "2026-10-01T00:00:00Z"}'::jsonb) then
    raise exception 'FAIL 14: approving the price statement touched Send to licensee';
  end if;
  if not exists (select 1 from public.property_signoff_requests
                  where id = b1 and signed_at is not null and signed_name = 'Outside Licensee') then
    raise exception 'FAIL 14: the request was not marked approved';
  end if;

  -- 15. The link is spent.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  if public.submit_signoff(b1tok, 'Outside Licensee') then
    raise exception 'FAIL 15: a price statement link was used twice';
  end if;
  if exists (select 1 from public.get_signoff_request_v3(b1tok)) then
    raise exception 'FAIL 15: a used price statement link still opens';
  end if;

  -- 16. b4 approved in the app first: the link no longer opens or approves.
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into public.property_items (agency_id, property_id, item_key, status, data)
    values (solo, ps, 'b4', 'done', '{"note": "Approved in the app"}');
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  if exists (select 1 from public.get_signoff_request_v3(bstok)) then
    raise exception 'FAIL 16: a link opens after b4 was approved in the app';
  end if;
  ok := false;
  begin
    ok := public.submit_signoff(bstok, 'Solo Licensee');
  exception when others then ok := false;   -- refused with an error is still refused
  end;
  if ok then
    raise exception 'FAIL 16: a link approved b4 over an approval already recorded';
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  if exists (select 1 from public.property_signoff_requests where id = bs and signed_at is not null)
     or (select data->>'note' from public.property_items where property_id = ps and item_key = 'b4') <> 'Approved in the app' then
    raise exception 'FAIL 16: the in-app approval was overwritten';
  end if;

  -- 17. The ESP changes, the ESP reasoning reopens, or a revision notice is
  --     read in full after the link went out: it no longer opens or approves.
  perform set_config('request.jwt.claims', json_build_object('sub', nf, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement, item_key, price_statement)
  values (office, p5, 'x', 'x', 'b4', 'Guide $750,000 to $790,000') returning id into b5;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select token into b5tok from public.property_signoff_requests where id = b5;
  for n in 1..3 loop
    if n = 1 then
      update public.property_items set data = '{"espLow": 700000, "espHigh": 790000}' where property_id = p5 and item_key = 'a4';
    elsif n = 2 then
      update public.property_items set status = 'open' where property_id = p5 and item_key = 'a4c';
    else
      update public.property_items set data = '{"revisedEspLow": 700000, "revisedEspHigh": 740000}' where property_id = p5 and item_key = 'd3';
    end if;
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
    if exists (select 1 from public.get_signoff_request_v3(b5tok)) then
      raise exception 'FAIL 17: a price statement link opens after % changed', (array['the ESP', 'the ESP reasoning', 'the revised ESP'])[n];
    end if;
    if public.submit_signoff(b5tok, 'Outside Licensee') then
      raise exception 'FAIL 17: a price statement was approved after % changed', (array['the ESP', 'the ESP reasoning', 'the revised ESP'])[n];
    end if;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    update public.property_items set data = '{"espLow": 750000, "espHigh": 790000}' where property_id = p5 and item_key = 'a4';
    update public.property_items set status = 'done' where property_id = p5 and item_key = 'a4c';
    update public.property_items set data = '{"revisedEspLow": 700000}' where property_id = p5 and item_key = 'd3';
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
    if not exists (select 1 from public.get_signoff_request_v3(b5tok)) then
      raise exception 'FAIL 17: the link did not open again once the file was back as it was sent';
    end if;
    reset role;
    perform set_config('request.jwt.claims', '', true);
  end loop;

  -- 18. A final sign-off link still writes only the final sign-off.
  select data into d from public.property_items where property_id = p1 and item_key = 'b4';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  if not public.submit_signoff(f1tok, 'Outside Licensee') then
    raise exception 'FAIL 18: the final sign-off link could not be signed';
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  if not exists (select 1 from public.property_items
                  where property_id = p1 and item_key = 'sign_licensee' and status = 'done'
                    and data->>'signoffRequestId' = f1::text)
     or (select data from public.property_items where property_id = p1 and item_key = 'b4') is distinct from d then
    raise exception 'FAIL 18: the final sign-off link wrote something other than the final sign-off';
  end if;

  -- 19. A price statement link can't send the file back.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  msg := null;
  begin
    perform public.send_back_by_token(bstok, '[{"item_key":"a4","note":"x"}]');
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from 'This link is no longer valid.' then
    raise exception 'FAIL 19: a price statement link sent the file back (%)', coalesce(msg, 'accepted');
  end if;

  -- 20. Approving the flagged price statement clears the flag, and the final
  --     link can then go out.
  if not exists (select 1 from public.get_signoff_request_v3(b3tok)) or not public.submit_signoff(b3tok, 'Outside Licensee') then
    raise exception 'FAIL 20: the flagged price statement could not be approved';
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  if public.listing_has_open_send_back(p3)
     or not exists (select 1 from public.property_items where property_id = p3 and item_key = 'b4' and status = 'done') then
    raise exception 'FAIL 20: approving the flagged price statement did not clear the flag';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', nf, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement)
  values (office, p3, 'x', 'Test statement');

  -- ══════════════ Who can change the licensee's details ══════════════
  -- 21. The assistant on an agent plan and the office's second member can't;
  --     the agent on their own plan and the office's founder can. An
  --     assistant can't even if they were somehow the earliest profile.
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', sas, 'role', 'authenticated')::text, true);
  set local role authenticated;
  msg := null;
  begin perform public.set_agency_licensee_email('ps-fake@example.invalid');
  exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FAIL 21: an assistant changed the licensee''s email'; end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set created_at = now() - interval '1 day' where id = sas;
  perform set_config('request.jwt.claims', json_build_object('sub', sas, 'role', 'authenticated')::text, true);
  set local role authenticated;
  msg := null;
  begin perform public.set_agency_licensee_email('ps-fake@example.invalid');
  exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FAIL 21: an assistant who is the account holder changed the licensee''s email'; end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set created_at = now() + interval '1 minute' where id = sas;
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_agency_licensee_email('ps-solo-lic@example.invalid');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', nm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  msg := null;
  begin perform public.set_agency_licensee_email('ps-fake@example.invalid');
  exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FAIL 21: a member who is not the account holder changed the licensee''s email'; end if;

  -- 22. Nobody signed in can make themselves licensee in charge.
  if has_function_privilege('authenticated', 'public.set_licensee_in_charge(boolean)', 'execute') then
    raise exception 'FAIL 22: signed-in people can still run set_licensee_in_charge';
  end if;
  msg := null;
  begin perform public.set_licensee_in_charge(true);
  exception when others then msg := sqlerrm; end;
  if msg is null then raise exception 'FAIL 22: a member made themselves licensee in charge'; end if;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', nf, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_agency_licensee('Outside Licensee', 'ps-new-lic@example.invalid');

  -- 23. Each change is logged, with who made it. The account holder can read
  --     the log; another member can't. No change, no row.
  select count(*) into n from public.licensee_contact_changes
   where agency_id = office and changed_by = nf
     and old_email = 'ps-outside-lic@example.invalid' and new_email = 'ps-new-lic@example.invalid'
     and old_name = 'Outside Licensee' and new_name = 'Outside Licensee';
  if n <> 1 then raise exception 'FAIL 23: the change to the licensee''s email was not logged'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', nm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.licensee_contact_changes) then
    raise exception 'FAIL 23: a member who is not the account holder can read the log';
  end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  if exists (select 1 from public.licensee_contact_changes where agency_id = solo) then
    raise exception 'FAIL 23: an unchanged email was logged as a change';
  end if;

  -- ══════════════ The 7-year record ══════════════
  -- 24. Each link says what it was for. Contact changes are ids and dates,
  --     never the names, addresses or the price statement.
  rec := public.build_activity_record(office);
  if exists (select 1 from jsonb_array_elements(rec->'licensee_signoff_links') e where not e ? 'item')
     or not exists (select 1 from jsonb_array_elements(rec->'licensee_signoff_links') e where e->>'item' = 'b4')
     or not exists (select 1 from jsonb_array_elements(rec->'licensee_signoff_links') e where e->>'item' = 'sign_licensee') then
    raise exception 'FAIL 24: the activity record does not say what each link was for';
  end if;
  if jsonb_array_length(coalesce(rec->'licensee_contact_changes', '[]')) = 0
     or exists (select 1 from jsonb_array_elements(rec->'licensee_contact_changes') e
                 where (select array_agg(k order by k) from jsonb_object_keys(e) k) <> array['at', 'by']) then
    raise exception 'FAIL 24: the activity record does not have the contact changes, ids and dates only';
  end if;
  if rec::text like '%ps-new-lic%' or rec::text like '%ps-outside-lic%' or rec::text like '%Outside Licensee%'
     or rec::text like '%Guide $750,000%' then
    raise exception 'FAIL 24: a name, address or price statement was copied into the activity record';
  end if;

  -- 25. After the subscription ends, a price statement link can't approve.
  update public.agencies set status = 'canceled' where id = office;
  if (select ended_at from public.agencies where id = office) is null then
    raise exception 'FAIL 25: the test office did not end';
  end if;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  msg := null;
  begin
    perform public.submit_signoff(b5tok, 'Outside Licensee');
  exception when others then msg := sqlerrm;
  end;
  if msg is null or msg not like '%subscription has ended%' then
    raise exception 'FAIL 25: a price statement was approved after the subscription ended (%)', coalesce(msg, 'accepted');
  end if;

  reset role;
  raise notice 'Price statement link: all checks passed';
end
$$;

rollback;

select 'Price statement link: all checks passed' as result;
