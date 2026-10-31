-- ===== 0101: Files on a complaint (Adam, 30 Oct 2026) =====
--
-- REVERSAL (Adam, 30 Oct 2026).
-- WAS (16 Oct 2026): no uploads for Breaches or Complaints; a complaint email
-- is copied and pasted into the entry.
-- NOW: a complaint can have files (the complaint email, letters, photos, the
-- outcome letter). Breaches stay notes only.
--
--   1. complaint_files: one row per file on a complaint. Any number of them,
--      added at any time, while the complaint is open or after it is resolved.
--      Never deleted: "Remove" stamps who and when (removed_at, removed_by,
--      from the login and the database clock) and the app then deletes the
--      stored file. Every removal stays on record with who, when and the file
--      name. Nothing else on a row can change.
--   2. Who: the same people who see complaints (0058, Adam 9 Oct 2026): the
--      licensee in charge of an office (is_office_licensee). Not an agent, an
--      assistant, an office manager, or the agent on their own plan. Removing
--      a file is the licensee's too.
--   3. The files live in the office's own folder, one folder per complaint:
--      {office}/_complaints/{complaint}/... The database refuses a row naming
--      any other path. In Storage that folder is the licensee in charge's only,
--      to view, upload to or delete from. It is checked first, before the
--      rules that let the licensee or an office manager into the rest of the
--      office's folder (0058, 0093).
--   4. A complaint with files on it can't be deleted until its files are
--      removed (each removal recorded). The record of a removed file stays if
--      the complaint is deleted later; its complaint_id is then empty.
--   5. The end-of-subscription guard (0054) covers the new table. The 7-year
--      activity record (0054) gets each file's who and when: identifiers and
--      times only, never file names.
--
-- One new table, with its grants in this file. Nothing existing is changed or
-- deleted. Safe to run twice.

begin;

-- Order check: 0100 (the latest activity record) first.
do $$
begin
  if to_regclass('public.listing_reopen_requests') is null
     or to_regprocedure('public.build_activity_record_0058(uuid)') is null
     or to_regprocedure('public.guard_agency_not_ended()') is null then
    raise exception 'Run 0100 before this one. Nothing was changed.';
  end if;
end $$;

-- ── 1. The files ───────────────────────────────────────────────────────────
create table if not exists public.complaint_files (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references public.agencies (id) on delete cascade,
  -- Empty once the complaint itself has been deleted: the record of its
  -- removed files stays (4 above).
  complaint_id uuid references public.complaints (id) on delete set null,
  file_path    text not null unique,
  -- The name as the licensee chose it, for showing. The path carries a
  -- storage-safe copy.
  file_name    text not null check (char_length(btrim(file_name)) between 1 and 300),
  size_bytes   bigint check (size_bytes is null or size_bytes >= 0),
  added_by     uuid references public.profiles (id) on delete set null,
  added_at     timestamptz not null default now(),
  removed_at   timestamptz,
  removed_by   uuid references public.profiles (id) on delete set null,
  -- The office's own complaints folder, and nowhere else. Which complaint's
  -- folder is checked when the row is added (guard below), since the
  -- complaint can later go.
  constraint complaint_files_in_own_folder check (
    octet_length(file_path) <= 1024
    and starts_with(file_path, agency_id::text || '/_complaints/')
    and not ('..' = any (string_to_array(file_path, '/'))))
);
create index if not exists complaint_files_complaint_idx on public.complaint_files (complaint_id);
create index if not exists complaint_files_agency_idx on public.complaint_files (agency_id, added_at);

comment on table public.complaint_files is
  'Files on a complaint (0101, Adam 30 Oct 2026): the complaint email, letters, photos, the outcome letter. Licensee in charge only, like complaints. Never deleted: "Remove" stamps removed_at and removed_by, and the stored file is deleted.';

alter table public.complaint_files enable row level security;

drop policy if exists "complaint_files: licensee in charge can view" on public.complaint_files;
create policy "complaint_files: licensee in charge can view" on public.complaint_files
  for select using (agency_id = public.current_agency_id() and public.is_office_licensee());
drop policy if exists "complaint_files: licensee in charge can add" on public.complaint_files;
create policy "complaint_files: licensee in charge can add" on public.complaint_files
  for insert with check (agency_id = public.current_agency_id() and public.is_office_licensee());
drop policy if exists "complaint_files: licensee in charge can remove" on public.complaint_files;
create policy "complaint_files: licensee in charge can remove" on public.complaint_files
  for update using (agency_id = public.current_agency_id() and public.is_office_licensee())
  with check (agency_id = public.current_agency_id() and public.is_office_licensee());
-- No delete rule, on purpose: a file leaves a complaint by "Remove"
-- (removed_at), and its record stays.

-- Explicit grants. From 30 Oct 2026 Supabase stops granting new public tables
-- to the Data API automatically. Signed-in people may read, add and remove
-- (an update); never delete. Nothing here is for anon.
revoke all on table public.complaint_files from public, anon, authenticated;
grant select, insert, update on public.complaint_files to authenticated;
grant select, insert, update, delete on public.complaint_files to service_role;

-- What can't change. Who added it and when are the database's; the file, its
-- name and its complaint are fixed; a removed file is final. Removing is
-- stamped with the database clock and whoever did it.
create or replace function public.guard_complaint_file()
returns trigger
language plpgsql
security invoker
set search_path = public
as $f$
begin
  -- Security invoker on purpose: current_user is then the caller's role. The
  -- complaint's own deletion empties complaint_id as the table's owner.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.added_by := (select p.id from public.profiles p where p.id = auth.uid());
    new.added_at := now();
    if new.removed_at is not null or new.removed_by is not null then
      raise exception 'A new file can''t start removed.';
    end if;
    if new.complaint_id is null or not exists (
         select 1 from public.complaints c where c.id = new.complaint_id and c.agency_id = new.agency_id) then
      raise exception 'That complaint isn''t on this office''s register.';
    end if;
    if not starts_with(new.file_path, new.agency_id::text || '/_complaints/' || new.complaint_id::text || '/') then
      raise exception 'A complaint''s files go in its own folder.';
    end if;
    return new;
  end if;
  if old.removed_at is not null then
    raise exception 'This file has been removed and its record can''t be changed.';
  end if;
  if new.id is distinct from old.id or new.agency_id is distinct from old.agency_id
     or new.complaint_id is distinct from old.complaint_id
     or new.file_path is distinct from old.file_path or new.file_name is distinct from old.file_name
     or new.size_bytes is distinct from old.size_bytes
     or new.added_by is distinct from old.added_by or new.added_at is distinct from old.added_at then
    raise exception 'This change is not allowed.';
  end if;
  if new.removed_at is not null then
    new.removed_at := now();
    new.removed_by := (select p.id from public.profiles p where p.id = auth.uid());
  elsif new.removed_by is not null then
    raise exception 'This change is not allowed.';
  end if;
  return new;
end
$f$;
revoke execute on function public.guard_complaint_file() from public, anon, authenticated;
drop trigger if exists complaint_files_guard on public.complaint_files;
create trigger complaint_files_guard
  before insert or update on public.complaint_files
  for each row execute function public.guard_complaint_file();

-- The end-of-subscription guard (0054): nothing added, removed or changed once
-- the subscription has ended.
drop trigger if exists complaint_files_not_ended_guard on public.complaint_files;
create trigger complaint_files_not_ended_guard
  before insert or update or delete on public.complaint_files
  for each row execute function public.guard_agency_not_ended();

-- ── 2. A complaint with files on it keeps them until they are removed ──────
-- Deleting the complaint would otherwise take its files with it, unrecorded.
-- Only for people signed in to the app: the end-of-subscription deletion
-- (service role) removes everything as before.
create or replace function public.guard_complaint_delete_with_files()
returns trigger
language plpgsql
security invoker
set search_path = public
as $f$
begin
  if current_user not in ('authenticated', 'anon') then
    return old;
  end if;
  if exists (select 1 from public.complaint_files f where f.complaint_id = old.id and f.removed_at is null) then
    raise exception 'This complaint has files on it. Remove its files first; each removal is recorded.';
  end if;
  return old;
end
$f$;
revoke execute on function public.guard_complaint_delete_with_files() from public, anon, authenticated;
drop trigger if exists complaints_files_first on public.complaints;
create trigger complaints_files_first
  before delete on public.complaints
  for each row execute function public.guard_complaint_delete_with_files();

-- ── 3. The complaints folder in Storage: the licensee in charge's only ─────
-- Both functions exactly as 0093 left them, with the complaints folder checked
-- first, before the licensee's and office manager's way into the rest of the
-- office's folder.
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
  if v_seg[2] = '_complaints' then
    return public.is_office_licensee();
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

create or replace function public.evidence_path_writable(p_name text)
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
  if v_seg[2] = '_complaints' then
    return public.is_office_licensee();
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
  -- A new listing's files are staged here before the listing exists; a
  -- signer's stamped copy of a document they signed goes in _signoffs/signed.
  if v_seg[2] = '_pending' then
    return true;
  end if;
  if v_seg[2] = '_signoffs' and v_seg[3] = 'signed' then
    return true;
  end if;
  return false;
end
$function$;

-- Deleting is unchanged (0058: the licensee). A file has to be readable to be
-- deleted, so in the complaints folder that is the licensee in charge only.

-- ── 4. The 7-year activity record ──────────────────────────────────────────
-- Exactly as 0100 left it, with each complaint file's who and when added:
-- identifiers and times only, never the file's name.
create or replace function public.build_activity_record(p_agency_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.build_activity_record_0058(p_agency_id) || jsonb_build_object(
    'send_backs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'listing', s.property_id, 'by', s.sent_back_by,
        'via', case when s.sent_back_by is null then 'link' else 'app' end,
        'at', s.sent_back_at,
        'cards', coalesce((select jsonb_agg(jsonb_build_object(
            'card', i.item_key, 'may_be_breach', i.may_be_breach,
            'cleared_by', i.cleared_by, 'cleared_at', i.cleared_at) order by i.item_key)
          from public.listing_send_back_items i where i.send_back_id = s.id), '[]'))
        order by s.sent_back_at)
      from public.listing_send_backs s where s.agency_id = p_agency_id), '[]'),
    'superseded_agent_signatures', coalesce((select jsonb_agg(jsonb_build_object(
        'listing', g.property_id, 'signer', g.signed_by, 'signed_at', g.signed_at,
        'superseded_at', g.superseded_at, 'send_back', g.send_back_id) order by g.superseded_at)
      from public.superseded_agent_signatures g where g.agency_id = p_agency_id), '[]'),
    'licensee_contact_changes', coalesce((select jsonb_agg(jsonb_build_object(
        'by', c.changed_by, 'at', c.changed_at) order by c.changed_at)
      from public.licensee_contact_changes c where c.agency_id = p_agency_id), '[]'),
    'sg_read_confirmations', coalesce((select jsonb_agg(jsonb_build_object(
        'by', r.confirmed_by, 'version', r.annexure_version, 'at', r.confirmed_at) order by r.confirmed_at)
      from public.sg_read_confirmations r where r.agency_id = p_agency_id), '[]'),
    'agency_name_changes', coalesce((select jsonb_agg(jsonb_build_object(
        'name', n.name_kind, 'via', n.via, 'by', n.changed_by, 'at', n.changed_at) order by n.changed_at)
      from public.agency_name_changes n where n.agency_id = p_agency_id), '[]'),
    'agent_acknowledgements', coalesce((select jsonb_agg(jsonb_build_object(
        'by', k.profile_id, 'version', k.wording_version, 'at', k.confirmed_at,
        'document', k.signoff_document_id) order by k.confirmed_at)
      from public.agent_acknowledgements k where k.agency_id = p_agency_id), '[]'),
    'signoff_cancellations', coalesce((select jsonb_agg(jsonb_build_object(
        'listing', x.property_id, 'card', x.item_key,
        'given_by', coalesce(x.card ->> 'completed_by', x.card -> 'data' ->> 'signedBy'),
        'given_at', x.card -> 'data' ->> 'signedAt',
        'via', case when x.card -> 'data' ->> 'signedVia' = 'link' then 'link' else 'app' end,
        'cancelled_by', x.cancelled_by, 'cancelled_at', x.cancelled_at,
        'because_card', x.because_item_key, 'because', x.because) order by x.cancelled_at)
      from public.listing_signoff_cancellations x where x.agency_id = p_agency_id), '[]'),
    'reopen_requests', coalesce((select jsonb_agg(jsonb_build_object(
        'listing', q.property_id, 'card', q.item_key, 'by', q.requested_by, 'at', q.requested_at,
        'status', q.status, 'answered_by', q.answered_by, 'answered_at', q.answered_at) order by q.requested_at)
      from public.listing_reopen_requests q where q.agency_id = p_agency_id), '[]'),
    'complaint_files', coalesce((select jsonb_agg(jsonb_build_object(
        'complaint', f.complaint_id, 'added_by', f.added_by, 'added_at', f.added_at,
        'removed_by', f.removed_by, 'removed_at', f.removed_at) order by f.added_at)
      from public.complaint_files f where f.agency_id = p_agency_id), '[]'));
$$;
revoke execute on function public.build_activity_record(uuid) from public, anon, authenticated;
grant execute on function public.build_activity_record(uuid) to service_role;

commit;

-- What it shows when it has run: true, true, true, true.
select to_regclass('public.complaint_files') is not null as complaint_files_ready,
       has_table_privilege('authenticated', 'public.complaint_files', 'select')
         and has_table_privilege('authenticated', 'public.complaint_files', 'insert')
         and has_table_privilege('authenticated', 'public.complaint_files', 'update')
         and not has_table_privilege('authenticated', 'public.complaint_files', 'delete')
         and not has_table_privilege('anon', 'public.complaint_files', 'select') as grants_right,
       exists (select 1 from pg_trigger where tgname = 'complaint_files_guard')
         and exists (select 1 from pg_trigger where tgname = 'complaint_files_not_ended_guard')
         and exists (select 1 from pg_trigger where tgname = 'complaints_files_first') as guards_in_place,
       position('_complaints' in pg_get_functiondef('public.evidence_path_readable(text)'::regprocedure)) > 0
         and position('_complaints' in pg_get_functiondef('public.evidence_path_writable(text)'::regprocedure)) > 0
         as complaints_folder_licensee_only;
