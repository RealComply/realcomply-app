-- ===== READ ONLY. Trading name and licensed entity name test, 14 October 2026 =====
--
-- Proves supabase/migrations/0070_licensed_entity_name.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up offices and people it creates
-- never exist outside it.
--
-- Pass: the last line says "Licensed entity name: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  lo uuid := gen_random_uuid();       -- an office
  solo uuid := gen_random_uuid();     -- an agent on their own plan
  other uuid := gen_random_uuid();    -- an unrelated office
  fresh uuid := gen_random_uuid();    -- an office just signed up by someone who isn't the licensee
  ll uuid := gen_random_uuid();       -- licensee in charge of lo
  la uuid := gen_random_uuid();       -- an agent in lo
  las uuid := gen_random_uuid();      -- an assistant in lo
  sa uuid := gen_random_uuid();       -- the agent on their own plan
  ol uuid := gen_random_uuid();       -- licensee in charge of other
  fs uuid := gen_random_uuid();       -- the person who signed up fresh
  tok uuid := gen_random_uuid();
  tok2 uuid := gen_random_uuid();
  n integer;
  v text;
  s text;
  msg text;
  rec jsonb;
  r record;
  ad uuid;
begin
  insert into auth.users (id, email) values
    (ll, 'len-lic@example.invalid'), (la, 'len-a@example.invalid'), (las, 'len-asst@example.invalid'),
    (sa, 'len-solo@example.invalid'), (ol, 'len-other@example.invalid'), (fs, 'len-fresh@example.invalid');
  insert into public.agencies (id, name, plan, status) values
    (lo, 'LEN Property Agents', 'office_1', 'active'),
    (solo, 'LEN solo', 'agent_1', 'active'),
    (other, 'LEN other office', 'office_1', 'active'),
    (fresh, 'LEN fresh office', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent) values
    (ll, lo, 'LEN Licensee', 'len-lic@example.invalid', true, false, true),
    (la, lo, 'LEN Agent', 'len-a@example.invalid', false, false, true),
    (las, lo, 'LEN Assistant', 'len-asst@example.invalid', false, true, false),
    (sa, solo, 'LEN Solo', 'len-solo@example.invalid', true, false, true),
    (ol, other, 'LEN Other Licensee', 'len-other@example.invalid', true, false, true),
    (fs, fresh, 'LEN Fresh Signer', 'len-fresh@example.invalid', false, false, true);

  -- 1. New offices start with no licensed entity name, and each has its own download token.
  select licensed_entity_name, licensed_entity_name_source into v, s from public.agencies where id = lo;
  if v is not null or s is not null then raise exception 'FAIL 1: a new office has a licensed entity name'; end if;
  select count(distinct annexure_download_token) into n from public.agencies where id in (lo, solo, other, fresh);
  if n <> 4 then raise exception 'FAIL 1b: download tokens are missing or shared'; end if;

  -- 2. "Yes, use it" on the corporation licence: saved as read from the licence; logged with who.
  perform set_config('request.jwt.claims', json_build_object('sub', ll, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_agency_licensed_entity_name('  LEN   Corporation Pty Ltd ', 'corporation_licence');
  reset role;
  select licensed_entity_name, licensed_entity_name_source into v, s from public.agencies where id = lo;
  if v <> 'LEN Corporation Pty Ltd' or s <> 'licence' then raise exception 'FAIL 2: saved as % / %', v, s; end if;
  select count(*) into n from public.agency_name_changes
   where agency_id = lo and name_kind = 'licensed_entity' and old_name is null and new_name = 'LEN Corporation Pty Ltd'
     and via = 'corporation_licence' and changed_by = ll;
  if n <> 1 then raise exception 'FAIL 2b: % history rows for the first change', n; end if;

  -- 3. The trading name is untouched by that, and changes on its own in Office profile.
  select name into v from public.agencies where id = lo;
  if v <> 'LEN Property Agents' then raise exception 'FAIL 3: the trading name changed to %', v; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ll, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_agency_trading_name(' LEN  Agents ');
  begin
    perform public.set_agency_trading_name('   ');
    raise exception 'FAIL 3b: an empty trading name was saved';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg like 'FAIL%' then raise; end if;
  end;
  reset role;
  select name into v from public.agencies where id = lo;
  if v <> 'LEN Agents' then raise exception 'FAIL 3c: trading name is %', v; end if;
  select count(*) into n from public.agency_name_changes
   where agency_id = lo and name_kind = 'trading' and old_name = 'LEN Property Agents' and new_name = 'LEN Agents'
     and via = 'office_profile' and changed_by = ll;
  if n <> 1 then raise exception 'FAIL 3d: the trading name change was not logged'; end if;

  -- 4. Typed later in Office profile: source becomes typed, another history row.
  perform set_config('request.jwt.claims', json_build_object('sub', ll, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_agency_licensed_entity_name('LEN Holdings Pty Ltd', 'office_profile');
  reset role;
  select licensed_entity_name_source into s from public.agencies where id = lo;
  if s <> 'typed' then raise exception 'FAIL 4: source is %', s; end if;
  select count(*) into n from public.agency_name_changes where agency_id = lo and name_kind = 'licensed_entity';
  if n <> 2 then raise exception 'FAIL 4b: % history rows', n; end if;

  -- 5. Saving the same name again adds no history.
  perform set_config('request.jwt.claims', json_build_object('sub', ll, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_agency_licensed_entity_name('LEN Holdings Pty Ltd', 'office_profile');
  reset role;
  select count(*) into n from public.agency_name_changes where agency_id = lo and name_kind = 'licensed_entity';
  if n <> 2 then raise exception 'FAIL 5: an unchanged save was logged'; end if;

  -- 6. An agent in the office and an assistant are refused, for both names.
  foreach v in array array[la::text, las::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.set_agency_licensed_entity_name('Was Here Pty Ltd', 'office_profile');
      raise exception 'FAIL 6: % changed the licensed entity name', v;
    exception when others then
      get stacked diagnostics msg = message_text;
      if msg like 'FAIL%' then raise; end if;
    end;
    begin
      perform public.set_agency_trading_name('Was Here');
      raise exception 'FAIL 6b: % changed the trading name', v;
    exception when others then
      get stacked diagnostics msg = message_text;
      if msg like 'FAIL%' then raise; end if;
    end;
    reset role;
  end loop;
  select name, licensed_entity_name into v, s from public.agencies where id = lo;
  if v <> 'LEN Agents' or s <> 'LEN Holdings Pty Ltd' then raise exception 'FAIL 6c: names became % / %', v, s; end if;

  -- 7. The agent on their own plan sets their own.
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_agency_licensed_entity_name('LEN Solo Employer Pty Ltd', 'sign_up');
  reset role;
  select licensed_entity_name into v from public.agencies where id = solo;
  if v <> 'LEN Solo Employer Pty Ltd' then raise exception 'FAIL 7: the own-plan agent could not set theirs'; end if;

  -- 8. Sign-up by someone who isn't the licensee, before the office has one: allowed, logged as sign-up.
  perform set_config('request.jwt.claims', json_build_object('sub', fs, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_agency_licensed_entity_name('LEN Fresh Pty Ltd', 'sign_up');
  reset role;
  select count(*) into n from public.agency_name_changes where agency_id = fresh and via = 'sign_up' and changed_by = fs;
  if n <> 1 then raise exception 'FAIL 8: the sign-up entity name was not saved and logged'; end if;

  -- 9. Each office sees only its own history; an agent in the office sees it.
  perform set_config('request.jwt.claims', json_build_object('sub', ol, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.agency_name_changes where agency_id in (lo, solo, fresh);
  reset role;
  if n <> 0 then raise exception 'FAIL 9: another office saw % history rows', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', la, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.agency_name_changes;
  reset role;
  if n <> 3 then raise exception 'FAIL 9b: the office agent saw % history rows, not 3', n; end if;

  -- 10. Nobody signed in writes the history directly.
  perform set_config('request.jwt.claims', json_build_object('sub', ll, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.agency_name_changes (agency_id, name_kind, new_name, via) values (lo, 'trading', 'Forged', 'office_profile');
    raise exception 'FAIL 10: the licensee wrote the history directly';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg like 'FAIL%' then raise; end if;
  end;
  reset role;

  -- 11. A name with no source, or a blank name, is refused by the table itself.
  begin
    update public.agencies set licensed_entity_name = 'No Source Pty Ltd', licensed_entity_name_source = null where id = other;
    raise exception 'FAIL 11: a name without a source was saved';
  exception when check_violation then null;
  end;
  begin
    update public.agencies set licensed_entity_name = '   ', licensed_entity_name_source = 'typed' where id = other;
    raise exception 'FAIL 11b: a blank name was saved';
  exception when check_violation then null;
  end;

  -- 12. The signing page gets both names. Editing the entity name there saves
  --     it to the office, as changed on the signing page by the name signed,
  --     and the adoption keeps both names as signed.
  insert into public.sg_annexure_links (token, agency_id, sent_to, expires_at)
  values (tok, lo, 'len-lic@example.invalid', now() + interval '1 day'),
         (tok2, lo, 'len-lic@example.invalid', now() + interval '1 day');
  -- Signed out: nobody's identity on the request.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  select * into r from public.sg_annexure_link_details(tok, '1.4');
  ad := public.adopt_sg_annexure(tok, '1.4', 'LEN Licensee', 'TEST-123', ' LEN  Signing Page Pty Ltd ');
  reset role;
  if r.agency_name <> 'LEN Agents' or r.licensed_entity_name <> 'LEN Holdings Pty Ltd' or r.state <> 'open' then
    raise exception 'FAIL 12: the signing page got % / % / %', r.agency_name, r.licensed_entity_name, r.state;
  end if;
  select licensed_entity_name, licensed_entity_name_source into v, s from public.agencies where id = lo;
  if v <> 'LEN Signing Page Pty Ltd' or s <> 'typed' then raise exception 'FAIL 12b: office now has % / %', v, s; end if;
  select count(*) into n from public.agency_name_changes
   where agency_id = lo and via = 'signing_page' and changed_by is null and changed_by_name = 'LEN Licensee'
     and old_name = 'LEN Holdings Pty Ltd' and new_name = 'LEN Signing Page Pty Ltd';
  if n <> 1 then raise exception 'FAIL 12c: the signing page change was not logged as such'; end if;
  select trading_name, licensed_entity_name into v, s from public.sg_annexure_adoptions where id = ad;
  if v <> 'LEN Agents' or s <> 'LEN Signing Page Pty Ltd' then raise exception 'FAIL 12d: adoption kept % / %', v, s; end if;

  -- 13. 0067's four-argument call still adopts, leaving the entity name as it is.
  set local role anon;
  ad := public.adopt_sg_annexure(tok2, '9.9', 'LEN Licensee', 'TEST-123');
  reset role;
  select licensed_entity_name into v from public.agencies where id = lo;
  if v <> 'LEN Signing Page Pty Ltd' then raise exception 'FAIL 13: the old call changed the name to %', v; end if;
  select licensed_entity_name into v from public.sg_annexure_adoptions where id = ad;
  if v <> 'LEN Signing Page Pty Ltd' then raise exception 'FAIL 13b: the old call kept %', v; end if;

  -- 14. The agent's download link gives the names for agent plans only.
  select annexure_download_token into tok from public.agencies where id = solo;
  select annexure_download_token into tok2 from public.agencies where id = lo;
  set local role anon;
  select count(*) into n from public.annexure_download_details(tok);
  select trading_name, licensed_entity_name into v, s from public.annexure_download_details(tok);
  reset role;
  if n <> 1 or v <> 'LEN solo' or s <> 'LEN Solo Employer Pty Ltd' then raise exception 'FAIL 14: agent download got % / %', v, s; end if;
  set local role anon;
  select count(*) into n from public.annexure_download_details(tok2);
  reset role;
  if n <> 0 then raise exception 'FAIL 14b: an office plan''s names came back from the agent download'; end if;

  -- 15. The activity record lists the changes: which name, how, who and when, never the names.
  rec := public.build_activity_record(lo);
  if jsonb_array_length(rec -> 'agency_name_changes') <> 4 then
    raise exception 'FAIL 15: % changes in the activity record', jsonb_array_length(rec -> 'agency_name_changes');
  end if;
  if (rec -> 'agency_name_changes')::text like '%LEN%' then
    raise exception 'FAIL 15b: the activity record carries a name';
  end if;
  if rec -> 'sg_read_confirmations' is null then raise exception 'FAIL 15c: 0069''s entries went missing'; end if;
end $$;

select 'Licensed entity name: all checks passed' as result;

rollback;
