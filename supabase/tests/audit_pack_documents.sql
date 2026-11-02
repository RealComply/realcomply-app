-- 0106: who uploaded each file on a listing, and the private holding area for
-- finished audit packs (Adam, 2 Nov 2026). Made-up offices only, rolled back.
-- Ends with "audit pack documents: all checks passed", or stops at the first FAIL.

begin;

do $$
declare
  o1 uuid := gen_random_uuid();
  o2 uuid := gen_random_uuid();
  a uuid := gen_random_uuid();   -- agent in o1, whose listing p is
  b uuid := gen_random_uuid();   -- another agent in o1
  l uuid := gen_random_uuid();   -- o1's licensee in charge
  x uuid := gen_random_uuid();   -- an agent in o2
  p uuid;
  n integer;
  r record;
begin
  insert into auth.users (id, email) values (a, 'apd-a@example.invalid'), (b, 'apd-b@example.invalid'), (l, 'apd-l@example.invalid'), (x, 'apd-x@example.invalid');
  insert into public.agencies (id, name, plan, status) values (o1, 'APD Office (made up)', 'office_1', 'active'), (o2, 'APD Other (made up)', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge) values
    (a, o1, 'Ana Agent', 'apd-a@example.invalid', true, false),
    (b, o1, 'Ben Agent', 'apd-b@example.invalid', true, false),
    (l, o1, 'Lee Licensee', 'apd-l@example.invalid', true, true),
    (x, o2, 'Xan Elsewhere', 'apd-x@example.invalid', true, false);
  insert into public.properties (agency_id, created_by, address) values (o1, a, '1 Pack St (made up)') returning id into p;
  insert into storage.buckets (id, name) values ('compliance-evidence', 'compliance-evidence') on conflict do nothing;
  insert into storage.objects (bucket_id, name, owner_id, created_at) values
    ('compliance-evidence', o1 || '/' || p || '/a3/1-agreement.pdf', a::text, '2026-10-01T01:00:00Z'),
    ('compliance-evidence', o1 || '/' || p || '/b1/2-contract.pdf', l::text, '2026-10-02T01:00:00Z'),
    ('compliance-evidence', o1 || '/' || gen_random_uuid() || '/a3/3-other-listing.pdf', a::text, now()),
    ('compliance-evidence', o2 || '/x/1-elsewhere.pdf', x::text, now());

  -- 1. The listing's agent sees who uploaded each of its files, and when.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.listing_file_uploads(p);
  if n <> 2 then raise exception 'FAIL 1: % files, expected the listing''s 2', n; end if;
  select * into r from public.listing_file_uploads(p) u where u.path like '%/b1/%';
  if r.uploaded_by_name <> 'Lee Licensee' or r.uploaded_at <> '2026-10-02T01:00:00Z'::timestamptz then
    raise exception 'FAIL 1b: % ', row_to_json(r); end if;
  reset role;

  -- 2. The licensee sees them too; another agent who can't see the listing doesn't.
  perform set_config('request.jwt.claims', json_build_object('sub', l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.listing_file_uploads(p);
  if n <> 2 then raise exception 'FAIL 2: the licensee sees % files', n; end if;
  reset role;

  -- 3. Another office sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.listing_file_uploads(p);
  if n <> 0 then raise exception 'FAIL 3: another office sees % files', n; end if;
  reset role;

  -- 4. The server's own key reads them.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  select count(*) into n from public.listing_file_uploads(p);
  if n <> 2 then raise exception 'FAIL 4: the server sees % files', n; end if;
  reset role;

  -- 5. Not for anyone signed out; the holding area is private.
  if has_function_privilege('anon', 'public.listing_file_uploads(uuid)', 'execute') then
    raise exception 'FAIL 5: anon may call it'; end if;
  if not exists (select 1 from storage.buckets where id = 'audit-packs' and public = false and allowed_mime_types = array['application/pdf']) then
    raise exception 'FAIL 5b: the holding area is not a private PDF bucket'; end if;
  -- 6. It takes a pack of up to 500 MB (lib/pdf/audit-pack-store.ts, AUDIT_PACK_MAX_BYTES).
  if not exists (select 1 from storage.buckets where id = 'audit-packs' and file_size_limit = 500 * 1024 * 1024) then
    raise exception 'FAIL 6: the holding area does not take a 500 MB pack'; end if;

  raise notice 'audit pack documents: all checks passed';
end
$$;

rollback;
