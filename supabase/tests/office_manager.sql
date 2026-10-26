-- ===== READ ONLY. Office manager, approved by the licensee in charge, 26 October 2026 =====
--
-- Proves supabase/migrations/0093_office_manager.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up offices and people it creates
-- never exist outside it.
--
-- Pass: the last line says "Office manager: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  -- Office 1: the licensee in charge has no login (approval by email link).
  o1 uuid := gen_random_uuid();
  f  uuid := gen_random_uuid();   -- signed up, answered "No"; asks to be office manager
  a  uuid := gen_random_uuid();   -- another agent in office 1
  -- Office 2: the licensee in charge has a login (approval in Team).
  o2 uuid := gen_random_uuid();
  l  uuid := gen_random_uuid();   -- licensee in charge of office 2
  b  uuid := gen_random_uuid();   -- agent in office 2
  c  uuid := gen_random_uuid();   -- another agent in office 2
  -- Office 3: an agent on their own plan.
  o3 uuid := gen_random_uuid();
  s  uuid := gen_random_uuid();
  req uuid;
  req2 uuid;
  tok uuid;
  wtok uuid;
  n integer;
  b_ok boolean;
  t text;
  r record;
begin
  insert into auth.users (id, email) values
    (f, 'om-f@example.invalid'), (a, 'om-a@example.invalid'), (l, 'om-l@example.invalid'),
    (b, 'om-b@example.invalid'), (c, 'om-c@example.invalid'), (s, 'om-s@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'OM Office One ', 'office_1', 'active', 'Jordan Made-Up', 'om-jordan@example.invalid'),
    (o2, 'OM Office Two', 'office_1', 'active', null, null),
    (o3, 'OM Own Plan', 'agent_1', 'active', 'Pat Made-Up', 'om-pat@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant, created_at) values
    (f, o1, 'Sam Founder', 'om-f@example.invalid', true, false, false, now() - interval '2 days'),
    (a, o1, 'Alex Agent', 'om-a@example.invalid', true, false, false, now() - interval '1 day'),
    (l, o2, 'Lee Licensee', 'om-l@example.invalid', true, true, false, now() - interval '2 days'),
    (b, o2, 'Bo Agent', 'om-b@example.invalid', true, false, false, now() - interval '1 day'),
    (c, o2, 'Cy Agent', 'om-c@example.invalid', true, false, false, now()),
    (s, o3, 'Sol Solo', 'om-s@example.invalid', true, false, false, now());
  insert into public.cpd_records (agency_id, profile_id, activity_name) values (o1, a, 'Alex''s CPD');
  insert into public.properties (agency_id, created_by, address) values (o1, a, '1 Alex Street');

  -- 0. 0092 is undone: no marker, and the founder of a "No" office does not
  --    act as the licensee.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'agencies' and column_name = 'licensee_not_on_realcomply') then
    raise exception 'FAIL 0: 0092''s marker is still there';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.acts_as_licensee() or public.runs_office() then
    raise exception 'FAIL 0b: the founder runs the office without approval';
  end if;

  -- 1. Before approval: none of the office side.
  begin
    insert into public.trust_accounts (agency_id, name) values (o1, 'Not yet');
    raise exception 'FAIL 1: added a trust account before approval';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from public.cpd_records where profile_id = a;
  if n <> 0 then raise exception 'FAIL 1b: saw another agent''s CPD before approval'; end if;

  -- 2. Asking: one open request, and the token is never readable.
  req := public.request_office_manager();
  if req is null then raise exception 'FAIL 2: no request made'; end if;
  if public.request_office_manager() <> req then raise exception 'FAIL 2b: asking again made a second request'; end if;
  begin
    select token into tok from public.office_manager_requests where id = req;
    raise exception 'FAIL 2c: the person asking read the token';
  exception when insufficient_privilege then null;
  end;
  select wording into t from public.office_manager_requests where id = req;
  if t <> 'I authorise Sam Founder to manage OM Office One''s RealComply account as office manager.' then
    raise exception 'FAIL 2d: wording was "%"', t;
  end if;
  perform public.record_office_manager_request_email(req, true);
  select email_attempts into n from public.office_manager_requests where id = req;
  if n <> 1 then raise exception 'FAIL 2e: the send was not recorded'; end if;

  -- 3. Not to an inbox in the office: a licensee email that is a member's login is refused.
  reset role;
  perform set_config('request.jwt.claims', '', true);
  update public.agencies set licensee_email = 'om-a@example.invalid' where id = o1;
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.request_office_manager();
    raise exception 'FAIL 3: asked with the licensee email pointing at a member''s login';
  exception when raise_exception then
    if sqlerrm not like 'The licensee''s email on file is the login%' then raise; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  update public.agencies set licensee_email = 'om-jordan@example.invalid' where id = o1;

  -- 4. The licensee approves by link, without a login.
  select token into tok from public.office_manager_requests where id = req;
  set local role anon;
  select * into r from public.office_manager_request_details(tok);
  if r.person_name <> 'Sam Founder' or r.office_name <> 'OM Office One' then
    raise exception 'FAIL 4: the page details were wrong (%)', r;
  end if;
  if public.approve_office_manager(tok, '   ') then raise exception 'FAIL 4b: approved with no name'; end if;
  if not public.approve_office_manager(tok, 'Jordan Made-Up') then raise exception 'FAIL 4c: approval refused'; end if;
  if public.approve_office_manager(tok, 'Jordan Made-Up') then raise exception 'FAIL 4d: the link worked twice'; end if;
  select count(*) into n from public.office_manager_request_details(tok);
  if n <> 0 then raise exception 'FAIL 4e: a used link still shows'; end if;
  reset role;
  select * into r from public.office_managers where profile_id = f and withdrawn_at is null;
  if r.approved_via <> 'email_link' or r.approved_by_name <> 'Jordan Made-Up'
     or r.wording <> 'I authorise Sam Founder to manage OM Office One''s RealComply account as office manager.' then
    raise exception 'FAIL 4f: the record was wrong (%)', r;
  end if;
  wtok := r.withdraw_token;

  -- 5. Office manager: the office side, not the licensee's.
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.is_office_manager() or not public.runs_office() then raise exception 'FAIL 5: not office manager after approval'; end if;
  if public.acts_as_licensee() then raise exception 'FAIL 5b: an office manager acts as the licensee'; end if;
  insert into public.trust_accounts (agency_id, name) values (o1, 'Main trust');
  select count(*) into n from public.cpd_records where profile_id = a;
  if n <> 1 then raise exception 'FAIL 5c: could not see the office''s CPD records'; end if;
  update public.agencies set website_url = 'https://example.invalid/listings' where id = o1;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 5d: could not update the office profile'; end if;
  -- (The licensee's email: this founder is also the account holder of an
  -- office with no licensee in charge, who may change it since 0066. An
  -- office manager who isn't is checked in step 8.)
  begin
    update public.agencies set complaint_resolution_target_days = 99 where id = o1;
    raise exception 'FAIL 5f: changed the complaints target';
  exception when check_violation then null;
  end;
  delete from public.cpd_records where profile_id = a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 5g: an office manager deleted a compliance record'; end if;
  select count(*) into n from public.properties where agency_id = o1;
  if n <> 0 then raise exception 'FAIL 5h: saw another agent''s listing (not decided yet)'; end if;
  begin
    update public.profiles set is_licensee_in_charge = true where id = a;
    raise exception 'FAIL 5i: an office manager made someone licensee in charge';
  exception when raise_exception then
    if sqlerrm not like 'Only the licensee in charge can change roles%' then raise; end if;
  end;
  -- Since 0095 (Adam, 26 Oct 2026) an office manager may invite the
  -- licensee in charge named in Office profile, and no one else: whatever
  -- the form says, the invite goes to the licensee's recorded address.
  -- (Was 0093: an office manager couldn't invite a licensee in charge.)
  if to_regprocedure('public.guard_agency_invite_roles()') is null then
    begin
      insert into public.agency_invites (agency_id, email, full_name, is_licensee_in_charge, invited_by)
      values (o1, 'om-new-lic@example.invalid', 'New Licensee', true, f);
      raise exception 'FAIL 5j: an office manager invited a licensee in charge';
    exception when insufficient_privilege then null;
    end;
  else
    insert into public.agency_invites (agency_id, email, full_name, is_licensee_in_charge, invited_by)
    values (o1, 'om-new-lic@example.invalid', 'New Licensee', true, f)
    returning email into t;
    if t <> 'om-jordan@example.invalid' then
      raise exception 'FAIL 5j: an office manager invited a licensee in charge at %', t;
    end if;
    update public.agency_invites set status = 'revoked' where email = t and agency_id = o1;
  end if;
  insert into public.agency_invites (agency_id, email, full_name, is_licensee_in_charge, invited_by)
  values (o1, 'om-new-agent@example.invalid', 'New Agent', false, f);
  begin
    perform public.grant_office_manager(a);
    raise exception 'FAIL 5k: an office manager made someone else office manager';
  exception when insufficient_privilege then null;
  end;

  -- 6. Withdrawn by the link in the licensee's confirmation email.
  set local role anon;
  select count(*) into n from public.office_manager_withdraw_details(wtok);
  if n <> 1 then raise exception 'FAIL 6: the withdraw page shows nothing'; end if;
  if not public.withdraw_office_manager_by_token(wtok) then raise exception 'FAIL 6b: withdrawal refused'; end if;
  if public.withdraw_office_manager_by_token(wtok) then raise exception 'FAIL 6c: withdrawn twice'; end if;
  reset role;
  set local role authenticated;
  if public.is_office_manager() then raise exception 'FAIL 6d: still office manager after withdrawal'; end if;
  reset role;
  select * into r from public.office_managers where profile_id = f;
  if r.withdrawn_via <> 'email_link' or r.withdrawn_by_name <> 'Jordan Made-Up' then
    raise exception 'FAIL 6e: the withdrawal was not recorded (%)', r;
  end if;

  -- 7. A licensee with a login: in Team, not by link.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.request_office_manager();
    raise exception 'FAIL 7: asked by link with a licensee on RealComply';
  exception when raise_exception then
    if sqlerrm not like 'Your licensee in charge is on RealComply%' then raise; end if;
  end;
  begin
    perform public.grant_office_manager(c);
    raise exception 'FAIL 7b: an agent made someone office manager';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  perform public.grant_office_manager(b);
  reset role;
  select * into r from public.office_managers where profile_id = b and withdrawn_at is null;
  if r.approved_via <> 'team' or r.approved_by <> l or r.approved_by_name <> 'Lee Licensee'
     or r.wording <> 'I authorise Bo Agent to manage OM Office Two''s RealComply account as office manager.' then
    raise exception 'FAIL 7c: the Team record was wrong (%)', r;
  end if;

  -- 8. The office manager can't touch the licensee in charge's own record,
  --    but can remove an agent; leaving the office ends the role.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.agencies set licensee_email = 'om-mine@example.invalid' where id = o2;
    raise exception 'FAIL 5e: an office manager changed the licensee''s email';
  exception when check_violation then null;
  end;
  -- Office profile yes, the licensee's details no.
  perform public.set_agency_website('https://example.invalid/office-two');
  begin
    perform public.set_agency_licensee_email('om-mine@example.invalid');
    raise exception 'FAIL 5l: an office manager changed the licensee''s email through Office profile';
  exception when raise_exception then
    if sqlerrm not like 'Only the licensee in charge%' then raise; end if;
  end;
  update public.profiles set full_name = 'Renamed' where id = l;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 8: an office manager changed the licensee''s record'; end if;
  update public.profiles set archived_at = now(), archived_by = b where id = c;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 8b: an office manager could not remove an agent'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  update public.profiles set archived_at = now(), archived_by = l where id = b;
  reset role;
  select withdrawn_via into t from public.office_managers where profile_id = b;
  if t is distinct from 'left_office' then raise exception 'FAIL 8c: leaving the office did not end the role (%)', t; end if;

  -- 9. The licensee withdraws in Team.
  update public.profiles set archived_at = null, archived_by = null where id = b;
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.grant_office_manager(b);
  if not public.withdraw_office_manager(b) then raise exception 'FAIL 9: withdrawal in Team refused'; end if;
  reset role;
  select count(*) into n from public.office_managers where profile_id = b and withdrawn_at is null;
  if n <> 0 then raise exception 'FAIL 9b: still office manager after the licensee withdrew it'; end if;

  -- 11. An office plan's listing lock lifts on the licensee's signed
  --     adoption page, as on an agent plan (Adam, 26 Oct).
  update public.agencies set annexure_gate = true where id = o1;
  if public.listing_gate_reason(o1) is distinct from 'annexure' then
    raise exception 'FAIL 11: office one not waiting on the annexure (got %)', public.listing_gate_reason(o1);
  end if;
  insert into public.signoff_documents (agency_id, category, title, file_path, file_name, signer_scope, uploaded_by)
  values (o1, 'sg_annexure_licensee_signed', 'Signed SG annexure (licensee adoption)',
          o1::text || '/_signoffs/licensee-signed/1-signed.pdf', 'signed.pdf', 'licensee_only', f);
  if public.listing_gate_reason(o1) is not null then
    raise exception 'FAIL 11b: the licensee''s signed page didn''t lift the lock (got %)', public.listing_gate_reason(o1);
  end if;

  -- 12. Reminders to sign and read the Supervision Guidelines: the licensee
  --     or an office manager, at most one a day per person; an agent can't.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.claim_staff_reminder(b, array['sg_manual_sign', 'sg_read']) is null then
    raise exception 'FAIL 12: the licensee couldn''t remind an agent';
  end if;
  if public.claim_staff_reminder(b, array['sg_read']) is not null then
    raise exception 'FAIL 12b: reminded the same person twice in a day';
  end if;
  -- A reminder whose email didn't go blocks for 5 minutes only (0094)...
  reset role;
  update public.staff_reminders set created_at = now() - interval '6 minutes' where profile_id = b;
  set local role authenticated;
  if public.claim_staff_reminder(b, array['sg_read']) is null then
    raise exception 'FAIL 12f: a reminder that didn''t go blocked the next one';
  end if;
  -- ...and one that went blocks for 20 hours.
  reset role;
  update public.staff_reminders
     set email_sent_at = now() - interval '1 hour', created_at = now() - interval '1 hour'
   where profile_id = b;
  set local role authenticated;
  if public.claim_staff_reminder(b, array['sg_read']) is not null then
    raise exception 'FAIL 12g: reminded again within a day of one that went';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin
    perform public.claim_staff_reminder(l, array['sg_read']);
    raise exception 'FAIL 12c: an agent sent a reminder';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  perform public.grant_office_manager(b);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  if public.claim_staff_reminder(l, array['sg_manual_sign']) is null then
    raise exception 'FAIL 12d: an office manager couldn''t send a reminder';
  end if;
  begin
    perform public.claim_staff_reminder(b, array['sg_read']);
    raise exception 'FAIL 12e: reminded themselves';
  exception when raise_exception then null;
  end;
  -- 13. ...and sees who has read and ticked, as the licensee does.
  reset role;
  insert into public.sg_read_confirmations (agency_id, confirmed_by, annexure_version) values (o2, l, '1.0');
  set local role authenticated;
  select count(*) into n from public.sg_read_confirmations where agency_id = o2;
  if n <> 1 then raise exception 'FAIL 13: an office manager can''t see who has read and ticked'; end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- 10. Not for an agent on their own plan.
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.request_office_manager();
    raise exception 'FAIL 10: an agent on their own plan asked to be office manager';
  exception when raise_exception then
    if sqlerrm not like 'On your own plan%' then raise; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  raise notice 'Office manager: all checks passed';
end
$$;

rollback;
