-- ===== READ ONLY. Licensee review and send back test, 12 October 2026 =====
--
-- Proves supabase/migrations/0062_licensee_review.sql. Run after 0062. Safe on
-- the live database: everything happens inside one transaction that is rolled
-- back at the end.
--
-- Pass: the last line says "Licensee review: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  office uuid := gen_random_uuid();
  lic uuid := gen_random_uuid();
  ag1 uuid := gen_random_uuid();
  ag2 uuid := gen_random_uuid();
  p1 uuid;
  req uuid;
  tok uuid;
  flag uuid;
  n integer;
  refused boolean;
  rec jsonb;
begin
  insert into auth.users (id, email) values
    (lic, 'lr-lic@example.invalid'), (ag1, 'lr-ag1@example.invalid'), (ag2, 'lr-ag2@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_email) values
    (office, 'Licensee review test office', 'office_1', 'active', 'lr-lic@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent) values
    (lic, office, 'Test Licensee', 'lr-lic@example.invalid', true, false, true),
    (ag1, office, 'Test Agent One', 'lr-ag1@example.invalid', false, false, true),
    (ag2, office, 'Test Agent Two', 'lr-ag2@example.invalid', false, false, true);
  insert into public.properties (agency_id, created_by, address) values (office, ag1, '1 Review St') returning id into p1;
  insert into public.property_items (agency_id, property_id, item_key, status) values
    (office, p1, 'a3', 'done'), (office, p1, 'sign_agent', 'open'), (office, p1, 'send_licensee', 'done');

  -- ══════════════ As agent 1: sign, and send to the licensee ══════════════
  perform set_config('request.jwt.claims', json_build_object('sub', ag1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  update public.property_items set status = 'done', data = '{"typedName":"Test Agent One"}'
   where property_id = p1 and item_key = 'sign_agent';
  insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement, created_by)
  values (office, p1, 'x', 'Test statement', ag1) returning id into req;

  -- 1. The agent cannot send their own file back.
  refused := false;
  begin
    perform public.send_back_listing(p1, '[{"item_key":"a3","note":"x"}]');
  exception when others then refused := true;
  end;
  if not refused then raise exception 'FAIL 1: an agent sent a file back'; end if;

  -- ══════════════ As the licensee, signed in: send it back ══════════════
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 2. A send-back needs at least one card with a note.
  refused := false;
  begin
    perform public.send_back_listing(p1, '[]');
  exception when others then refused := true;
  end;
  if not refused then raise exception 'FAIL 2: an empty send-back was accepted'; end if;
  refused := false;
  begin
    perform public.send_back_listing(p1, '[{"item_key":"a3","note":"  "}]');
  exception when others then refused := true;
  end;
  if not refused then raise exception 'FAIL 2: a card with no note was accepted'; end if;

  -- 3. The licensee sends it back with one card.
  perform public.send_back_listing(p1, '[{"item_key":"a3","note":"Agreement date is wrong","may_be_breach":true}]');

  reset role;
  -- 4. The link is revoked, Send to licensee and the agent signature reopen,
  --    and the first signature is kept apart.
  select count(*) into n from public.property_signoff_requests where id = req and revoked_at is not null;
  if n <> 1 then raise exception 'FAIL 4: the outstanding link was not revoked'; end if;
  select count(*) into n from public.property_items where property_id = p1 and item_key in ('sign_agent', 'send_licensee') and status = 'open';
  if n <> 2 then raise exception 'FAIL 4: the agent signature and Send to licensee did not reopen'; end if;
  select count(*) into n from public.property_items where property_id = p1 and item_key = 'sign_agent' and data = '{}'::jsonb;
  if n <> 1 then raise exception 'FAIL 4: the first agent signature was left on the card'; end if;
  select count(*) into n from public.superseded_agent_signatures where property_id = p1 and signed_by = ag1;
  if n <> 1 then raise exception 'FAIL 4: the superseded signature was not recorded'; end if;
  select id into flag from public.listing_send_back_items where property_id = p1 and cleared_at is null;
  if flag is null then raise exception 'FAIL 4: the flagged card was not recorded'; end if;

  -- ══════════════ As agent 1, while the card is open ══════════════
  perform set_config('request.jwt.claims', json_build_object('sub', ag1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 5. Sees the flag; cannot sign again or send a new link yet.
  select count(*) into n from public.listing_send_back_items where property_id = p1;
  if n <> 1 then raise exception 'FAIL 5: the agent cannot see the flagged card'; end if;
  refused := false;
  begin
    update public.property_items set status = 'done', data = '{"typedName":"Test Agent One"}'
     where property_id = p1 and item_key = 'sign_agent';
  exception when others then refused := true;
  end;
  if not refused then raise exception 'FAIL 5: the agent signed again with a card still open'; end if;
  refused := false;
  begin
    insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement, created_by)
    values (office, p1, 'x', 'Test statement', ag1);
  exception when others then refused := true;
  end;
  if not refused then raise exception 'FAIL 5: a new link was issued with a card still open'; end if;

  -- ══════════════ As agent 2, who cannot see the listing ══════════════
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ag2, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 6. Cannot see or clear another agent's flag.
  select count(*) into n from public.listing_send_back_items where property_id = p1;
  if n <> 0 then raise exception 'FAIL 6: another agent can see the flagged card'; end if;
  refused := false;
  begin
    perform public.clear_send_back_item(flag, 'not mine');
  exception when others then refused := true;
  end;
  if not refused then raise exception 'FAIL 6: another agent cleared the flagged card'; end if;

  -- ══════════════ As agent 1: Changes made, sign again, resend ══════════════
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ag1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 7. Clears it, signs again and sends a new link.
  if not public.clear_send_back_item(flag, 'Corrected') then
    raise exception 'FAIL 7: the agent could not mark Changes made';
  end if;
  update public.property_items set status = 'done', data = '{"typedName":"Test Agent One"}'
   where property_id = p1 and item_key = 'sign_agent';
  insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement, created_by)
  values (office, p1, 'x', 'Test statement', ag1) returning id into req;

  reset role;
  select token into tok from public.property_signoff_requests where id = req;

  -- ══════════════ Signed out, with the emailed link ══════════════
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;

  -- 8. Cannot read any send-back.
  refused := false;
  begin
    select count(*) into n from public.listing_send_back_items;
    if n > 0 then refused := false; else refused := true; end if;
  exception when others then refused := true;
  end;
  if not refused then raise exception 'FAIL 8: a signed-out visitor can read send-backs'; end if;

  -- 9. A wrong token is refused; the right one sends it back.
  refused := false;
  begin
    perform public.send_back_by_token(gen_random_uuid(), '[{"item_key":"a3","note":"x"}]');
  exception when others then refused := true;
  end;
  if not refused then raise exception 'FAIL 9: a made-up link sent a file back'; end if;
  perform public.send_back_by_token(tok, '[{"item_key":"a3","note":"Still wrong"}]');

  -- 10. The link is spent: it cannot send back or sign again.
  refused := false;
  begin
    perform public.send_back_by_token(tok, '[{"item_key":"a3","note":"again"}]');
  exception when others then refused := true;
  end;
  if not refused then raise exception 'FAIL 10: a revoked link sent the file back again'; end if;
  if public.submit_signoff(tok, 'Test Licensee') then
    raise exception 'FAIL 10: a revoked link was signed';
  end if;

  -- ══════════════ As the licensee, signed in, with a card open ══════════════
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 11. Cannot sign off while a card is still open.
  refused := false;
  begin
    insert into public.property_items (agency_id, property_id, item_key, status, data)
    values (office, p1, 'sign_licensee', 'done', '{"typedName":"Test Licensee"}');
  exception when others then refused := true;
  end;
  if not refused then raise exception 'FAIL 11: the licensee signed off with a card still open'; end if;

  -- ══════════════ The 7-year record ══════════════
  reset role;
  rec := public.build_activity_record(office);

  -- 12. Both send-backs and the superseded signatures are in it, without the notes.
  if jsonb_array_length(rec->'send_backs') <> 2 then
    raise exception 'FAIL 12: the activity record does not have both send-backs';
  end if;
  if jsonb_array_length(rec->'superseded_agent_signatures') <> 2 then
    raise exception 'FAIL 12: the activity record does not have both superseded signatures';
  end if;
  if rec::text like '%Agreement date is wrong%' or rec::text like '%Still wrong%' or rec::text like '%Corrected%' then
    raise exception 'FAIL 12: a note or reply was copied into the activity record';
  end if;

  raise notice 'Licensee review: all checks passed';
end
$$;

rollback;

select 'Licensee review: all checks passed' as result;
