-- ===== READ ONLY. SG annexure adoption test, 14 October 2026 =====
--
-- Proves supabase/migrations/0067_sg_annexure_adoption.sql (the licensee in
-- charge adopts the RealComply annexure to the Supervision Guidelines from a
-- link) and 0068 (office plans only: never an agent on their own plan). Run
-- after both. Safe on the live database: everything happens inside one
-- transaction that is rolled back at the end, so the made-up offices, people
-- and links it creates never exist outside it.
--
-- Pass: the last line says "SG annexure adoption: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  lo uuid := gen_random_uuid();       -- an office whose licensee uses RealComply
  solo uuid := gen_random_uuid();     -- an agent on their own plan
  other uuid := gen_random_uuid();    -- an unrelated office
  gone uuid := gen_random_uuid();     -- an office whose subscription has ended
  ll uuid := gen_random_uuid();       -- licensee in charge of lo
  la uuid := gen_random_uuid();       -- an agent in lo
  sa uuid := gen_random_uuid();       -- the agent on their own plan
  sas uuid := gen_random_uuid();      -- their assistant
  ol uuid := gen_random_uuid();       -- licensee in charge of other
  tok uuid; tok2 uuid; tok3 uuid; stok uuid; gtok uuid;
  adopted uuid;
  r record;
  n integer;
  msg text;
  v text := '1.4';
begin
  -- ── Made-up offices and people (as the database owner). ──
  insert into auth.users (id, email) values
    (ll, 'sga-lic@example.invalid'), (la, 'sga-agent@example.invalid'), (sa, 'sga-solo@example.invalid'),
    (sas, 'sga-solo-asst@example.invalid'), (ol, 'sga-other@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email, corporation_licence_number) values
    (lo, 'SG annexure test office', 'office_1', 'active', 'Test Licensee', 'sga-lic@example.invalid', null),
    (solo, 'SG annexure test solo', 'agent_1', 'active', 'Solo Agent', 'sga-solo@example.invalid', null),
    (other, 'SG annexure other office', 'office_1', 'active', 'Other Licensee', 'sga-other@example.invalid', '10012345'),
    (gone, 'SG annexure ended office', 'office_1', 'active', 'Gone Licensee', 'sga-gone@example.invalid', null);
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent, licence_number) values
    (ll, lo, 'SGA Licensee', 'SGA-Lic@example.invalid', true, false, true, null),
    (la, lo, 'SGA Agent', 'sga-agent@example.invalid', false, false, true, null),
    (sa, solo, 'SGA Solo', 'sga-solo@example.invalid', false, false, true, '20067890'),
    (sas, solo, 'SGA Solo Assistant', 'sga-solo-asst@example.invalid', false, true, false, null),
    (ol, other, 'SGA Other Licensee', 'sga-other@example.invalid', true, false, true, null);

  -- 1. The licensee makes a fresh link, which goes to their own login email.
  perform set_config('request.jwt.claims', json_build_object('sub', ll, 'role', 'authenticated')::text, true);
  set local role authenticated;
  tok := public.create_sg_annexure_link();
  reset role;
  select sent_to into msg from public.sg_annexure_links where token = tok;
  if msg is distinct from 'sga-lic@example.invalid' then
    raise exception 'FAIL 1: the fresh link went to %, not the licensee''s login', msg;
  end if;

  -- 2. An agent in an office with a licensee cannot make one.
  msg := null;
  perform set_config('request.jwt.claims', json_build_object('sub', la, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.create_sg_annexure_link();
  exception when others then msg := sqlerrm;
  end;
  reset role;
  if msg is distinct from 'Only the licensee in charge can adopt the annexure.' then
    raise exception 'FAIL 2: an agent made a link (%)', coalesce(msg, 'no error');
  end if;

  -- 3. Neither an agent on their own plan nor their assistant can (0068:
  --    RealComply never contacts an agent plan's licensee).
  msg := null;
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    stok := public.create_sg_annexure_link();
  exception when others then msg := sqlerrm;
  end;
  reset role;
  if msg is distinct from 'Only the licensee in charge can adopt the annexure.' then
    raise exception 'FAIL 3: an agent on their own plan made a link (%)', coalesce(msg, 'no error');
  end if;
  msg := null;
  perform set_config('request.jwt.claims', json_build_object('sub', sas, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.create_sg_annexure_link();
  exception when others then msg := sqlerrm;
  end;
  reset role;
  if msg is null then
    raise exception 'FAIL 3b: an agent plan''s assistant made a link';
  end if;

  -- 3c. No link for an agent plan even from the server, which bypasses the
  --     row rules (0068's trigger): the new-office flow can never send one.
  msg := null;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    insert into public.sg_annexure_links (agency_id, sent_to, purpose) values (solo, 'sga-solo@example.invalid', 'new_office');
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from 'The annexure is not sent for an agent on their own plan.' then
    raise exception 'FAIL 3c: the server made a link for an agent plan (%)', coalesce(msg, 'no error');
  end if;

  -- 4. Signed out: the page reads the office and an open link. No licence
  --    number on file here, so the page will ask.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  select * into r from public.sg_annexure_link_details(tok, v);
  if r.agency_name is distinct from 'SG annexure test office' or r.state <> 'open' or r.licence_number is not null then
    raise exception 'FAIL 4: details read % / % / %', r.agency_name, r.state, r.licence_number;
  end if;

  -- 5. Signed out, neither table can be read directly.
  msg := null;
  begin
    perform 1 from public.sg_annexure_links;
  exception when insufficient_privilege then msg := 'refused';
  end;
  if msg is null then raise exception 'FAIL 5: signed out, the links table could be read'; end if;
  msg := null;
  begin
    perform 1 from public.sg_annexure_adoptions;
  exception when insufficient_privilege then msg := 'refused';
  end;
  if msg is null then raise exception 'FAIL 5b: signed out, the adoptions table could be read'; end if;

  -- 6. A blank licence number, a blank name or an unknown version is refused.
  msg := null;
  begin
    perform public.adopt_sg_annexure(tok, v, 'SGA Licensee', '   ');
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from 'Type your licence number.' then raise exception 'FAIL 6: blank licence (%)', msg; end if;
  msg := null;
  begin
    perform public.adopt_sg_annexure(tok, v, ' ', '10099999');
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from 'Type your full name.' then raise exception 'FAIL 6b: blank name (%)', msg; end if;
  msg := null;
  begin
    perform public.adopt_sg_annexure(tok, 'draft', 'SGA Licensee', '10099999');
  exception when others then msg := sqlerrm;
  end;
  if msg is null then raise exception 'FAIL 6c: an unknown version was accepted'; end if;

  -- 7. Adopting records once and uses the link up.
  adopted := public.adopt_sg_annexure(tok, v, '  SGA Licensee ', '10099999');
  msg := null;
  begin
    perform public.adopt_sg_annexure(tok, v, 'SGA Licensee', '10099999');
  exception when others then msg := sqlerrm;
  end;
  if adopted is null or msg is distinct from 'This link is no longer valid.' then
    raise exception 'FAIL 7: second press on the same link (%)', coalesce(msg, 'accepted');
  end if;
  select * into r from public.sg_annexure_link_details(tok, v);
  if r.state <> 'adopted' or r.adopted_at is null then
    raise exception 'FAIL 7b: after adopting, the page reads %', r.state;
  end if;
  reset role;
  select count(*) into n from public.sg_annexure_adoptions where agency_id = lo;
  select * into r from public.sg_annexure_adoptions where id = adopted;
  if n <> 1 or r.signed_name <> 'SGA Licensee' or r.licence_number <> '10099999'
     or r.sent_to <> 'sga-lic@example.invalid' or r.annexure_version <> '1.4' then
    raise exception 'FAIL 7c: % adoptions; recorded % / % / % / %', n, r.signed_name, r.licence_number, r.sent_to, r.annexure_version;
  end if;

  -- 8. A second, fresh link for the same office cannot adopt the same version again.
  perform set_config('request.jwt.claims', json_build_object('sub', ll, 'role', 'authenticated')::text, true);
  set local role authenticated;
  tok2 := public.create_sg_annexure_link();
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  select * into r from public.sg_annexure_link_details(tok2, v);
  msg := null;
  begin
    perform public.adopt_sg_annexure(tok2, v, 'SGA Licensee', '10099999');
  exception when others then msg := sqlerrm;
  end;
  reset role;
  if r.state <> 'adopted' or msg is distinct from 'This annexure has already been adopted.' then
    raise exception 'FAIL 8: second link reads % and adopting said %', r.state, coalesce(msg, 'nothing');
  end if;

  -- 9. An expired link and an unknown token are refused.
  insert into public.sg_annexure_links (agency_id, sent_to, expires_at)
  values (other, 'sga-other@example.invalid', now() - interval '1 minute') returning token into tok3;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  select * into r from public.sg_annexure_link_details(tok3, v);
  if r.state <> 'expired' or r.licence_number is distinct from '10012345' then
    raise exception 'FAIL 9: expired link reads % (licence %)', r.state, r.licence_number;
  end if;
  msg := null;
  begin
    perform public.adopt_sg_annexure(tok3, v, 'SGA Other', '10012345');
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from 'This link is no longer valid.' then raise exception 'FAIL 9b: expired link (%)', msg; end if;
  msg := null;
  begin
    perform public.adopt_sg_annexure(gen_random_uuid(), v, 'Nobody', '1');
  exception when others then msg := sqlerrm;
  end;
  if msg is distinct from 'This link is no longer valid.' then raise exception 'FAIL 9c: unknown token (%)', msg; end if;
  reset role;

  -- 10. Only the licensee reads the adoption: not their agent, not another office.
  perform set_config('request.jwt.claims', json_build_object('sub', ll, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.sg_annexure_adoptions;
  reset role;
  if n <> 1 then raise exception 'FAIL 10: the licensee sees % adoptions', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', la, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.sg_annexure_adoptions;
  reset role;
  if n <> 0 then raise exception 'FAIL 10b: an agent sees % adoptions', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ol, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.sg_annexure_adoptions;
  reset role;
  if n <> 0 then raise exception 'FAIL 10c: another office''s licensee sees % adoptions', n; end if;

  -- 11. Nobody signed in writes an adoption or a link directly.
  perform set_config('request.jwt.claims', json_build_object('sub', ll, 'role', 'authenticated')::text, true);
  set local role authenticated;
  msg := null;
  begin
    insert into public.sg_annexure_adoptions (agency_id, annexure_version, signed_name, licence_number, sent_to)
    values (lo, '9.9', 'SGA Licensee', '1', 'x@example.invalid');
  exception when insufficient_privilege then msg := 'refused';
  end;
  if msg is null then reset role; raise exception 'FAIL 11: the licensee wrote an adoption directly'; end if;
  msg := null;
  begin
    update public.sg_annexure_adoptions set signed_name = 'Someone Else' where id = adopted;
  exception when insufficient_privilege then msg := 'refused';
  end;
  if msg is null then reset role; raise exception 'FAIL 11b: the licensee changed an adoption'; end if;
  msg := null;
  begin
    insert into public.sg_annexure_links (agency_id, sent_to) values (lo, 'x@example.invalid');
  exception when insufficient_privilege then msg := 'refused';
  end;
  reset role;
  if msg is null then raise exception 'FAIL 11c: the licensee wrote a link directly'; end if;

  -- 12. One 'new office' link per office: the second claim fails, so the
  --     trial-start email goes once however many times Stripe calls.
  insert into public.sg_annexure_links (agency_id, sent_to, purpose) values (other, 'sga-other@example.invalid', 'new_office');
  msg := null;
  begin
    insert into public.sg_annexure_links (agency_id, sent_to, purpose) values (other, 'sga-other@example.invalid', 'new_office');
  exception when unique_violation then msg := 'refused';
  end;
  if msg is null then raise exception 'FAIL 12: a second new office link was made for the same office'; end if;
  if (select purpose from public.sg_annexure_links where token = tok) <> 'home' then
    raise exception 'FAIL 12b: a Home card link is not marked as one';
  end if;

  -- 13. Once an office's subscription has ended, its link cannot adopt.
  insert into public.sg_annexure_links (agency_id, sent_to) values (gone, 'sga-gone@example.invalid') returning token into gtok;
  update public.agencies set ended_at = now() where id = gone;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  select * into r from public.sg_annexure_link_details(gtok, v);
  msg := null;
  begin
    perform public.adopt_sg_annexure(gtok, v, 'Gone Licensee', '1');
  exception when others then msg := sqlerrm;
  end;
  reset role;
  if r.state <> 'ended' or msg is null or position('subscription has ended' in msg) = 0 then
    raise exception 'FAIL 13: ended office reads % and adopting said %', r.state, coalesce(msg, 'nothing');
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'SG annexure adoption: all checks passed';
end
$$;

rollback;

select 'SG annexure adoption: all checks passed' as result;
