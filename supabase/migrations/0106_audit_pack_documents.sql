-- ===== 0106: The audit pack holds every document on the listing (Adam, 2 Nov 2026) =====
--
-- WHY. The office keeps these records for 3 years and hands them to Fair
-- Trading on request. The pack has to stand on its own, offline, so every
-- document on the listing now goes inside the one PDF, with a contents page
-- (src/lib/pdf/compliance-record.ts). Two things the app needs for that:
--
--   1. WHO UPLOADED EACH FILE, AND WHEN, for the contents page. Only the Power
--      of Attorney card records it on the card. Storage records the uploader
--      and the time for every file (115 of 115 listing files on 2 Nov 2026),
--      but the Storage API doesn't hand the uploader back. listing_file_uploads()
--      reads it, for one listing, for someone who can see that listing.
--
--   2. A PRIVATE HOLDING AREA FOR THE FINISHED PACK (Adam, 2 Nov 2026: yes).
--      A pack with every document inside can be tens of megabytes, more than
--      a Vercel function should send back. The finished PDF is saved in the
--      'audit-packs' bucket and the browser downloads it from there through
--      a link that lasts a few minutes. The copy is deleted the next day
--      (src/lib/pdf/audit-pack-store.ts). Nobody signed in can read or write
--      the bucket: no policies on it, so only the server, with its own key.
--      Same Supabase project, in Sydney; nothing goes anywhere new.
--      It takes one PDF of up to 500 MB. The app puts up to 450 MB of
--      documents in a pack and names any that don't fit.
--
-- BEFORE RUNNING: the project-wide upload limit (Supabase: Storage, Settings,
-- Global file size limit) must be at least 500 MB, or it caps this bucket.
-- Raising it changes nothing for uploads: the evidence bucket keeps its own
-- 150 MB limit (0056).
--
-- No new tables. Safe to run twice.

begin;

-- ── 1. Who uploaded each file on a listing, and when ───────────────────────
-- Files in the listing's own folder only ({agency}/{listing}/...). For the
-- signed-in: only a listing they can see, in their own office. The server's
-- own key (service_role) reads any, as it reads the files themselves.
create or replace function public.listing_file_uploads(p_property_id uuid)
returns table (path text, uploaded_by uuid, uploaded_by_name text, uploaded_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_agency uuid;
begin
  select p.agency_id into v_agency from public.properties p where p.id = p_property_id;
  if v_agency is null then
    return;
  end if;
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '') <> 'service_role' then
    if v_agency is distinct from public.current_agency_id() or not public.can_see_property(p_property_id) then
      return;
    end if;
  end if;

  return query
    select o.name::text,
           pr.id,
           coalesce(nullif(btrim(pr.full_name), ''), pr.email)::text,
           o.created_at
      from storage.objects o
      left join public.profiles pr
        on pr.id::text = coalesce(o.owner_id, o.owner::text)
       and pr.agency_id = v_agency
     where o.bucket_id = 'compliance-evidence'
       and o.name like v_agency::text || '/' || p_property_id::text || '/%';
end
$$;
revoke execute on function public.listing_file_uploads(uuid) from public, anon;
grant execute on function public.listing_file_uploads(uuid) to authenticated, service_role;

-- ── 2. The holding area for finished packs ─────────────────────────────────
-- Private, PDFs only, up to 500 MB each. No policies: only the server's own
-- key reaches it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audit-packs', 'audit-packs', false, 500 * 1024 * 1024, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 500 * 1024 * 1024,
      allowed_mime_types = array['application/pdf'];

commit;

-- ── Check ──────────────────────────────────────────────────────────────────
-- One row, every value true.
select
  to_regprocedure('public.listing_file_uploads(uuid)') is not null
    and has_function_privilege('authenticated', 'public.listing_file_uploads(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.listing_file_uploads(uuid)', 'execute') as uploads_lookup_ready,
  exists (select 1 from storage.buckets
           where id = 'audit-packs' and public = false and file_size_limit = 524288000) as holding_area_private;
