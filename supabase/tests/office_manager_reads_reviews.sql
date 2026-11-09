-- ===== READ ONLY. The office manager sees every listing; gift and complaint reviews, 3 November 2026 =====
--
-- Proves supabase/migrations/0108_office_manager_reads_reviews.sql. Run
-- after it. Safe on the live database: everything happens inside one
-- transaction that is rolled back at the end, so the made-up offices,
-- people and listings it creates never exist outside it.
--
-- Pass: the last line says "Office manager reads and reviews: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1 uuid := gen_random_uuid();   -- an office
  o2 uuid := gen_random_uuid();   -- another office
  l  uuid := gen_random_uuid();   -- o1's licensee in charge
  m  uuid := gen_random_uuid();   -- o1's office manager
  a  uuid := gen_random_uuid();   -- an agent in o1
  b  uuid := gen_random_uuid();   -- another agent in o1
  y  uuid := gen_random_uuid();   -- o2's office manager
  x  uuid := gen_random_uuid();   -- o2's licensee
  pa uuid := gen_random_uuid();   -- a's listing
  pq uuid := gen_random_uuid();   -- a's property under management
  g1 uuid := gen_random_uuid();   -- a gift over the limit
  g0 uuid := gen_random_uuid();   -- a gift reviewed before 0108
  c1 uuid := gen_random_uuid();   -- an open complaint
  c0 uuid := gen_random_uuid();   -- a complaint resolved before 0108
  c2 uuid := gen_random_uuid();   -- another open complaint
  link uuid;
  n integer;
  r record;
  t timestamptz;
begin
  insert into auth.users (id, email) values
    (l, 'omr-l@example.invalid'), (m, 'omr-m@example.invalid'), (a, 'omr-a@example.invalid'),
    (b, 'omr-b@example.invalid'), (y, 'omr-y@example.invalid'), (x, 'omr-x@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'OMR Office One (made up)', 'office_2', 'active', 'Lee Licensee', 'omr-lee-own@example.invalid'),
    (o2, 'OMR Office Two (made up)', 'office_2', 'active', 'Xan Licensee', 'omr-xan-own@example.invalid');
  -- The licensee email has confirmed (0112), so links can go to it.
  insert into public.licensee_email_confirmations (agency_id, email, confirmed_at) values
    (o1, 'omr-lee-own@example.invalid', now()), (o2, 'omr-xan-own@example.invalid', now());
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (l, o1, 'Lee Licensee', 'omr-l@example.invalid', true, true, false),
    (m, o1, 'Max Manager', 'omr-m@example.invalid', true, false, false),
    (a, o1, 'Ana Agent', 'omr-a@example.invalid', true, false, false),
    (b, o1, 'Ben Agent', 'omr-b@example.invalid', true, false, false),
    (x, o2, 'Xan Licensee', 'omr-x@example.invalid', true, true, false),
    (y, o2, 'Yui Manager', 'omr-y@example.invalid', true, false, false);
  insert into public.office_managers (agency_id, profile_id, wording, approved_via, approved_by, approved_by_name) values
    (o1, m, 'I authorise Max Manager to manage OMR Office One''s RealComply account as office manager.', 'team', l, 'Lee Licensee'),
    (o2, y, 'I authorise Yui Manager to manage OMR Office Two''s RealComply account as office manager.', 'team', x, 'Xan Licensee');
  insert into public.properties (id, agency_id, created_by, address) values
    (pa, o1, a, '3 Made Up Street, Nowhere NSW (made up)');
  insert into public.property_items (agency_id, property_id, item_key, status, data)
  values (o1, pa, 'a1', 'done', '{"note":"made up"}');
  insert into public.pm_properties (id, agency_id, address, manager_id, origin, grp, created_by)
  values (pq, o1, '4 Made Up Street, Nowhere NSW (made up)', a, 'new', 'onboarding', a);
  insert into public.gifts (id, agency_id, profile_id, gift_date, description, value, direction, status, created_by) values
    (g1, o1, a, current_date, 'Wine from a vendor (made up)', 90, 'received', 'flagged', a),
    (g0, o1, a, current_date, 'Earlier gift (made up)', 80, 'received', 'reviewed', a);
  insert into public.complaints (id, agency_id, received_date, complainant, nature, status, resolved_date, created_by) values
    (c1, o1, date '2026-10-12', 'K. Adams, buyer (made up)', 'Inspection times', 'open', null, l),
    (c0, o1, date '2026-10-02', 'P. Lim, vendor (made up)', 'Slow to return calls', 'resolved', date '2026-10-20', l),
    (c2, o1, date '2026-10-22', 'J. Roe, tenant (made up)', 'Bond question', 'open', null, l);

  -- a sends the file sign-off link.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.property_signoff_requests (agency_id, property_id, statement)
  values (o1, pa, 'I sign off this file (made up).') returning id into link;
  reset role;

  -- 1. The office manager reads a's listing, its cards, its link and its PM property.
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.properties where id = pa;
  if n <> 1 then raise exception 'FAIL 1: the office manager can''t see another agent''s listing'; end if;
  select count(*) into n from public.property_items where property_id = pa;
  if n <> 1 then raise exception 'FAIL 1b: the office manager can''t see its cards'; end if;
  select count(*) into n from public.property_signoff_requests where id = link;
  if n <> 1 then raise exception 'FAIL 1c: the office manager can''t see where the sign-off link is up to'; end if;
  select count(*) into n from public.pm_properties where id = pq;
  if n <> 1 then raise exception 'FAIL 1d: the office manager can''t see another manager''s property'; end if;
  if not public.evidence_path_readable(o1 || '/' || pa || '/a1/agreement.pdf') then
    raise exception 'FAIL 1e: the office manager can''t read the listing''s files';
  end if;

  -- 2. ...and changes none of it.
  begin
    perform token from public.property_signoff_requests where id = link;
    raise exception 'FAIL 2: the office manager read the link''s token';
  exception when insufficient_privilege then null;
  end;
  update public.properties set address = 'Changed' where id = pa;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2b: the office manager changed another agent''s listing'; end if;
  update public.property_items set status = 'open' where property_id = pa;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2c: the office manager changed a card'; end if;
  begin
    insert into public.property_items (agency_id, property_id, item_key, status) values (o1, pa, 'a2', 'done');
    raise exception 'FAIL 2d: the office manager ticked a card on another agent''s listing';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.copy_signoff_link(link);
    raise exception 'FAIL 2e: the office manager copied another agent''s sign-off link';
  exception when insufficient_privilege then null;
  end;
  if public.evidence_path_writable(o1 || '/' || pa || '/a1/new.pdf') then
    raise exception 'FAIL 2f: the office manager could upload to another agent''s listing';
  end if;
  update public.pm_properties set address = 'Changed' where id = pq;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2g: the office manager changed another manager''s property'; end if;
  reset role;

  -- 3. Nobody else gains anything: another agent, another office's manager.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.properties where id = pa;
  if n <> 0 then raise exception 'FAIL 3: another agent saw a''s listing'; end if;
  select count(*) into n from public.complaints;
  if n <> 0 then raise exception 'FAIL 3b: an agent saw complaints'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', y, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.properties where id = pa;
  if n <> 0 then raise exception 'FAIL 3c: another office''s manager saw the listing'; end if;
  select count(*) into n from public.pm_properties where id = pq;
  if n <> 0 then raise exception 'FAIL 3d: another office''s manager saw the property'; end if;
  reset role;

  -- 4. Gifts: the office manager records and edits notes, but can't mark one reviewed.
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.gifts set notes = 'Asked the agent about it (made up)' where id = g1;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 4: the office manager couldn''t add a note to a gift'; end if;
  begin
    update public.gifts set status = 'reviewed' where id = g1;
    raise exception 'FAIL 4b: the office manager marked a gift reviewed';
  exception when insufficient_privilege then null;
  end;
  update public.gifts set reviewed_by = m, reviewed_at = '2001-01-01' where id = g1;
  reset role;
  select reviewed_by, reviewed_at into r from public.gifts where id = g1;
  if r.reviewed_by is not null or r.reviewed_at is not null then
    raise exception 'FAIL 4c: who reviewed it was taken from the caller';
  end if;

  -- 5. The licensee marks it reviewed: who and when are the database's.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.gifts set status = 'reviewed', reviewed_by = a, reviewed_at = '2001-01-01' where id = g1;
  reset role;
  select reviewed_by, reviewed_by_name, reviewed_at into r from public.gifts where id = g1;
  if r.reviewed_by <> l or r.reviewed_by_name <> 'Lee Licensee' or r.reviewed_at < now() - interval '1 minute' then
    raise exception 'FAIL 5: the review was recorded as %', row_to_json(r);
  end if;
  -- A review from before 0108 stays as it was.
  select reviewed_by, reviewed_at into r from public.gifts where id = g0;
  if r.reviewed_by is not null or r.reviewed_at is not null then
    raise exception 'FAIL 5b: an earlier review was given a name';
  end if;

  -- 6. Complaints: the office manager marks Under review, then Resolved; who and when recorded.
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.complaints set status = 'under_review' where id = c1;
  update public.complaints set status = 'resolved', resolved_by = l where id = c1;
  select status, under_review_by, under_review_by_name, resolved_by, resolved_by_name, resolved_at, resolved_date
    into r from public.complaints where id = c1;
  if r.status <> 'resolved' or r.under_review_by <> m or r.under_review_by_name <> 'Max Manager'
     or r.resolved_by <> m or r.resolved_at is null or r.resolved_date is null then
    raise exception 'FAIL 6: the complaint was recorded as %', row_to_json(r);
  end if;
  -- ...but can't take it back out of Resolved, sign it off, or edit it.
  begin
    update public.complaints set status = 'open' where id = c1;
    raise exception 'FAIL 6b: the office manager reopened a resolved complaint';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.sign_off_complaint(c1);
    raise exception 'FAIL 6c: the office manager signed off a complaint';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.complaints set complainant = 'Changed' where id = c1;
    raise exception 'FAIL 6d: the office manager edited a complaint';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 7. The licensee signs it off; then its status no longer changes.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.complaints set signed_off_by = m, signed_off_at = '2001-01-01' where id = c1;
  select signed_off_at into t from public.complaints where id = c1;
  if t is not null then raise exception 'FAIL 7: a sign-off was written directly'; end if;
  t := public.sign_off_complaint(c1);
  select signed_off_by, signed_off_name, signed_off_at, resolved_by into r from public.complaints where id = c1;
  if r.signed_off_by <> l or r.signed_off_name <> 'Lee Licensee' or r.signed_off_at <> t then
    raise exception 'FAIL 7b: the sign-off was recorded as %', row_to_json(r);
  end if;
  begin
    update public.complaints set status = 'under_review' where id = c1;
    raise exception 'FAIL 7c: a signed-off complaint was reopened';
  exception when raise_exception then
    if sqlerrm not like 'This complaint is signed off%' then raise; end if;
  end;
  -- Signing off needs it resolved.
  begin
    perform public.sign_off_complaint(c2);
    raise exception 'FAIL 7f: an open complaint was signed off';
  exception when raise_exception then
    if sqlerrm not like 'Mark the complaint Resolved first%' then raise; end if;
  end;
  -- A complaint resolved before 0108 is signed off like any other.
  perform public.sign_off_complaint(c0);
  reset role;
  -- A complaint resolved before 0108 kept no names, and the licensee's
  -- sign-off of it (above) is recorded.
  select resolved_by, signed_off_by into r from public.complaints where id = c0;
  if r.resolved_by is not null then raise exception 'FAIL 7d: an earlier resolution was given a name'; end if;
  if r.signed_off_by is distinct from l then raise exception 'FAIL 7e: the earlier complaint''s sign-off wasn''t recorded'; end if;

  raise notice 'Office manager reads and reviews: all checks passed';
end $$;

rollback;
