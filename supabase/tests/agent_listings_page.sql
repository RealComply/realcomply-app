-- 0105: an agent's own listings page (Adam, 2 Nov 2026).
--
-- Made-up offices and people only, and everything is rolled back. Run on a
-- database built with every migration through 0105:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/agent_listings_page.sql
-- Ends with "agent listings page: all checks passed", or stops at the first
-- FAIL.

begin;

do $$
declare
  o1 uuid := gen_random_uuid();   -- an office plan
  o2 uuid := gen_random_uuid();   -- another office
  o3 uuid := gen_random_uuid();   -- an agent on their own plan
  l   uuid := gen_random_uuid();  -- o1's licensee in charge
  a   uuid := gen_random_uuid();  -- an agent in o1
  b   uuid := gen_random_uuid();  -- another agent in o1
  m   uuid := gen_random_uuid();  -- o1's office manager (an agent too)
  s   uuid := gen_random_uuid();  -- a's assistant
  x   uuid := gen_random_uuid();  -- an agent in o2
  g   uuid := gen_random_uuid();  -- the agent on their own plan
  r record;
  n integer;
begin
  insert into auth.users (id, email) values
    (l, 'alp-l@example.invalid'), (a, 'alp-a@example.invalid'), (b, 'alp-b@example.invalid'),
    (m, 'alp-m@example.invalid'), (s, 'alp-s@example.invalid'), (x, 'alp-x@example.invalid'),
    (g, 'alp-g@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email, website_url) values
    (o1, 'ALP Office (made up)', 'office_1', 'active', 'Lee Licensee', 'alp-l@example.invalid', 'https://office.example.invalid/sale'),
    (o2, 'ALP Other Office (made up)', 'office_1', 'active', 'Other Licensee', 'alp-other@example.invalid', null),
    (o3, 'ALP Solo (made up)', 'agent_1', 'active', 'Solo Licensee', 'alp-solo-lic@example.invalid', null);
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (l, o1, 'Lee Licensee', 'alp-l@example.invalid', true, true, false),
    (a, o1, 'Ana Agent', 'alp-a@example.invalid', true, false, false),
    (b, o1, 'Ben Agent', 'alp-b@example.invalid', true, false, false),
    (m, o1, 'Mia Manager', 'alp-m@example.invalid', true, false, false),
    (s, o1, 'Sam Assistant', 'alp-s@example.invalid', false, false, true),
    (x, o2, 'Xan Elsewhere', 'alp-x@example.invalid', true, false, false),
    (g, o3, 'Gus Solo', 'alp-g@example.invalid', true, false, false);
  insert into public.assistant_agents (assistant_id, agent_id, agency_id) values (s, a, o1);
  insert into public.office_managers (agency_id, profile_id, wording, approved_via, approved_by, approved_by_name)
  values (o1, m, 'Mia Manager is the office manager (made up).', 'team', l, 'Lee Licensee');

  -- ── 1. An agent sets their own page. ──
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_agent_listings_page(a, '  https://office.example.invalid/agents/ana  ');
  select url, set_by, agency_id into r from public.agent_listing_pages where profile_id = a;
  if r.url is distinct from 'https://office.example.invalid/agents/ana' or r.set_by <> a or r.agency_id <> o1 then
    raise exception 'FAIL 1: the agent''s own page reads %', row_to_json(r); end if;

  -- ── 2. An agent can't set someone else's. ──
  begin
    perform public.set_agent_listings_page(b, 'https://office.example.invalid/agents/ben');
    raise exception 'FAIL 2: an agent set another agent''s page';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like 'You can only change your own listings page%' then raise exception 'FAIL 2: wrong refusal: %', sqlerrm; end if;
  end;

  -- ── 3. Nobody signed in writes the table directly. ──
  begin
    insert into public.agent_listing_pages (profile_id, agency_id, url) values (b, o1, 'https://x.example.invalid/');
    raise exception 'FAIL 3: an agent wrote the table directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.agent_listing_pages set url = 'https://elsewhere.example.invalid/' where profile_id = a;
    raise exception 'FAIL 3b: an agent updated the table directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.listings_page_checks (page_key, agency_id, url, checked_at, outcome)
    values ('office:' || o1::text, o1, 'https://office.example.invalid/sale', now(), 'read');
    raise exception 'FAIL 3c: an agent wrote a morning check';
  exception when insufficient_privilege then null;
  end;

  -- ── 4. Only https:// pages. ──
  begin
    perform public.set_agent_listings_page(a, 'http://office.example.invalid/agents/ana');
    raise exception 'FAIL 4: an http:// page was saved';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;

  -- ── 5. The licensee in charge sets anyone's in the office. ──
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_agent_listings_page(b, 'https://office.example.invalid/agents/ben');
  perform public.set_agent_listings_page(a, 'https://office.example.invalid/agents/ana-new');
  reset role;
  select url, set_by into r from public.agent_listing_pages where profile_id = b;
  if r.url <> 'https://office.example.invalid/agents/ben' or r.set_by <> l then
    raise exception 'FAIL 5: the licensee''s change reads %', row_to_json(r); end if;
  select url, set_by into r from public.agent_listing_pages where profile_id = a;
  if r.url <> 'https://office.example.invalid/agents/ana-new' or r.set_by <> l then
    raise exception 'FAIL 5b: the licensee''s change of Ana''s page reads %', row_to_json(r); end if;

  -- ── 6. The office manager sets anyone's in the office, not another office's. ──
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_agent_listings_page(b, 'https://office.example.invalid/agents/ben-2');
  begin
    perform public.set_agent_listings_page(x, 'https://other.example.invalid/agents/xan');
    raise exception 'FAIL 6: the office manager set a page in another office';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like 'That person isn''t in your office%' then raise exception 'FAIL 6: wrong refusal: %', sqlerrm; end if;
  end;
  reset role;
  select url, set_by into r from public.agent_listing_pages where profile_id = b;
  if r.url <> 'https://office.example.invalid/agents/ben-2' or r.set_by <> m then
    raise exception 'FAIL 6b: the office manager''s change reads %', row_to_json(r); end if;

  -- ── 7. An assistant has no page and can't set their agent's. ──
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_agent_listings_page(a, 'https://office.example.invalid/agents/ana-by-sam');
    raise exception 'FAIL 7: the assistant set their agent''s page';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.set_agent_listings_page(s, 'https://office.example.invalid/agents/sam');
    raise exception 'FAIL 7b: the assistant has a page';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- The office reads its pages; another office reads none of them.
  select count(*) into n from public.agent_listing_pages;
  if n <> 2 then raise exception 'FAIL 7c: the assistant reads % pages, not the office''s 2', n; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.agent_listing_pages;
  if n <> 0 then raise exception 'FAIL 7d: another office reads % of o1''s pages', n; end if;
  reset role;

  -- ── 8. The agent on their own plan sets their own. ──
  perform set_config('request.jwt.claims', json_build_object('sub', g, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_agent_listings_page(g, 'https://solo.example.invalid/me');
  reset role;
  if not exists (select 1 from public.agent_listing_pages where profile_id = g and url = 'https://solo.example.invalid/me') then
    raise exception 'FAIL 8: the solo agent''s page was not saved'; end if;

  -- ── 9. Keep this one: the agent or whoever runs the office; the office page by the licensee. ──
  insert into public.listings_page_checks (page_key, agency_id, profile_id, url, checked_at, outcome, listings_found, in_realcomply) values
    ('agent:' || b::text, o1, b, 'https://office.example.invalid/agents/ben-2', now(), 'read', 40, 2),
    ('office:' || o1::text, o1, null, 'https://office.example.invalid/sale', now(), 'read', 300, 5);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.keep_listings_page('agent:' || b::text);
    raise exception 'FAIL 9: an agent kept another agent''s page';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.keep_listings_page('office:' || o1::text);
    raise exception 'FAIL 9b: an agent kept the office page';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.keep_listings_page('agent:' || b::text);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.keep_listings_page('office:' || o1::text);
  reset role;
  select count(*) into n from public.listings_page_checks where agency_id = o1 and kept_url = url and kept_at is not null;
  if n <> 2 then raise exception 'FAIL 9c: % kept pages, expected 2', n; end if;

  -- ── 10. Blank removes the page, and its morning check. ──
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_agent_listings_page(b, '   ');
  reset role;
  if exists (select 1 from public.agent_listing_pages where profile_id = b)
     or exists (select 1 from public.listings_page_checks where page_key = 'agent:' || b::text) then
    raise exception 'FAIL 10: a blank page left the page or its check behind'; end if;

  -- ── 11. Grants: the office reads; anon nothing; the 7am check writes. ──
  if not has_table_privilege('authenticated', 'public.agent_listing_pages', 'select')
     or has_table_privilege('authenticated', 'public.agent_listing_pages', 'insert')
     or has_table_privilege('authenticated', 'public.listings_page_checks', 'update')
     or has_table_privilege('anon', 'public.agent_listing_pages', 'select')
     or has_table_privilege('anon', 'public.listings_page_checks', 'select')
     or not has_table_privilege('service_role', 'public.listings_page_checks', 'insert')
     or not has_table_privilege('service_role', 'public.agent_listing_pages', 'select')
     or has_function_privilege('anon', 'public.set_agent_listings_page(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.keep_listings_page(text)', 'execute') then
    raise exception 'FAIL 11: grants are not as written in 0105'; end if;

  raise notice 'agent listings page: all checks passed';
end
$$;

rollback;
