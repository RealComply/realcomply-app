-- ===== READ ONLY. Agent welcome and SG read-and-tick test, 14 October 2026 =====
--
-- Proves supabase/migrations/0069_agent_welcome_sg_read.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up offices and people it creates
-- never exist outside it.
--
-- Pass: the last line says "Agent welcome and SG read: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  lo uuid := gen_random_uuid();       -- an office
  solo uuid := gen_random_uuid();     -- an agent on their own plan
  other uuid := gen_random_uuid();    -- an unrelated office
  gone uuid := gen_random_uuid();     -- an office whose subscription has ended
  ll uuid := gen_random_uuid();       -- licensee in charge of lo
  la uuid := gen_random_uuid();       -- an agent in lo
  lb uuid := gen_random_uuid();       -- a second agent in lo
  las uuid := gen_random_uuid();      -- an assistant in lo
  sa uuid := gen_random_uuid();       -- the agent on their own plan
  ol uuid := gen_random_uuid();       -- licensee in charge of other
  ga uuid := gen_random_uuid();       -- an agent in the ended office
  ok boolean;
  r record;
  first_id uuid;
  n integer;
  msg text;
  rec jsonb;
begin
  insert into auth.users (id, email) values
    (ll, 'awr-lic@example.invalid'), (la, 'awr-a@example.invalid'), (lb, 'awr-b@example.invalid'),
    (las, 'awr-asst@example.invalid'), (sa, 'awr-solo@example.invalid'), (ol, 'awr-other@example.invalid'),
    (ga, 'awr-gone@example.invalid');
  insert into public.agencies (id, name, plan, status) values
    (lo, 'AWR office', 'office_1', 'active'),
    (solo, 'AWR solo', 'agent_1', 'active'),
    (other, 'AWR other office', 'office_1', 'active'),
    (gone, 'AWR ended office', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent) values
    (ll, lo, 'AWR Licensee', 'awr-lic@example.invalid', true, false, true),
    (la, lo, 'AWR Agent A', 'awr-a@example.invalid', false, false, true),
    (lb, lo, 'AWR Agent B', 'awr-b@example.invalid', false, false, true),
    (las, lo, 'AWR Assistant', 'awr-asst@example.invalid', false, true, false),
    (sa, solo, 'AWR Solo', 'awr-solo@example.invalid', true, false, true),
    (ol, other, 'AWR Other Licensee', 'awr-other@example.invalid', true, false, true),
    (ga, gone, 'AWR Gone Agent', 'awr-gone@example.invalid', false, false, true);

  -- ── The agent welcome claim ──
  -- 1. An agent invited into an office claims once.
  perform set_config('request.jwt.claims', json_build_object('sub', la, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := public.claim_office_agent_welcome();
  if not ok then raise exception 'FAIL 1: the office agent could not claim their welcome'; end if;
  ok := public.claim_office_agent_welcome();
  if ok then raise exception 'FAIL 1b: the welcome was claimed twice'; end if;
  reset role;
  select count(*) into n from public.agent_welcome_emails where profile_id = la and kind = 'office' and agency_id = lo;
  if n <> 1 then raise exception 'FAIL 1c: % welcome rows for the agent', n; end if;

  -- 2. Not the licensee, not an assistant, not an agent on their own plan.
  perform set_config('request.jwt.claims', json_build_object('sub', ll, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.claim_office_agent_welcome() then raise exception 'FAIL 2: the licensee claimed an agent welcome'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', las, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.claim_office_agent_welcome() then raise exception 'FAIL 2b: an assistant claimed an agent welcome'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.claim_office_agent_welcome() then raise exception 'FAIL 2c: an agent on their own plan claimed the office welcome'; end if;
  reset role;

  -- 3. A failed send gives the claim back, and only the caller's own.
  perform set_config('request.jwt.claims', json_build_object('sub', lb, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.claim_office_agent_welcome();
  perform public.release_office_agent_welcome();
  reset role;
  select count(*) into n from public.agent_welcome_emails where profile_id in (la, lb);
  if n <> 1 then raise exception 'FAIL 3: after B gave their claim back, % rows (A''s must stay)', n; end if;

  -- 4. Nobody signed in reads or writes the welcome record directly.
  perform set_config('request.jwt.claims', json_build_object('sub', la, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform 1 from public.agent_welcome_emails;
    raise exception 'FAIL 4: a signed-in person read the welcome record';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ── Read the annexure and the Supervision Guidelines ──
  -- 5. Before the office has adopted the annexure: nothing to confirm.
  perform set_config('request.jwt.claims', json_build_object('sub', la, 'role', 'authenticated')::text, true);
  set local role authenticated;
  msg := null;
  begin
    perform * from public.confirm_sg_read();
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from 'Your office has not adopted the annexure yet.' then
    raise exception 'FAIL 5: confirming before adoption gave: %', coalesce(msg, 'no error');
  end if;
  select count(*) into n from public.office_annexure_adoption();
  if n <> 0 then raise exception 'FAIL 5b: an adoption showed before there was one'; end if;
  reset role;

  -- The licensee adopts (as the server would record it).
  insert into public.sg_annexure_adoptions (agency_id, annexure_version, signed_name, licence_number, sent_to)
  values (lo, '1.4', 'AWR Licensee', '10099999', 'awr-lic@example.invalid'),
         (gone, '1.4', 'AWR Gone Licensee', '10088888', 'awr-gone-lic@example.invalid');

  -- 6. The agent sees what their licensee adopted: version, name, date. Not the licence number.
  perform set_config('request.jwt.claims', json_build_object('sub', la, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r from public.office_annexure_adoption();
  if r.annexure_version is distinct from '1.4' or r.adopted_by_name is distinct from 'AWR Licensee' or r.adopted_at is null then
    raise exception 'FAIL 6: the agent saw % / % / %', r.annexure_version, r.adopted_by_name, r.adopted_at;
  end if;
  -- The adoption record itself stays the licensee's (0068).
  select count(*) into n from public.sg_annexure_adoptions;
  if n <> 0 then raise exception 'FAIL 6b: the agent read % adoption rows', n; end if;

  -- 7. The agent ticks: one row, the adopted version; a double click returns the same row.
  select * into r from public.confirm_sg_read();
  first_id := r.confirmation_id;
  if r.confirmed_version is distinct from '1.4' or r.confirmed_when is null then
    raise exception 'FAIL 7: the confirmation came back as % / %', r.confirmed_version, r.confirmed_when;
  end if;
  select * into r from public.confirm_sg_read();
  if r.confirmation_id is distinct from first_id then raise exception 'FAIL 7b: a second click made a second confirmation'; end if;
  reset role;
  select count(*) into n from public.sg_read_confirmations where confirmed_by = la;
  if n <> 1 then raise exception 'FAIL 7c: % confirmations for one agent', n; end if;

  -- 8. Agent B ticks too. Each agent sees only their own; the licensee sees both.
  perform set_config('request.jwt.claims', json_build_object('sub', lb, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform * from public.confirm_sg_read();
  select count(*) into n from public.sg_read_confirmations;
  if n <> 1 then raise exception 'FAIL 8: agent B sees % confirmations, not just their own', n; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ll, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.sg_read_confirmations;
  if n <> 2 then raise exception 'FAIL 8b: the licensee sees % confirmations, not 2', n; end if;
  -- The licensee does not tick it themselves.
  msg := null;
  begin
    perform * from public.confirm_sg_read();
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from 'Only an agent in an office confirms this.' then
    raise exception 'FAIL 8c: the licensee confirming gave: %', coalesce(msg, 'no error');
  end if;
  -- Nor writes one directly.
  begin
    insert into public.sg_read_confirmations (agency_id, confirmed_by, annexure_version) values (lo, ll, '1.4');
    raise exception 'FAIL 8d: the licensee wrote a confirmation directly';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 9. Not an assistant, not an agent on their own plan; another office sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', las, 'role', 'authenticated')::text, true);
  set local role authenticated;
  msg := null;
  begin
    perform * from public.confirm_sg_read();
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from 'Only an agent in an office confirms this.' then raise exception 'FAIL 9: the assistant confirming gave: %', coalesce(msg, 'no error'); end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.office_annexure_adoption();
  if n <> 0 then raise exception 'FAIL 9b: an agent on their own plan saw an office adoption'; end if;
  msg := null;
  begin
    perform * from public.confirm_sg_read();
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from 'Only an agent in an office confirms this.' then raise exception 'FAIL 9c: the own-plan agent confirming gave: %', coalesce(msg, 'no error'); end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ol, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.sg_read_confirmations;
  if n <> 0 then raise exception 'FAIL 9d: another office''s licensee sees % confirmations', n; end if;
  select count(*) into n from public.office_annexure_adoption();
  if n <> 0 then raise exception 'FAIL 9e: another office saw this office''s adoption'; end if;
  reset role;

  -- 10. Signed out: nothing.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    perform 1 from public.sg_read_confirmations;
    raise exception 'FAIL 10: signed out read the confirmations';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.confirm_sg_read();
    raise exception 'FAIL 10b: signed out could call confirm_sg_read';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 11. Once the subscription has ended, nothing is added. The office ends the
  --     way a subscription ends (0054): the server moves it to canceled and
  --     the database stamps ended_at. An end date written onto an active
  --     office is cleared again, so that would leave it current.
  perform set_config('request.jwt.claims', '', true);
  update public.agencies set status = 'canceled' where id = gone;
  if (select ended_at from public.agencies where id = gone) is null then
    raise exception 'FAIL 11: the test office did not end';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ga, 'role', 'authenticated')::text, true);
  set local role authenticated;
  msg := null;
  begin
    perform * from public.confirm_sg_read();
  exception when others then msg := sqlerrm;
  end;
  if msg is null or msg not like 'This agency''s subscription has ended%' then
    raise exception 'FAIL 11: confirming in an ended office gave: %', coalesce(msg, 'no error');
  end if;
  reset role;

  -- 12. The 7-year activity record lists who confirmed, which version and when; no names.
  perform set_config('request.jwt.claims', '', true);
  rec := public.build_activity_record(lo);
  if jsonb_array_length(rec -> 'sg_read_confirmations') <> 2
     or not (rec -> 'sg_read_confirmations' -> 0 ? 'by')
     or (rec -> 'sg_read_confirmations')::text like '%AWR%' then
    raise exception 'FAIL 12: the activity record holds %', rec -> 'sg_read_confirmations';
  end if;

  raise notice 'Agent welcome and SG read: all checks passed';
end
$$;

rollback;
