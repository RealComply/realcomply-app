-- ===== READ ONLY. Stored files in their own office's folder, 20 October 2026 =====
--
-- Proves supabase/migrations/0085_files_in_own_folder.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up offices and people it creates
-- never exist outside it.
--
-- Pass: the last line says "Stored files: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  ag uuid := gen_random_uuid();      -- an office
  ag2 uuid := gen_random_uuid();     -- another office
  lic uuid := gen_random_uuid();     -- its licensee in charge
  agt uuid := gen_random_uuid();     -- one of its agents
  prop uuid := gen_random_uuid();    -- the agent's listing
  plan uuid := gen_random_uuid();    -- the agent's training plan
  item uuid := gen_random_uuid();    -- an item on it
  own text;
  other text;
  climb text;
  n integer;
begin
  insert into auth.users (id, email) values
    (lic, 'fo-lic@example.invalid'), (agt, 'fo-agent@example.invalid');
  insert into public.agencies (id, name, plan, status) values
    (ag, 'FO Property (made up)', 'office_1', 'active'),
    (ag2, 'FO Other Property (made up)', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent) values
    (lic, ag, 'FO Licensee', 'fo-lic@example.invalid', true, false, true),
    (agt, ag, 'FO Agent', 'fo-agent@example.invalid', false, false, true);
  insert into public.properties (id, agency_id, created_by, address, property_type, stage, test_mode)
  values (prop, ag, agt, '1 Folder Street, Testville NSW 2999 (made up)', 'House', 3, true);
  insert into public.training_plans (id, agency_id, profile_id, cpd_year_start) values (plan, ag, agt, '2026-07-01');
  insert into public.training_plan_items (id, agency_id, plan_id, program_name) values (item, ag, plan, 'Made-up course');

  own := ag::text || '/_brand/1-logo.png';
  other := ag2::text || '/_brand/1-their-logo.png';
  climb := ag::text || '/../' || ag2::text || '/_brand/1-their-logo.png';

  -- As the licensee, through the same rules the app uses.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);

  -- 1. The logo: in the office's own folder through the app's function; not in
  --    another office's folder, not with a ".." part, not set directly either.
  set local role authenticated;
  perform public.set_agency_logo(own);
  reset role;
  select count(*) into n from public.agencies where id = ag and logo_path = own;
  if n <> 1 then raise exception 'FAIL 1: a logo in the office''s own folder was not saved'; end if;
  begin
    set local role authenticated;
    perform public.set_agency_logo(other);
    reset role;
    raise exception 'FAIL 1: a logo in another office''s folder was saved';
  exception when check_violation then
    reset role;
  end;
  begin
    set local role authenticated;
    perform public.set_agency_logo(climb);
    reset role;
    raise exception 'FAIL 1: a logo path climbing out of the office''s folder was saved';
  exception when check_violation then
    reset role;
  end;
  begin
    set local role authenticated;
    update public.agencies set logo_path = other where id = ag;
    reset role;
    raise exception 'FAIL 1: the licensee pointed the logo at another office''s folder directly';
  exception when check_violation then
    reset role;
  end;

  -- 2. The corporation's licence.
  set local role authenticated;
  update public.agencies set corporation_licence_document_path = ag::text || '/_licences/_corporation/1-licence.pdf' where id = ag;
  reset role;
  begin
    set local role authenticated;
    update public.agencies set corporation_licence_document_path = ag2::text || '/_licences/_corporation/1-licence.pdf' where id = ag;
    reset role;
    raise exception 'FAIL 2: the corporation''s licence was pointed at another office''s folder';
  exception when check_violation then
    reset role;
  end;

  -- 3. The SG manual: a version in the office's own folder, and not elsewhere.
  set local role authenticated;
  insert into public.sg_manual_versions (agency_id, file_path, file_name)
  values (ag, ag::text || '/_sg-manual/1-manual.pdf', '1-manual.pdf');
  reset role;
  begin
    set local role authenticated;
    insert into public.sg_manual_versions (agency_id, file_path, file_name)
    values (ag, ag2::text || '/_sg-manual/1-manual.pdf', '1-manual.pdf');
    reset role;
    raise exception 'FAIL 3: an SG manual in another office''s folder was saved';
  exception when check_violation then
    reset role;
  end;

  -- 4. The trust account audit.
  set local role authenticated;
  insert into public.trust_audits (agency_id, period_end, file_path)
  values (ag, '2026-06-30', ag::text || '/_signoffs/trust_audit/1-audit.pdf');
  reset role;
  begin
    set local role authenticated;
    insert into public.trust_audits (agency_id, period_end, file_path)
    values (ag, '2025-06-30', ag2::text || '/_signoffs/trust_audit/1-audit.pdf');
    reset role;
    raise exception 'FAIL 4: a trust audit in another office''s folder was saved';
  exception when check_violation then
    reset role;
  end;

  -- As the agent now.
  perform set_config('request.jwt.claims', json_build_object('sub', agt, 'role', 'authenticated')::text, true);

  -- 5. Their own licence document.
  set local role authenticated;
  update public.profiles set licence_document_path = ag::text || '/_licences/' || agt::text || '/1-licence.pdf' where id = agt;
  reset role;
  begin
    set local role authenticated;
    update public.profiles set licence_document_path = ag2::text || '/_licences/' || agt::text || '/1-licence.pdf' where id = agt;
    reset role;
    raise exception 'FAIL 5: a licence document was pointed at another office''s folder';
  exception when check_violation then
    reset role;
  end;

  -- 6. A training plan item's document.
  set local role authenticated;
  update public.training_plan_items
     set evidence_path = ag::text || '/_cpd/' || agt::text || '/training-plan/1-certificate.pdf'
   where id = item;
  reset role;
  begin
    set local role authenticated;
    update public.training_plan_items
       set evidence_path = ag2::text || '/_cpd/' || agt::text || '/training-plan/1-certificate.pdf'
     where id = item;
    reset role;
    raise exception 'FAIL 6: a training plan document was pointed at another office''s folder';
  exception when check_violation then
    reset role;
  end;

  -- 7. The property reports register (f3): a report in the office's own
  --    folder, and one typed with no copy, are kept; a copy in another
  --    office's folder, or with a ".." part, is refused.
  set local role authenticated;
  insert into public.property_items (agency_id, property_id, item_key, status, data)
  values (ag, prop, 'f3', 'done', jsonb_build_object('entries', jsonb_build_array(
    jsonb_build_object('evidencePath', ag::text || '/' || prop::text || '/f3/1-report.pdf'),
    jsonb_build_object('evidencePath', null))));
  reset role;
  select count(*) into n from public.property_items where property_id = prop and item_key = 'f3';
  if n <> 1 then raise exception 'FAIL 7: a register entry in the office''s own folder was not saved'; end if;
  begin
    set local role authenticated;
    update public.property_items
       set data = jsonb_set(data, '{entries}', (data -> 'entries') || jsonb_build_array(
             jsonb_build_object('evidencePath', ag2::text || '/' || prop::text || '/f3/1-report.pdf')))
     where property_id = prop and item_key = 'f3';
    reset role;
    raise exception 'FAIL 7: a register entry in another office''s folder was saved';
  exception when check_violation then
    reset role;
  end;
  begin
    set local role authenticated;
    update public.property_items
       set data = jsonb_set(data, '{entries}', (data -> 'entries') || jsonb_build_array(
             jsonb_build_object('evidencePath', ag::text || '/../' || ag2::text || '/x.pdf')))
     where property_id = prop and item_key = 'f3';
    reset role;
    raise exception 'FAIL 7: a register entry climbing out of the office''s folder was saved';
  exception when check_violation then
    reset role;
  end;

  -- 8. The same holds for the platform's own jobs (here, the table's owner),
  --    not only for people signed in.
  begin
    update public.agencies set logo_path = other where id = ag;
    raise exception 'FAIL 8: the platform pointed the logo at another office''s folder';
  exception when check_violation then
    null;
  end;

  -- 9. Taking a file off (no file) is always allowed, and nothing else changed.
  update public.agencies set logo_path = null, corporation_licence_document_path = null where id = ag;
  update public.profiles set licence_document_path = null where id = agt;
  update public.training_plan_items set evidence_path = null where id = item;
  select count(*) into n from public.agencies where id = ag and logo_path is null and corporation_licence_document_path is null;
  if n <> 1 then raise exception 'FAIL 9: taking the logo and licence off did not save'; end if;

  -- 10. Every check is in force and has been checked against every row there was.
  select count(*) into n from pg_constraint
   where conname in ('agencies_logo_in_own_folder', 'agencies_corporation_licence_document_in_own_folder',
                     'profiles_licence_document_in_own_folder', 'sg_manual_versions_file_in_own_folder',
                     'trust_audits_file_in_own_folder', 'training_plan_items_evidence_in_own_folder',
                     'property_items_report_files_in_own_folder')
     and convalidated;
  if n <> 7 then raise exception 'FAIL 10: % of the 7 checks are in force for every row, expected 7', n; end if;
end $$;

select 'Stored files: all checks passed' as result;

rollback;
