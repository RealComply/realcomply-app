-- ===== READ ONLY. Licensee in charge history test, 16 October 2026 =====
--
-- Proves supabase/migrations/0080_licensee_in_charge_history.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up offices and people it creates
-- never exist outside it.
--
-- Pass: the last line says "Licensee in charge history: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  ag uuid := gen_random_uuid();      -- an office
  ag2 uuid := gen_random_uuid();     -- another office
  ag3 uuid := gen_random_uuid();     -- an agent on their own plan
  lic uuid := gen_random_uuid();     -- the office's licensee in charge (set the office up)
  pat uuid := gen_random_uuid();     -- an agent with a class 1 licence
  sam uuid := gen_random_uuid();     -- an agent with a class 2 licence
  asst uuid := gen_random_uuid();    -- an assistant agent
  lic2 uuid := gen_random_uuid();    -- the other office's licensee
  solo uuid := gen_random_uuid();    -- the agent on their own plan
  prop uuid := gen_random_uuid();    -- an existing listing
  doc uuid := gen_random_uuid();     -- a licensee-only document waiting on lic
  link_token uuid;
  r jsonb;
  n integer;
  h record;
  ok boolean;
begin
  insert into auth.users (id, email) values
    (lic, 'lh-lic@example.invalid'), (pat, 'lh-pat@example.invalid'), (sam, 'lh-sam@example.invalid'),
    (asst, 'lh-asst@example.invalid'), (lic2, 'lh-lic2@example.invalid'), (solo, 'lh-solo@example.invalid');
  insert into public.agencies (id, name, plan, status) values
    (ag, 'LH Property (made up)', 'office_1', 'active'),
    (ag2, 'LH Other Property (made up)', 'office_1', 'active'),
    (ag3, 'LH Solo Agent (made up)', 'agent_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent,
                               licence_type, licence_number, created_at) values
    (lic, ag, 'LH Licensee', 'lh-lic@example.invalid', true, false, true, 'class_1', '20100001', now() - interval '2 days'),
    (pat, ag, 'LH Pat', 'lh-pat@example.invalid', false, false, true, 'class_1', '20100002', now() - interval '1 day'),
    (sam, ag, 'LH Sam', 'lh-sam@example.invalid', false, false, true, 'class_2', '20100003', now() - interval '1 day'),
    (asst, ag, 'LH Assistant', 'lh-asst@example.invalid', false, true, false, 'class_1', '20100004', now() - interval '1 day'),
    (lic2, ag2, 'LH Other Licensee', 'lh-lic2@example.invalid', true, false, true, 'class_1', '20100005', now()),
    (solo, ag3, 'LH Solo', 'lh-solo@example.invalid', true, false, true, 'class_1', '20100006', now());

  -- 1. An office's first licensee in charge gets a line, dates blank. An
  --    agent on their own plan gets none.
  select count(*) into n from public.licensee_in_charge_history where agency_id = ag;
  if n <> 1 then raise exception 'FAIL 1: % lines for the office, expected 1', n; end if;
  select * into h from public.licensee_in_charge_history where agency_id = ag;
  if h.source <> 'first' or h.profile_id <> lic or h.started_on is not null or h.ended_at is not null
     or h.licensee_name <> 'LH Licensee' or h.licence_number <> '20100001' then
    raise exception 'FAIL 1: the first line is wrong (%, %, %)', h.source, h.started_on, h.licensee_name;
  end if;
  select count(*) into n from public.licensee_in_charge_history where agency_id = ag3;
  if n <> 0 then raise exception 'FAIL 1: an agent on their own plan got % lines', n; end if;

  -- 2. Everyone in the office can read it; another office can't.
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.licensee_in_charge_history;
  reset role;
  if n <> 1 then raise exception 'FAIL 2: an agent in the office sees % lines, expected 1', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', lic2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.licensee_in_charge_history where agency_id = ag;
  reset role;
  if n <> 0 then raise exception 'FAIL 2: another office sees % lines', n; end if;

  -- 3. Nobody writes or deletes a line directly, not even the licensee.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.licensee_in_charge_history (agency_id, licensee_name, source) values (ag, 'Made up', 'change');
    reset role;
    raise exception 'FAIL 3: the licensee added a line directly';
  exception when insufficient_privilege then
    reset role;
  end;
  begin
    set local role authenticated;
    update public.licensee_in_charge_history set licensee_name = 'Someone else' where agency_id = ag;
    reset role;
    raise exception 'FAIL 3: the licensee changed a line directly';
  exception when insufficient_privilege then
    reset role;
  end;
  begin
    set local role authenticated;
    delete from public.licensee_in_charge_history where agency_id = ag;
    reset role;
    raise exception 'FAIL 3: the licensee deleted a line';
  exception when insufficient_privilege then
    reset role;
  end;

  -- Things that hang off the role, before the change: an existing listing, a
  -- licensee-only document waiting on lic, an emailed link, an annexure link
  -- not yet used, and lic's adoption of the annexure.
  insert into public.properties (id, agency_id, created_by, address) values (prop, ag, pat, '1 Made Up Street (made up)');
  insert into public.signoff_documents (id, agency_id, category, title, file_path, file_name, signer_scope)
  values (doc, ag, 'trust_reconciliation', 'Made-up reconciliation', ag::text || '/_signoffs/x.pdf', 'x.pdf', 'licensee_only');
  insert into public.signoff_signatures (agency_id, document_id, signer_id) values (ag, doc, lic);
  insert into public.property_signoff_requests (agency_id, property_id, sent_to, statement)
  values (ag, prop, 'lh-lic@example.invalid', 'Made-up statement');
  insert into public.sg_annexure_links (agency_id, sent_to, created_by) values (ag, 'lh-lic@example.invalid', lic);
  insert into public.sg_annexure_adoptions (agency_id, annexure_version, signed_name, licence_number, sent_to)
  values (ag, '1.0', 'LH Licensee', '20100001', 'lh-lic@example.invalid');

  -- Before the change, lic set the office up and is its account holder.
  set local role authenticated;
  select public.is_account_holder() into ok;
  reset role;
  if not ok then raise exception 'FAIL 4: the person who set the office up is not its account holder before a change'; end if;

  -- 5. Who can change it, and to whom.
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.change_licensee_in_charge(pat, public.sydney_today(), null);
    reset role;
    raise exception 'FAIL 5: an agent changed the licensee in charge';
  exception when raise_exception then
    reset role;
    if sqlerrm not like 'Only the licensee in charge%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.change_licensee_in_charge(sam, public.sydney_today(), null);
    reset role;
    raise exception 'FAIL 5: a class 2 licence holder was made licensee in charge';
  exception when raise_exception then
    reset role;
    if sqlerrm not like 'Only someone with a class 1 licence%' then raise; end if;
  end;
  begin
    set local role authenticated;
    perform public.change_licensee_in_charge(asst, public.sydney_today(), null);
    reset role;
    raise exception 'FAIL 5: an assistant was made licensee in charge';
  exception when raise_exception then
    reset role;
    if sqlerrm not like 'An assistant agent%' then raise; end if;
  end;
  begin
    set local role authenticated;
    perform public.change_licensee_in_charge(lic2, public.sydney_today(), null);
    reset role;
    raise exception 'FAIL 5: someone from another office was made licensee in charge';
  exception when raise_exception then
    reset role;
    if sqlerrm not like 'Choose someone on your team%' then raise; end if;
  end;
  begin
    set local role authenticated;
    perform public.change_licensee_in_charge(pat, public.sydney_today() + 1, null);
    reset role;
    raise exception 'FAIL 5: a change dated in the future was saved';
  exception when raise_exception then
    reset role;
    if sqlerrm not like '%can''t be in the future%' then raise; end if;
  end;

  -- 6. The change: Pat takes over from two days ago, Fair Trading not told yet.
  set local role authenticated;
  r := public.change_licensee_in_charge(pat, public.sydney_today() - 2, null);
  reset role;
  select is_licensee_in_charge into ok from public.profiles where id = pat;
  if not ok then raise exception 'FAIL 6: Pat is not licensee in charge'; end if;
  select (not is_licensee_in_charge) and is_agent and archived_at is null into ok from public.profiles where id = lic;
  if not ok then raise exception 'FAIL 6: the previous licensee is not an agent on the team'; end if;
  select * into h from public.licensee_in_charge_history where agency_id = ag and profile_id = pat;
  if h.source <> 'change' or h.started_on <> public.sydney_today() - 2 or h.fair_trading_told_on is not null
     or h.ended_at is not null or h.recorded_by <> lic then
    raise exception 'FAIL 6: Pat''s line is wrong (%, %, %, %)', h.source, h.started_on, h.fair_trading_told_on, h.recorded_by;
  end if;
  select * into h from public.licensee_in_charge_history where agency_id = ag and profile_id = lic;
  if h.ended_on <> public.sydney_today() - 3 or h.ended_at is null or h.ended_by <> lic then
    raise exception 'FAIL 6: the previous licensee''s line was not closed the day before (%)', h.ended_on;
  end if;

  -- 7. What moved with the role.
  select (licensee_name = 'LH Pat' and licensee_email = 'lh-pat@example.invalid') into ok from public.agencies where id = ag;
  if not ok then raise exception 'FAIL 7: the office''s licensee details are not Pat''s'; end if;
  select count(*) into n from public.property_signoff_requests where agency_id = ag and revoked_at is null and signed_at is null;
  if n <> 0 then raise exception 'FAIL 7: % emailed links are still out with the previous licensee', n; end if;
  select count(*) into n from public.sg_annexure_links where agency_id = ag and used_at is null and expires_at > now();
  if n <> 0 then raise exception 'FAIL 7: % annexure links are still open', n; end if;
  select count(*) into n from public.signoff_signatures where document_id = doc and signer_id = pat and signed_at is null;
  if n <> 1 then raise exception 'FAIL 7: the document waiting on the previous licensee does not wait on Pat'; end if;
  select count(*) into n from public.signoff_signatures where document_id = doc and signer_id = lic;
  if n <> 0 then raise exception 'FAIL 7: the previous licensee still has a slot on a licensee-only document'; end if;
  if (r ->> 'links_withdrawn')::int <> 1 or (r ->> 'documents_moved')::int <> 1 then
    raise exception 'FAIL 7: the change reported %', r;
  end if;

  -- 8. Billing follows the role: the person who set the office up is no
  --    longer its account holder; Pat acts as licensee.
  set local role authenticated;
  select public.is_account_holder() or public.acts_as_licensee() into ok;
  reset role;
  if ok then raise exception 'FAIL 8: the previous licensee still has Billing or the licensee''s access'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.acts_as_licensee() and public.is_office_licensee() into ok;
  reset role;
  if not ok then raise exception 'FAIL 8: Pat does not have the licensee''s access'; end if;

  -- 9. No new listing until Pat adopts the annexure; existing ones carry on.
  begin
    set local role authenticated;
    insert into public.properties (agency_id, created_by, address) values (ag, pat, '2 Made Up Street (made up)');
    reset role;
    raise exception 'FAIL 9: a new listing was added before the new licensee adopted the annexure';
  exception when check_violation then
    reset role;
    if sqlerrm not like 'New listings can be added once your licensee in charge has adopted%' then raise; end if;
  end;
  set local role authenticated;
  update public.properties set address = '1 Made Up Street, Sydney (made up)' where id = prop;
  get diagnostics n = row_count;
  reset role;
  if n <> 1 then raise exception 'FAIL 9: the existing listing could not be worked on'; end if;
  set local role authenticated;
  select annexure_pending into ok from public.my_licensee_change_status();
  reset role;
  if not ok then raise exception 'FAIL 9: the office is not shown as waiting on the new licensee'; end if;

  -- Pat adopts, from their own link.
  set local role authenticated;
  link_token := public.create_sg_annexure_link();
  reset role;
  perform public.adopt_sg_annexure(link_token, '1.0', 'LH Pat', '20100002', null::text);
  -- This whole test is one transaction, so the adoption is stamped with the
  -- transaction's start, before the change. In use they are moments apart:
  -- give the adoption the moment it actually happened.
  update public.sg_annexure_adoptions set signed_at = clock_timestamp()
   where agency_id = ag and signed_name = 'LH Pat';
  select count(*) into n from public.sg_annexure_adoptions where agency_id = ag;
  if n <> 2 then raise exception 'FAIL 9: % adoptions on file, expected the earlier one and Pat''s', n; end if;
  set local role authenticated;
  insert into public.properties (agency_id, created_by, address) values (ag, pat, '2 Made Up Street (made up)');
  select annexure_pending into ok from public.my_licensee_change_status();
  reset role;
  if ok then raise exception 'FAIL 9: still waiting after Pat adopted'; end if;

  -- 10. Fair Trading told: recorded once, by the licensee, stamped.
  select id into h from public.licensee_in_charge_history where agency_id = ag and profile_id = pat;
  set local role authenticated;
  perform public.record_licensee_history_date(h.id, 'fair_trading', public.sydney_today() - 1);
  reset role;
  select * into h from public.licensee_in_charge_history where agency_id = ag and profile_id = pat;
  if h.fair_trading_told_on <> public.sydney_today() - 1 or h.fair_trading_recorded_by <> pat or h.fair_trading_recorded_at is null then
    raise exception 'FAIL 10: the Fair Trading date was not recorded and stamped';
  end if;
  begin
    set local role authenticated;
    perform public.record_licensee_history_date(h.id, 'fair_trading', public.sydney_today());
    reset role;
    raise exception 'FAIL 10: the Fair Trading date was changed once recorded';
  exception when raise_exception then
    reset role;
    if sqlerrm not like '%already recorded%' then raise; end if;
  end;
  -- The backfilled-style line (lic's, start blank) takes a start date.
  select id into h from public.licensee_in_charge_history where agency_id = ag and profile_id = lic;
  set local role authenticated;
  perform public.record_licensee_history_date(h.id, 'started', public.sydney_today() - 400);
  reset role;
  select started_on into h from public.licensee_in_charge_history where agency_id = ag and profile_id = lic;
  if h.started_on <> public.sydney_today() - 400 then raise exception 'FAIL 10: the start date was not filled in'; end if;
  -- The previous licensee, now an agent, can't record anything.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.record_licensee_history_date(gen_random_uuid(), 'started', public.sydney_today());
    reset role;
    raise exception 'FAIL 10: an agent recorded a date';
  exception when raise_exception then
    reset role;
    if sqlerrm not like 'Only the licensee in charge%' then raise; end if;
  end;
  begin
    set local role authenticated;
    perform public.change_licensee_in_charge(lic, public.sydney_today(), null);
    reset role;
    raise exception 'FAIL 10: the previous licensee could still change the licensee in charge';
  exception when raise_exception then
    reset role;
    if sqlerrm not like 'Only the licensee in charge%' then raise; end if;
  end;

  -- 11. Even the database's owner can't rewrite a line.
  begin
    update public.licensee_in_charge_history set licensee_name = 'Rewritten' where agency_id = ag and profile_id = pat;
    raise exception 'FAIL 11: a line was rewritten';
  exception when raise_exception then
    if sqlerrm not like '%can''t be changed%' then raise; end if;
  end;

  -- 12. The role given another way is recorded too ('team'), dated today.
  perform set_config('request.jwt.claims', json_build_object('sub', pat, 'role', 'authenticated')::text, true);
  update public.profiles set licence_type = 'class_1' where id = sam;
  set local role authenticated;
  update public.profiles set is_licensee_in_charge = true where id = sam;
  reset role;
  select * into h from public.licensee_in_charge_history where agency_id = ag and profile_id = sam;
  if h.source <> 'team' or h.started_on <> public.sydney_today() or h.recorded_by <> pat then
    raise exception 'FAIL 12: a role given on Team was not recorded (%)', h.source;
  end if;

  -- 13. The whole office can still be deleted (end of subscription).
  perform set_config('request.jwt.claims', '', true);
  delete from public.agencies where id = ag;
  select count(*) into n from public.licensee_in_charge_history where agency_id = ag;
  if n <> 0 then raise exception 'FAIL 13: % history lines left after the office was deleted', n; end if;
end $$;

select 'Licensee in charge history: all checks passed' as result;

rollback;
