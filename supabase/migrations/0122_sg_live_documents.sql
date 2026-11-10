-- ===== 0122: Supervision guidelines and operational procedures as a live document, part 1 =====
--
-- Adam signed off the mockup on 6 November 2026 ("Supervision Guidelines
-- Live"); Master queued it as item 4 on 10 November; Adam: "go ahead with
-- part 1".
--
-- Fair Trading's Supervision Guidelines (in force 1 July 2024):
--   2.1.2: operational procedures should be reviewed and appropriately
--          revised at least every 12 months (parts 2 to 4 build on this).
--   2.1.3: they must (a) identify the agency business, (b) identify the
--          licensee in charge with responsibility for them, and (c)
--          identify the relevant laws, considering at least 22 Acts.
--
-- WAS: an office uploads its manual as a file (sg_manual_versions, 0005)
-- and every staff member signs each version (0009). Nothing reads it.
--
-- NOW: the office's document is read into sections, checked against
-- 2.1.3 (flags only: saving is never blocked), and saved as the live
-- document. Part 1 is upload, read, check and save. Quick amendments,
-- a new full version compared, the annual review and the PDF come later.
--
-- Two new tables:
--   * sg_documents: one row per document read. It is read ('reading'),
--     then waits to be checked ('draft', or 'read_failed'), then the
--     licensee in charge or an office manager picks what kind of
--     document it is, confirms the version and saves it ('live'). The
--     one before it becomes 'replaced'. A draft can be thrown away
--     ('discarded'). One live document an office, and one open draft.
--   * sg_document_sections: the sections of each document, in order, each
--     with its number, title and paragraphs.
--
-- The 4 manuals already on file (Master, 10 Nov 2026: "A"): RealComply
-- reads each office's newest manual into a draft (from_file_on_record).
-- It stays a draft until the licensee in charge or an office manager
-- checks it, picks the document type, confirms the version and saves it.
-- Until then the current file stays exactly as it is. The read is done by
-- the app's scheduled job with the service key, after this has run; this
-- SQL reads no file and changes no existing row.
--
-- Who can do what:
--   * Everyone in the office reads the live document (and earlier ones).
--   * Drafts are seen only by whoever runs the office (runs_office(): the
--     licensee in charge, an office manager, an agent on their own plan).
--   * Starting a read, saving, throwing away and reading again go through
--     four functions that check runs_office(), the office's own folder,
--     and that the office's subscription hasn't ended.
--   * The reading itself is written by the app with the service key.
--   * Nobody deletes a row.
--
-- Saving a newly uploaded document also files it as a new SG Manual
-- version (sg_manual_versions), so every staff member is asked to sign it
-- exactly as today. Saving one of the 4 manuals already on file doesn't:
-- that file is already the current version and was already sent to sign.

begin;

create table if not exists public.sg_documents (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  -- The SG Manual version this file is: one of the manuals already on file,
  -- or, for a new upload, the version filed when it's saved.
  manual_version_id uuid references public.sg_manual_versions(id) on delete set null,
  file_path text not null,
  file_name text not null check (char_length(file_name) between 1 and 300),
  status text not null default 'reading'
    check (status in ('reading', 'draft', 'read_failed', 'live', 'replaced', 'discarded')),
  -- Picked on save: exactly one of the three kinds in the mockup.
  doc_type text check (doc_type in ('sg_and_procedures', 'sg', 'procedures')),
  -- Confirmed on save; as read from the document before that.
  version_label text check (version_label is null or char_length(version_label) between 1 and 40),
  version_read text check (version_read is null or char_length(version_read) <= 40),
  -- The reading, kept part by part so a long PDF is never read twice.
  read_parts jsonb not null default '[]'::jsonb,
  read_total_parts integer check (read_total_parts is null or read_total_parts between 1 and 200),
  read_claimed_until timestamptz,
  read_error text check (read_error is null or char_length(read_error) <= 500),
  read_at timestamptz,
  -- The 2.1.3 flags, worked out when the read finishes.
  checks jsonb,
  from_file_on_record boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  saved_by uuid references public.profiles(id) on delete set null,
  saved_by_name text,
  saved_at timestamptz,
  constraint sg_documents_file_in_own_folder check (public.path_in_agency_folder(file_path, agency_id)),
  constraint sg_documents_saved_has_type check (
    status not in ('live', 'replaced') or (doc_type is not null and version_label is not null and saved_at is not null)
  )
);

create index if not exists sg_documents_agency on public.sg_documents (agency_id, created_at desc);
-- One live document an office, and one draft being read or waiting.
create unique index if not exists sg_documents_one_live on public.sg_documents (agency_id) where status = 'live';
create unique index if not exists sg_documents_one_open on public.sg_documents (agency_id)
  where status in ('reading', 'draft', 'read_failed');

create table if not exists public.sg_document_sections (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.sg_documents(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  position integer not null check (position >= 0),
  number text check (number is null or char_length(number) <= 20),
  title text not null check (char_length(title) between 1 and 300),
  paragraphs text[] not null default '{}',
  unique (document_id, position)
);

create index if not exists sg_document_sections_document on public.sg_document_sections (document_id, position);

alter table public.sg_documents enable row level security;
alter table public.sg_document_sections enable row level security;

drop policy if exists "sg_documents: office reads the live document, whoever runs it reads drafts" on public.sg_documents;
create policy "sg_documents: office reads the live document, whoever runs it reads drafts" on public.sg_documents
  for select using (
    agency_id = public.current_agency_id()
    and (status in ('live', 'replaced') or public.runs_office())
  );

drop policy if exists "sg_document_sections: as their document" on public.sg_document_sections;
create policy "sg_document_sections: as their document" on public.sg_document_sections
  for select using (
    agency_id = public.current_agency_id()
    and exists (
      select 1 from public.sg_documents d
      where d.id = document_id
        and d.agency_id = sg_document_sections.agency_id
        and (d.status in ('live', 'replaced') or public.runs_office())
    )
  );

-- Grants (every new table in public carries its own): read only for a
-- signed-in person, through the policies above. Every change goes through
-- the functions below or the app's service key.
revoke all on table public.sg_documents from public, anon, authenticated;
grant select on public.sg_documents to authenticated;
grant select, insert, update, delete on public.sg_documents to service_role;

revoke all on table public.sg_document_sections from public, anon, authenticated;
grant select on public.sg_document_sections to authenticated;
grant select, insert, update, delete on public.sg_document_sections to service_role;

-- An office whose subscription has ended changes nothing (0054).
drop trigger if exists sg_documents_not_ended_guard on public.sg_documents;
create trigger sg_documents_not_ended_guard before insert or update or delete on public.sg_documents
  for each row execute function public.guard_agency_not_ended();
drop trigger if exists sg_document_sections_not_ended_guard on public.sg_document_sections;
create trigger sg_document_sections_not_ended_guard before insert or update or delete on public.sg_document_sections
  for each row execute function public.guard_agency_not_ended();

-- ── Start reading an uploaded file. ──────────────────────────────────────
-- Word (.docx) or PDF, already uploaded to the office's own _sg-manual
-- folder. Any draft still open (being read, waiting, or failed) is thrown
-- away: the newest upload is the one to check.
create or replace function public.start_sg_document(p_file_path text, p_file_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_name text := btrim(coalesce(p_file_name, ''));
  v_id uuid;
begin
  if v_agency is null or not public.runs_office() then
    raise exception 'Only the licensee in charge or an office manager can upload the supervision guidelines.';
  end if;
  if public.agency_has_ended(v_agency) then
    raise exception 'This office''s subscription has ended.';
  end if;
  if not public.path_in_agency_folder(p_file_path, v_agency) or position('/_sg-manual/' in p_file_path) = 0 then
    raise exception 'That file isn''t in this office''s supervision guidelines folder.';
  end if;
  if v_name = '' or char_length(v_name) > 300 or lower(v_name) !~ '\.(pdf|docx)$' then
    raise exception 'Upload a Word (.docx) or PDF file.';
  end if;

  update public.sg_documents set status = 'discarded', read_claimed_until = null
    where agency_id = v_agency and status in ('reading', 'draft', 'read_failed');

  insert into public.sg_documents (agency_id, file_path, file_name, status, created_by)
    values (v_agency, p_file_path, v_name, 'reading', auth.uid())
    returning id into v_id;
  return v_id;
end;
$$;

-- ── Save a draft as the live document. ───────────────────────────────────
-- The person picks the document type (exactly one) and confirms the
-- version. The live document before it becomes 'replaced'. A new upload
-- is also filed as a new SG Manual version (staff are then asked to sign
-- it, as today); one of the manuals already on file isn't filed again.
create or replace function public.save_sg_document(p_id uuid, p_doc_type text, p_version_label text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_doc public.sg_documents%rowtype;
  v_label text := btrim(coalesce(p_version_label, ''));
  v_manual uuid;
  v_new_file boolean := false;
  v_name text;
begin
  if v_agency is null or not public.runs_office() then
    raise exception 'Only the licensee in charge or an office manager can save the supervision guidelines.';
  end if;
  select * into v_doc from public.sg_documents where id = p_id and agency_id = v_agency for update;
  if not found then
    raise exception 'That document isn''t in this office.';
  end if;
  if v_doc.status <> 'draft' then
    raise exception 'That document has already been saved or thrown away.';
  end if;
  if p_doc_type is null or p_doc_type not in ('sg_and_procedures', 'sg', 'procedures') then
    raise exception 'Choose what kind of document this is.';
  end if;
  if v_label = '' then
    raise exception 'Confirm the version number.';
  end if;
  if char_length(v_label) > 40 then
    raise exception 'Keep the version number to 40 characters.';
  end if;

  select nullif(btrim(full_name), '') into v_name from public.profiles where id = auth.uid();

  update public.sg_documents set status = 'replaced'
    where agency_id = v_agency and status = 'live';

  v_manual := v_doc.manual_version_id;
  if v_manual is null then
    insert into public.sg_manual_versions (agency_id, version_label, file_path, file_name, uploaded_by)
      values (v_agency, v_label, v_doc.file_path, v_doc.file_name, auth.uid())
      returning id into v_manual;
    v_new_file := true;
  else
    update public.sg_manual_versions set version_label = v_label
      where id = v_manual and agency_id = v_agency and version_label is null;
  end if;

  update public.sg_documents set
    status = 'live',
    doc_type = p_doc_type,
    version_label = v_label,
    manual_version_id = v_manual,
    saved_by = auth.uid(),
    saved_by_name = v_name,
    saved_at = now()
  where id = p_id;

  return jsonb_build_object(
    'new_file', v_new_file,
    'file_path', v_doc.file_path,
    'file_name', v_doc.file_name,
    'version_label', v_label
  );
end;
$$;

-- ── Throw a draft away. ──────────────────────────────────────────────────
-- The file it was read from stays where it is.
create or replace function public.discard_sg_document(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
begin
  if v_agency is null or not public.runs_office() then
    raise exception 'Only the licensee in charge or an office manager can do that.';
  end if;
  update public.sg_documents set status = 'discarded', read_claimed_until = null
    where id = p_id and agency_id = v_agency and status in ('reading', 'draft', 'read_failed');
  if not found then
    raise exception 'That draft has already been saved or thrown away.';
  end if;
end;
$$;

-- ── Read a failed document again. ────────────────────────────────────────
create or replace function public.retry_sg_document(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
begin
  if v_agency is null or not public.runs_office() then
    raise exception 'Only the licensee in charge or an office manager can do that.';
  end if;
  update public.sg_documents set
    status = 'reading', read_parts = '[]'::jsonb, read_total_parts = null,
    read_error = null, read_claimed_until = null
  where id = p_id and agency_id = v_agency and status = 'read_failed';
  if not found then
    raise exception 'That document isn''t waiting to be read again.';
  end if;
end;
$$;

revoke execute on function public.start_sg_document(text, text) from public, anon;
revoke execute on function public.save_sg_document(uuid, text, text) from public, anon;
revoke execute on function public.discard_sg_document(uuid) from public, anon;
revoke execute on function public.retry_sg_document(uuid) from public, anon;
grant execute on function public.start_sg_document(text, text) to authenticated, service_role;
grant execute on function public.save_sg_document(uuid, text, text) to authenticated, service_role;
grant execute on function public.discard_sg_document(uuid) to authenticated, service_role;
grant execute on function public.retry_sg_document(uuid) to authenticated, service_role;

commit;

-- ── Check query (run after; every column should be true) ─────────────────
-- select
--   to_regclass('public.sg_documents') is not null                                      as documents_table,
--   to_regclass('public.sg_document_sections') is not null                              as sections_table,
--   (select relrowsecurity from pg_class where oid = 'public.sg_documents'::regclass)
--     and (select relrowsecurity from pg_class where oid = 'public.sg_document_sections'::regclass) as rls_on,
--   (select count(*) from pg_policies where schemaname = 'public'
--      and tablename in ('sg_documents', 'sg_document_sections')) = 2                    as two_read_policies,
--   has_table_privilege('authenticated', 'public.sg_documents', 'select')
--     and not has_table_privilege('authenticated', 'public.sg_documents', 'insert')
--     and not has_table_privilege('authenticated', 'public.sg_documents', 'update')
--     and not has_table_privilege('authenticated', 'public.sg_document_sections', 'insert') as signed_in_read_only,
--   not has_table_privilege('anon', 'public.sg_documents', 'select')                    as signed_out_nothing,
--   has_table_privilege('service_role', 'public.sg_documents', 'insert')
--     and has_table_privilege('service_role', 'public.sg_document_sections', 'insert')  as app_writes,
--   (select count(*) from pg_proc where proname in ('start_sg_document', 'save_sg_document',
--      'discard_sg_document', 'retry_sg_document') and prosecdef) = 4                   as four_functions,
--   not has_function_privilege('anon', 'public.save_sg_document(uuid, text, text)', 'execute') as anon_cant_save,
--   (select count(*) from pg_trigger where tgname in ('sg_documents_not_ended_guard',
--      'sg_document_sections_not_ended_guard')) = 2                                      as ended_guard,
--   (select count(*) from pg_indexes where indexname in ('sg_documents_one_live', 'sg_documents_one_open')) = 2 as one_live_one_open,
--   (select count(*) from public.sg_documents) = 0                                        as nothing_read_yet;
