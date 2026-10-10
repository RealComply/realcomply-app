-- ===== READ ONLY. Refused ID document test, 10 October 2026 =====
--
-- Proves supabase/migrations/0060_check_fixes.sql (section G2): the person who uploaded an ID
-- document RealComply refused can delete it, and nothing else changes about
-- who deletes files (0058). Run after 0060. Safe on the live database:
-- everything happens inside one transaction that is rolled back at the end.
--
-- Pass: the last line says "Refused ID document: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  office uuid := gen_random_uuid();
  lic uuid := gen_random_uuid();
  ag1 uuid := gen_random_uuid();
  ag2 uuid := gen_random_uuid();
  asst uuid := gen_random_uuid();
  p1 uuid; p2 uuid;
  n integer;
begin
  -- Deleting a file the way the Storage service does (see agent_access.sql).
  perform set_config('storage.allow_delete_query', 'true', true);

  insert into auth.users (id, email) values
    (lic, 'ri-lic@example.invalid'), (ag1, 'ri-ag1@example.invalid'),
    (ag2, 'ri-ag2@example.invalid'), (asst, 'ri-asst@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_email) values
    (office, 'Refused ID test office', 'office_1', 'active', 'ri-lic@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent) values
    (lic, office, 'Test Licensee', 'ri-lic@example.invalid', true, false, true),
    (ag1, office, 'Test Agent One', 'ri-ag1@example.invalid', false, false, true),
    (ag2, office, 'Test Agent Two', 'ri-ag2@example.invalid', false, false, true),
    (asst, office, 'Test Assistant', 'ri-asst@example.invalid', false, true, false);
  insert into public.assistant_agents (agency_id, assistant_id, agent_id) values (office, asst, ag1);
  update public.profiles set created_at = now() + interval '1 minute' where id in (ag1, ag2, asst);
  insert into public.properties (agency_id, created_by, address) values (office, ag1, '1 Test St') returning id into p1;
  insert into public.properties (agency_id, created_by, address) values (office, ag2, '2 Test St') returning id into p2;
  insert into storage.buckets (id, name) values ('compliance-evidence', 'compliance-evidence') on conflict do nothing;
  insert into storage.objects (bucket_id, name, owner_id, created_at) values
    -- agent 1's: just refused; attached; refused an hour ago; on another card
    ('compliance-evidence', office || '/' || p1 || '/a1/1-licence.jpg', ag1::text, now()),
    ('compliance-evidence', office || '/' || p1 || '/a1/2-voi.pdf', ag1::text, now()),
    ('compliance-evidence', office || '/' || p1 || '/a1/3-old.jpg', ag1::text, now() - interval '1 hour'),
    ('compliance-evidence', office || '/' || p1 || '/a2/4-guide.pdf', ag1::text, now()),
    -- the assistant's, just refused, on agent 1's listing
    ('compliance-evidence', office || '/' || p1 || '/a1/5-passport.jpg', asst::text, now()),
    -- agent 2's, just uploaded, on agent 1's listing (cannot happen in the app)
    ('compliance-evidence', office || '/' || p1 || '/a1/6-other.jpg', ag2::text, now()),
    -- agent 2's own listing
    ('compliance-evidence', office || '/' || p2 || '/a1/7-licence.jpg', ag2::text, now());
  insert into public.property_items (agency_id, property_id, item_key, status, evidence_path) values
    (office, p1, 'a1', 'done', office || '/' || p1 || '/a1/2-voi.pdf');

  -- ══════════════ As agent 1 ══════════════
  perform set_config('request.jwt.claims', json_build_object('sub', ag1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. Deletes their own refused ID document.
  delete from storage.objects where name like '%/1-licence.jpg';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 1: agent could not delete the ID document they just uploaded'; end if;

  -- 2. Not one that is attached, an older one, another card's, or anyone else's.
  delete from storage.objects where name like '%/2-voi.pdf';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2: agent deleted an attached file'; end if;
  delete from storage.objects where name like '%/3-old.jpg';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2: agent deleted an upload older than 15 minutes'; end if;
  delete from storage.objects where name like '%/4-guide.pdf';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2: agent deleted a file on a card that does not refuse ID documents'; end if;
  delete from storage.objects where name like '%/5-passport.jpg' or name like '%/6-other.jpg';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2: agent deleted someone else''s upload'; end if;

  -- ══════════════ As the assistant to agent 1 ══════════════
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', asst, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 3. Deletes their own refused ID document on the agent's listing.
  delete from storage.objects where name like '%/5-passport.jpg';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 3: assistant could not delete the ID document they just uploaded'; end if;

  -- ══════════════ As agent 2 ══════════════
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ag2, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 4. Their own upload on a listing they cannot file to stays (they cannot see it either).
  delete from storage.objects where name like '%/6-other.jpg';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 4: agent deleted a file on a colleague''s listing'; end if;
  delete from storage.objects where name like '%/7-licence.jpg';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 4: agent could not delete the ID document they just uploaded'; end if;

  -- ══════════════ As the licensee ══════════════
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 5. The licensee still deletes anything, and every delete was recorded.
  delete from storage.objects where name like '%' || p1 || '%';
  get diagnostics n = row_count;
  if n <> 4 then raise exception 'FAIL 5: licensee deleted % of the 4 files left', n; end if;
  select count(*) into n from public.deletion_log where agency_id = office and what = 'file';
  if n <> 7 then raise exception 'FAIL 5: % of 7 file deletes were recorded', n; end if;

  reset role;
  raise notice 'Refused ID document: all checks passed';
end
$$;

rollback;
