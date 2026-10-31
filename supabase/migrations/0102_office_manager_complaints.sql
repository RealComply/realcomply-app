-- ===== 0102: Office managers on the Complaints register: adding and read only (Adam, 31 Oct 2026) =====
--
-- DECISION (Adam, 31 Oct 2026). 0093 left the complaints register with the
-- licensee in charge as "not decided yet". Asked whether an office manager
-- the licensee has approved should have it too, Adam said: "adding and read
-- only".
--
-- An approved office manager (is_office_manager(), 0093) now:
--   1. sees the office's whole complaints register, and the files on each
--      complaint, removed ones included with who removed them and when;
--   2. opens and downloads those files;
--   3. logs a new complaint. It starts Open, logged by them;
--   4. adds files to any complaint on the register, open or resolved.
-- Still the licensee in charge's only: changing a complaint (Review,
-- Resolve), deleting one, removing a file, and the resolution target (0093).
--
-- In Storage an office manager can open a complaint's files and add new ones,
-- but never replace, move or delete one. One exception, the same one 0060 and
-- 0075 made for a licence and a CPD certificate: a file they uploaded in the
-- last 15 minutes that never made it onto the register (refused as empty or
-- damaged, or the save failed) can be taken away again, so nothing sits in a
-- complaint's folder unrecorded. Every deletion is logged, as before (0058).
--
-- Rules are added for the office manager only; nobody else's access changes.
-- evidence_path_readable() is exactly as 0101 left it, with the office
-- manager added for the complaints folder. evidence_path_writable() is not
-- touched, so replacing or moving a complaint's file stays the licensee's.
-- No new table, so no new grants; the two new functions carry theirs.
-- Nothing is deleted. Safe to run twice.

begin;

-- Order check: 0101 (files on a complaint) first.
do $$
begin
  if to_regclass('public.complaint_files') is null
     or to_regprocedure('public.guard_complaint_file()') is null
     or to_regprocedure('public.is_office_manager()') is null then
    raise exception 'Run 0101 before this one. Nothing was changed.';
  end if;
end $$;

-- ── 1. The register: read it, and log a new complaint ──────────────────────
drop policy if exists "complaints: office manager can view" on public.complaints;
create policy "complaints: office manager can view" on public.complaints
  for select using (agency_id = public.current_agency_id() and public.is_office_manager());

-- A new complaint starts Open, logged by whoever logs it: logging one already
-- resolved would be resolving it, which stays the licensee's. Linked to a
-- listing only where it is one the office manager can open themselves
-- (every listing in the office is still the licensee's, 0093).
drop policy if exists "complaints: office manager can add" on public.complaints;
create policy "complaints: office manager can add" on public.complaints
  for insert with check (
    agency_id = public.current_agency_id() and public.is_office_manager()
    and created_by = auth.uid()
    and status = 'open' and resolved_date is null
    and (property_id is null or public.can_see_property(property_id)));
-- No update or delete rule for the office manager, on purpose: Review,
-- Resolve and Remove stay with the licensee in charge.

-- ── 2. The files on a complaint: read them, and add ────────────────────────
-- Who added a file and when are still the database's, and a file still goes
-- in its own complaint's folder in this office (guard_complaint_file, 0101).
drop policy if exists "complaint_files: office manager can view" on public.complaint_files;
create policy "complaint_files: office manager can view" on public.complaint_files
  for select using (agency_id = public.current_agency_id() and public.is_office_manager());
drop policy if exists "complaint_files: office manager can add" on public.complaint_files;
create policy "complaint_files: office manager can add" on public.complaint_files
  for insert with check (agency_id = public.current_agency_id() and public.is_office_manager());
-- No update rule for the office manager, on purpose: removing a file stays
-- the licensee's.

-- ── 3. The complaints folder in Storage ────────────────────────────────────
-- Opening a complaint's files: exactly as 0101 left it, with the office
-- manager added for the complaints folder.
create or replace function public.evidence_path_readable(p_name text)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_seg text[] := storage.foldername(p_name);
begin
  if public.current_agency_id() is null or v_seg[1] is distinct from public.current_agency_id()::text then
    return false;
  end if;
  -- 0101: complaint files, the licensee in charge of the office only.
  -- 0102: and an office manager, to read (Adam, 31 Oct 2026).
  if v_seg[2] = '_complaints' then
    return public.is_office_licensee() or public.is_office_manager();
  end if;
  if public.acts_as_licensee() then
    return true;
  end if;
  if v_seg[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return public.can_see_property(v_seg[2]::uuid);
  end if;
  -- 0093: the office's own records, for an office manager.
  if public.is_office_manager() then
    return true;
  end if;
  if v_seg[2] in ('_licences', '_cpd') then
    return v_seg[3] = auth.uid()::text;
  end if;
  if v_seg[2] in ('_brand', '_sg-manual', '_pending') then
    return true;
  end if;
  if v_seg[2] = '_signoffs' then
    return exists (
      select 1 from public.signoff_documents d
       where d.agency_id = public.current_agency_id()
         and (d.file_path = p_name or d.signed_file_path = p_name)
         and (d.uploaded_by = auth.uid()
              or exists (select 1 from public.signoff_signatures s
                          where s.document_id = d.id and s.signer_id = auth.uid())));
  end if;
  return false;
end
$function$;

-- Adding a new file, for an office manager: straight inside the folder of a
-- complaint on this office's register, {office}/_complaints/{complaint}/{file}.
-- An upload that would replace a file asks the update rule too, and that
-- still asks evidence_path_writable(), which in the complaints folder is the
-- licensee in charge's only. The app never replaces one: every upload has a
-- name of its own.
create or replace function public.complaint_file_addable(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $f$
declare
  v_seg text[] := storage.foldername(p_name);
begin
  if public.current_agency_id() is null
     or coalesce(array_length(v_seg, 1), 0) <> 3
     or v_seg[1] is distinct from public.current_agency_id()::text
     or v_seg[2] is distinct from '_complaints'
     or not public.is_office_manager() then
    return false;
  end if;
  return exists (select 1 from public.complaints c
                  where c.agency_id = public.current_agency_id()
                    and c.id::text = v_seg[3]);
end
$f$;
revoke execute on function public.complaint_file_addable(text) from public, anon;
grant execute on function public.complaint_file_addable(text) to authenticated;

drop policy if exists "compliance-evidence: office manager can add complaint files" on storage.objects;
create policy "compliance-evidence: office manager can add complaint files" on storage.objects
  for insert with check (
    bucket_id = 'compliance-evidence'
    and public.complaint_file_addable(name));

-- Their own upload that never made it onto the register, within 15 minutes.
-- A file on the register, or one ever removed from it, is never deletable
-- this way: its complaint_files row stays for good (0101).
create or replace function public.own_complaint_upload_deletable(p_name text, p_owner text, p_created_at timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $f$
begin
  if auth.uid() is null or p_owner is distinct from auth.uid()::text then
    return false;
  end if;
  if p_created_at is null or p_created_at <= now() - interval '15 minutes' then
    return false;
  end if;
  if not public.complaint_file_addable(p_name) then
    return false;
  end if;
  return not exists (select 1 from public.complaint_files f where f.file_path = p_name)
     and not exists (select 1 from public.evidence_files_once_on_record r where r.name = p_name);
end
$f$;
revoke execute on function public.own_complaint_upload_deletable(text, text, timestamptz) from public, anon;
grant execute on function public.own_complaint_upload_deletable(text, text, timestamptz) to authenticated;

drop policy if exists "compliance-evidence: own unrecorded complaint file can be removed" on storage.objects;
create policy "compliance-evidence: own unrecorded complaint file can be removed" on storage.objects
  for delete using (
    bucket_id = 'compliance-evidence'
    and public.own_complaint_upload_deletable(name, coalesce(owner_id, owner::text), created_at));

commit;

-- What it shows when it has run: true, true, true, true.
select
  exists (select 1 from pg_policy where polrelid = 'public.complaints'::regclass
           and polname = 'complaints: office manager can view')
    and exists (select 1 from pg_policy where polrelid = 'public.complaints'::regclass
                 and polname = 'complaints: office manager can add')
    and exists (select 1 from pg_policy where polrelid = 'public.complaint_files'::regclass
                 and polname = 'complaint_files: office manager can view')
    and exists (select 1 from pg_policy where polrelid = 'public.complaint_files'::regclass
                 and polname = 'complaint_files: office manager can add')
    as office_manager_reads_and_adds,
  not exists (select 1 from pg_policies
               where schemaname = 'public' and tablename in ('complaints', 'complaint_files')
                 and cmd in ('UPDATE', 'DELETE', 'ALL')
                 and coalesce(qual, '') || coalesce(with_check, '') like '%is_office_manager%')
    as changes_stay_with_the_licensee,
  exists (select 1 from pg_policy where polrelid = 'storage.objects'::regclass
           and polname = 'compliance-evidence: office manager can add complaint files')
    and exists (select 1 from pg_policy where polrelid = 'storage.objects'::regclass
                 and polname = 'compliance-evidence: own unrecorded complaint file can be removed')
    and position('return public.is_office_licensee() or public.is_office_manager();'
                 in pg_get_functiondef('public.evidence_path_readable(text)'::regprocedure)) > 0
    as complaints_folder_rules_in_place,
  position('return public.is_office_licensee();'
           in pg_get_functiondef('public.evidence_path_writable(text)'::regprocedure)) > 0
    as replacing_stays_with_the_licensee;
