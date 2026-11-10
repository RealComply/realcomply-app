-- ===== READ ONLY. Supervision guidelines annual review, 10 November 2026 =====
--
-- Proves supabase/migrations/0126_sg_annual_review.sql. Run after it. Safe on
-- the live database: everything happens inside one transaction that is
-- rolled back at the end, so the made-up offices, people and documents it
-- creates never exist outside it.
--
-- Pass: the last line says "SG annual review: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1  uuid := gen_random_uuid();  -- the office
  o2  uuid := gen_random_uuid();  -- another office
  lic uuid := gen_random_uuid();  -- o1's licensee in charge
  ag  uuid := gen_random_uuid();  -- o1's agent
  om  uuid := gen_random_uuid();  -- o1's office manager
  x   uuid := gen_random_uuid();  -- o2's licensee
  d1  uuid;
  d2  uuid;
  r1  uuid;
  r2  uuid;
  n   integer;
  r   record;
begin
  insert into auth.users (id, email) values
    (lic, 'sgr-lic@example.invalid'), (ag, 'sgr-ag@example.invalid'),
    (om, 'sgr-om@example.invalid'), (x, 'sgr-x@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'SG Review Office (made up)', 'office_1', 'active', 'Lou Licensee', 'sgr-lou@example.invalid'),
    (o2, 'Other SG Review Office (made up)', 'office_1', 'active', 'Xan Licensee', 'sgr-xan@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (lic, o1, 'Lou Licensee', 'sgr-lic@example.invalid', true, true, false),
    (ag, o1, 'Ana Agent', 'sgr-ag@example.invalid', true, false, false),
    (om, o1, 'Max Manager', 'sgr-om@example.invalid', false, false, false),
    (x, o2, 'Xan Licensee', 'sgr-x@example.invalid', true, true, false);
  insert into public.office_managers (agency_id, profile_id, wording, approved_via, approved_by, approved_by_name)
  values (o1, om, 'Max Manager is an office manager (made up wording).', 'team', lic, 'Lou Licensee');

  insert into public.sg_documents (agency_id, file_path, file_name, status, doc_type, version_label, saved_at, saved_by_name)
  values (o1, o1::text || '/_sg-manual/1-manual.pdf', 'Manual v7.3.pdf', 'live', 'sg_and_procedures', 'v7.3', now() - interval '300 days', 'Lou Licensee')
  returning id into d1;
  insert into public.sg_documents (agency_id, file_path, file_name, status, doc_type, version_label, saved_at)
  values (o1, o1::text || '/_sg-manual/0-old.pdf', 'Old.pdf', 'replaced', 'sg', 'v7.2', now() - interval '700 days')
  returning id into d2;

  -- 1. The licensee marks it reviewed, with a note: kept as plain text, named.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r1 := public.record_sg_review(d1, E'  Reviewed with Max\n after the trust audit.  ');
  reset role;
  select * into r from public.sg_reviews where id = r1;
  if r.agency_id <> o1 or r.document_id <> d1 or r.reviewed_by <> lic or r.reviewed_by_name <> 'Lou Licensee'
     or r.reviewed_as <> 'licensee' or r.note <> 'Reviewed with Max  after the trust audit.' then
    raise exception 'FAIL 1a: the review is %', row_to_json(r); end if;

  -- 2. Once a day: the office manager the same day is told it's done.
  perform set_config('request.jwt.claims', json_build_object('sub', om, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.record_sg_review(d1, null);
    raise exception 'FAIL 2a: reviewed twice in a day';
  exception when raise_exception then
    if sqlerrm <> 'The supervision guidelines were already marked reviewed today.' then raise; end if;
  end;
  reset role;
  -- The next day it can be recorded again, as office manager, with no note.
  update public.sg_reviews set reviewed_at = reviewed_at - interval '1 day' where id = r1;
  set local role authenticated;
  r2 := public.record_sg_review(d1, '   ');
  reset role;
  select * into r from public.sg_reviews where id = r2;
  if r.reviewed_as <> 'office_manager' or r.note is not null or r.reviewed_by_name <> 'Max Manager' then
    raise exception 'FAIL 2b: the office manager''s review is %', row_to_json(r); end if;

  -- 3. Not on a document that isn't live; not a note over 1,000 characters.
  update public.sg_reviews set reviewed_at = reviewed_at - interval '2 days' where document_id = d1;
  set local role authenticated;
  begin
    perform public.record_sg_review(d2, null);
    raise exception 'FAIL 3a: a replaced document was reviewed';
  exception when raise_exception then
    if sqlerrm not like 'That isn''t the office''s current document.%' then raise; end if;
  end;
  begin
    perform public.record_sg_review(d1, repeat('a', 1001));
    raise exception 'FAIL 3b: a long note was kept';
  exception when raise_exception then
    if sqlerrm <> 'Keep the note to 1,000 characters.' then raise; end if;
  end;
  reset role;

  -- 4. An agent (not running the office) can't record it, but reads the reviews.
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.record_sg_review(d1, null);
    raise exception 'FAIL 4a: an agent recorded the review';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from public.sg_reviews;
  if n <> 2 then raise exception 'FAIL 4b: the agent sees % reviews, not 2', n; end if;
  select count(*) into n from public.sg_review_reminders;
  if n <> 0 then raise exception 'FAIL 4c: the agent sees reminders'; end if;
  reset role;

  -- 5. Another office sees nothing and can't review o1's document.
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.sg_reviews;
  if n <> 0 then raise exception 'FAIL 5a: another office sees % reviews', n; end if;
  begin
    perform public.record_sg_review(d1, null);
    raise exception 'FAIL 5b: another office reviewed it';
  exception when raise_exception then
    if sqlerrm not like 'That isn''t the office''s current document.%' then raise; end if;
  end;
  reset role;

  -- 6. The daily job's reminders: never twice for the same person, date and step.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  insert into public.sg_review_reminders (agency_id, profile_id, due_on, days_before) values (o1, lic, date '2027-08-14', 30);
  begin
    insert into public.sg_review_reminders (agency_id, profile_id, due_on, days_before) values (o1, lic, date '2027-08-14', 30);
    raise exception 'FAIL 6a: the same reminder was recorded twice';
  exception when unique_violation then null;
  end;
  begin
    insert into public.sg_review_reminders (agency_id, profile_id, due_on, days_before) values (o1, om, date '2027-08-14', 45);
    raise exception 'FAIL 6b: a 45-day reminder was recorded';
  exception when check_violation then null;
  end;
  insert into public.sg_review_reminders (agency_id, profile_id, due_on, days_before) values (o1, om, date '2027-08-14', 30);

  -- 7. Whoever runs the office reads the office's reminders; nobody signed in writes them.
  perform set_config('request.jwt.claims', json_build_object('sub', om, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.sg_review_reminders;
  if n <> 2 then raise exception 'FAIL 7a: the office manager sees % reminders, not 2', n; end if;
  begin
    insert into public.sg_review_reminders (agency_id, profile_id, due_on, days_before) values (o1, om, date '2027-08-14', 14);
    raise exception 'FAIL 7b: a signed-in person wrote a reminder';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.sg_reviews (agency_id, document_id, reviewed_as) values (o1, d1, 'licensee');
    raise exception 'FAIL 7c: a review was written directly';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.sg_reviews where id = r1;
    raise exception 'FAIL 7d: a review was deleted';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    perform count(*) from public.sg_reviews;
    raise exception 'FAIL 7e: signed out read the reviews';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 8. Staff reminders now take a change still to sign (0093's claim, unchanged).
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.claim_staff_reminder(ag, array['sg_change_sign']) is null then
    raise exception 'FAIL 8a: a change reminder wasn''t claimed'; end if;
  reset role;
  begin
    insert into public.staff_reminders (agency_id, profile_id, kinds) values (o1, om, array['sg_made_up']);
    raise exception 'FAIL 8b: a made-up reminder kind was kept';
  exception when check_violation then null;
  end;

  -- 9. Once the office's subscription has ended, no review.
  perform set_config('request.jwt.claims', '', true);
  update public.agencies set status = 'canceled', ended_at = now() where id = o1;
  if not public.agency_has_ended(o1) then raise exception 'FAIL 9 setup: the office didn''t end'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.record_sg_review(d1, null);
    raise exception 'FAIL 9: an ended office recorded a review';
  exception when raise_exception then
    if sqlerrm <> 'This office''s subscription has ended.' then raise; end if;
  end;
  reset role;

  raise notice 'SG annual review: all checks passed';
end $$;

rollback;
