-- ===== READ ONLY. Withdrawn from sale, 6 November 2026 =====
--
-- Proves supabase/migrations/0114_listing_withdrawals.sql. Safe on the live
-- database: everything happens inside one transaction that is rolled back at
-- the end, so the made-up offices and people never exist outside it.
--
-- Pass: the last line says "Withdrawn from sale: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1 uuid := gen_random_uuid();   -- an office
  o2 uuid := gen_random_uuid();   -- another office
  l   uuid := gen_random_uuid();  -- o1's licensee in charge
  a   uuid := gen_random_uuid();  -- an agent in o1, whose listing this is
  b   uuid := gen_random_uuid();  -- another agent in o1
  s   uuid := gen_random_uuid();  -- a's assistant
  x   uuid := gen_random_uuid();  -- o2's licensee
  p1  uuid;                       -- a's listing, on the market
  p2  uuid;                       -- a's listing, exchanged (Sold)
  w   public.listing_withdrawals%rowtype;
  n integer;
  t text;
  ok boolean;
begin
  insert into auth.users (id, email) values
    (l, 'wd-l@example.invalid'), (a, 'wd-a@example.invalid'), (b, 'wd-b@example.invalid'),
    (s, 'wd-s@example.invalid'), (x, 'wd-x@example.invalid');
  insert into public.agencies (id, name, plan, status) values
    (o1, 'WD Office One (made up)', 'office_1', 'active'), (o2, 'WD Office Two (made up)', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (l, o1, 'Lee Licensee', 'wd-l@example.invalid', true, true, false),
    (a, o1, 'Ana Agent', 'wd-a@example.invalid', true, false, false),
    (b, o1, 'Ben Agent', 'wd-b@example.invalid', true, false, false),
    (s, o1, 'Sam Assistant', 'wd-s@example.invalid', false, false, true),
    (x, o2, 'Xan Elsewhere', 'wd-x@example.invalid', true, true, false);
  insert into public.assistant_agents (assistant_id, agent_id, agency_id) values (s, a, o1);
  insert into public.properties (agency_id, created_by, address, stage) values (o1, a, '1 Withdrawn St (made up)', 2) returning id into p1;
  insert into public.properties (agency_id, created_by, address, stage) values (o1, a, '2 Exchanged St (made up)', 4) returning id into p2;
  insert into public.property_items (agency_id, property_id, item_key, status, data, completed_by)
  values (o1, p1, 'a5', 'done', '{"note": "Commission 2%"}', a);

  -- 1. Nobody signed in can write the table directly; reading needs a login.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.listing_withdrawals (agency_id, property_id, withdrawn_on, reason)
    values (o1, p1, current_date, 'seller_changed_mind');
    raise exception 'check 1 failed: a direct insert was allowed';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 2. Another agent, an assistant and another office's licensee can't withdraw it.
  foreach t in array array[b::text, s::text, x::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.withdraw_listing(p1, current_date, 'seller_changed_mind');
      raise exception 'check 2 failed: % could withdraw the listing', t;
    exception when raise_exception then
      if sqlerrm like 'check 2 failed%' then raise; end if;
    end;
    reset role;
  end loop;

  -- 3. The rules on what's given: a date, not in the future; a reason; Other says why;
  --    evidence only from the listing's own withdrawal folder; not after exchange.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  foreach t in array array['future', 'reason', 'other', 'folder', 'exchanged'] loop
    begin
      case t
        when 'future' then perform public.withdraw_listing(p1, current_date + 30, 'seller_changed_mind');
        when 'reason' then perform public.withdraw_listing(p1, current_date, 'bored');
        when 'other' then perform public.withdraw_listing(p1, current_date, 'other', '  ');
        when 'folder' then perform public.withdraw_listing(p1, current_date, 'seller_changed_mind', null, o1::text || '/' || p2::text || '/withdrawal/x.pdf', 'x.pdf');
        when 'exchanged' then perform public.withdraw_listing(p2, current_date, 'seller_changed_mind');
      end case;
      raise exception 'check 3 failed: % was allowed', t;
    exception when raise_exception then
      if sqlerrm like 'check 3 failed%' then raise; end if;
    end;
  end loop;

  -- 4. The listing's agent withdraws it: who and when stamped, evidence kept.
  w := public.withdraw_listing(p1, current_date - 1, 'other', '  Vendor is renovating first ',
                               o1::text || '/' || p1::text || '/withdrawal/123-email.pdf', 'Seller email.pdf');
  if w.withdrawn_by is distinct from a or w.reason_other <> 'Vendor is renovating first'
     or w.evidence_file_name <> 'Seller email.pdf' or w.put_back_at is not null then
    raise exception 'check 4 failed: %', row_to_json(w);
  end if;
  -- The assistant and the licensee can read it; the other office can't.
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.listing_withdrawals where property_id = p1;
  if n <> 1 then raise exception 'check 4 failed: the assistant sees % rows', n; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.listing_withdrawals;
  if n <> 0 then raise exception 'check 4 failed: another office sees % rows', n; end if;
  reset role;

  -- 5. Withdrawn means read only: no card or detail changes, and no second withdrawal.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  foreach t in array array['card', 'new card', 'details', 'again'] loop
    begin
      case t
        when 'card' then update public.property_items set status = 'open' where property_id = p1 and item_key = 'a5';
        when 'new card' then insert into public.property_items (agency_id, property_id, item_key, status) values (o1, p1, 'a6', 'done');
        when 'details' then update public.properties set address = '1 Changed St (made up)' where id = p1;
        when 'again' then perform public.withdraw_listing(p1, current_date, 'seller_changed_mind');
      end case;
      raise exception 'check 5 failed: % was allowed while withdrawn', t;
    exception when raise_exception then
      if sqlerrm like 'check 5 failed%' then raise; end if;
    end;
  end loop;
  reset role;

  -- 6. The licensee puts it back: stamped, and the listing can change again.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  w := public.put_listing_back_on_market(p1);
  if w.put_back_by is distinct from l or w.put_back_at is null then
    raise exception 'check 6 failed: %', row_to_json(w);
  end if;
  update public.property_items set status = 'open' where property_id = p1 and item_key = 'a5';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'check 6 failed: the card could not change after it was put back'; end if;
  begin
    perform public.put_listing_back_on_market(p1);
    raise exception 'check 6 failed: put back twice';
  exception when raise_exception then
    if sqlerrm like 'check 6 failed%' then raise; end if;
  end;
  reset role;

  -- 7. Both rows of history stay; withdrawing again makes a second row.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.withdraw_listing(p1, current_date, 'listed_with_another_agency');
  reset role;
  select count(*) into n from public.listing_withdrawals where property_id = p1;
  if n <> 2 then raise exception 'check 7 failed: % rows of history', n; end if;

  -- 8. Deleting a withdrawn listing still works, and takes its history with it.
  delete from public.properties where id = p1;
  select count(*) into n from public.listing_withdrawals where property_id = p1;
  if n <> 0 then raise exception 'check 8 failed: % rows left after the listing was deleted', n; end if;

  raise notice 'Withdrawn from sale: all checks passed';
end $$;

rollback;
