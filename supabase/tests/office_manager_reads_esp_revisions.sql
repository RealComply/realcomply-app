-- ===== READ ONLY. The office manager reads every listing's ESP revisions and withdrawals, 3 November 2026 =====
--
-- Proves supabase/migrations/0111_office_manager_reads_esp_revisions.sql. Run
-- after it. Safe on the live database: everything happens inside one
-- transaction that is rolled back at the end, so the made-up offices, people
-- and listings it creates never exist outside it.
--
-- Pass: the last line says "Office manager reads ESP revisions and withdrawals: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1 uuid := gen_random_uuid();   -- an office
  o2 uuid := gen_random_uuid();   -- another office
  l  uuid := gen_random_uuid();   -- o1's licensee in charge
  m  uuid := gen_random_uuid();   -- o1's office manager
  a  uuid := gen_random_uuid();   -- an agent in o1, whose listing p1 is
  b  uuid := gen_random_uuid();   -- another agent in o1
  y  uuid := gen_random_uuid();   -- o2's office manager
  x  uuid := gen_random_uuid();   -- o2's licensee
  p1 uuid;
  p2 uuid;                        -- a's other listing, withdrawn from sale
  n  integer;
  folder text;
begin
  insert into auth.users (id, email) values
    (l, 'omer-l@example.invalid'), (m, 'omer-m@example.invalid'), (a, 'omer-a@example.invalid'),
    (b, 'omer-b@example.invalid'), (y, 'omer-y@example.invalid'), (x, 'omer-x@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'OMER Office One (made up)', 'office_2', 'active', 'Lee Licensee', 'omer-lee-own@example.invalid'),
    (o2, 'OMER Office Two (made up)', 'office_2', 'active', 'Xan Licensee', 'omer-xan-own@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (l, o1, 'Lee Licensee', 'omer-l@example.invalid', true, true, false),
    (m, o1, 'Max Manager', 'omer-m@example.invalid', true, false, false),
    (a, o1, 'Ana Agent', 'omer-a@example.invalid', true, false, false),
    (b, o1, 'Ben Agent', 'omer-b@example.invalid', true, false, false),
    (x, o2, 'Xan Licensee', 'omer-x@example.invalid', true, true, false),
    (y, o2, 'Yui Manager', 'omer-y@example.invalid', true, false, false);
  insert into public.office_managers (agency_id, profile_id, wording, approved_via, approved_by, approved_by_name) values
    (o1, m, 'I authorise Max Manager to manage OMER Office One''s RealComply account as office manager.', 'team', l, 'Lee Licensee'),
    (o2, y, 'I authorise Yui Manager to manage OMER Office Two''s RealComply account as office manager.', 'team', x, 'Xan Licensee');
  insert into public.properties (agency_id, created_by, address)
  values (o1, a, '9 Made Up Parade, Nowhere NSW (made up)') returning id into p1;
  insert into public.properties (agency_id, created_by, address, stage)
  values (o1, a, '11 Made Up Parade, Nowhere NSW (made up)', 2) returning id into p2;
  folder := o1::text || '/' || p1::text || '/d3/';
  insert into public.property_items (agency_id, property_id, item_key, status, data) values
    (o1, p1, 'a4', 'done', '{"espLow": 900000, "espHigh": 950000}'),
    (o1, p1, 'd3', 'open', '{"espRevised": true}');

  -- The agent records two revisions.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.record_esp_revision(p1, 880000, 920000, current_date - 9, folder || '1-notice.pdf', '1-notice.pdf',
                                     false, null, null, '{}', 'open');
  perform public.record_esp_revision(p1, 850000, 900000, current_date - 2, folder || '2-notice.pdf', '2-notice.pdf',
                                     false, null, null, '{}', 'open');
  -- And withdraws p2 from sale.
  perform public.withdraw_listing(p2, current_date - 1, 'seller_changed_mind');
  reset role;

  -- 1. The office manager reads both revisions on another agent's listing.
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.esp_revisions where property_id = p1;
  if n <> 2 then raise exception 'FAIL 1: the office manager saw % of 2 revisions', n; end if;

  -- 2. Reading only: the office manager can't record one.
  begin
    perform public.record_esp_revision(p1, 800000, 840000, current_date, folder || '3-notice.pdf', '3-notice.pdf',
                                       false, null, null, '{}', 'open');
    raise exception 'FAIL 2: the office manager recorded a revision on another agent''s listing';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.esp_revisions (agency_id, property_id, revision_no, esp_low, esp_high, notice_path)
    values (o1, p1, 3, 800000, 840000, folder || '3-notice.pdf');
    raise exception 'FAIL 2b: the office manager added a revision row';
  exception when insufficient_privilege then null;
  end;

  -- 2c. The office manager sees that p2 is withdrawn, and still can't put it back.
  select count(*) into n from public.listing_withdrawals where property_id = p2 and put_back_at is null;
  if n <> 1 then raise exception 'FAIL 2c: the office manager saw % of 1 withdrawal', n; end if;
  begin
    perform public.put_listing_back_on_market(p2);
    raise exception 'FAIL 2d: the office manager put another agent''s listing back on the market';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    update public.listing_withdrawals set put_back_at = now() where property_id = p2;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL 2e: the office manager changed a withdrawal row'; end if;
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 3. Another agent in the same office still sees none of it.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.esp_revisions where property_id = p1;
  if n <> 0 then raise exception 'FAIL 3: another agent saw % revisions', n; end if;
  select count(*) into n from public.listing_withdrawals where property_id = p2;
  if n <> 0 then raise exception 'FAIL 3b: another agent saw % withdrawals', n; end if;
  reset role;

  -- 4. Another office's office manager sees none of it.
  perform set_config('request.jwt.claims', json_build_object('sub', y, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.esp_revisions where property_id = p1;
  if n <> 0 then raise exception 'FAIL 4: another office''s office manager saw % revisions', n; end if;
  select count(*) into n from public.listing_withdrawals where property_id = p2;
  if n <> 0 then raise exception 'FAIL 4b: another office''s office manager saw % withdrawals', n; end if;
  reset role;

  -- 5. The licensee in charge still sees them.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.esp_revisions where property_id = p1;
  if n <> 2 then raise exception 'FAIL 5: the licensee saw % of 2 revisions', n; end if;
  select count(*) into n from public.listing_withdrawals where property_id = p2;
  if n <> 1 then raise exception 'FAIL 5b: the licensee saw % of 1 withdrawal', n; end if;
  reset role;

  raise notice 'Office manager reads ESP revisions and withdrawals: all checks passed';
end $$;

rollback;
