-- ===== RUN THIS ONE. Migration 0051, licences read off the document, 1 October 2026 =====
--
-- MIGRATION 0051 — read the licence on upload, keep its history, and let a
-- CPD certificate leave hours (or the date) blank rather than guess them
--
-- WHY. Two product rules from Adam:
--
--   (a) Upload, don't type. If a fact is printed on a document someone has
--       uploaded, RealComply reads it. Typing is the fallback and the way to
--       correct a wrong read.
--   (b) Done means quiet. Once the thing a reminder is chasing has been
--       uploaded, that reminder stops until the next cycle.
--
-- Uploading a licence or certificate of registration now reads the holder
-- name, the licence type, the number and the expiry date straight onto the
-- record. This migration adds what that needs and nothing more:
--
--   1. agencies: somewhere to keep the corporation licence document. The
--      people's licences have had document columns since 0005; the
--      corporation licence (0015) never did.
--   2. profiles.licence_read and agencies.corporation_licence_read: what the
--      last read found, which fields came from the document and which were
--      typed, by whom and when, and which fields still need someone to fill
--      them in. One jsonb column each rather than a dozen narrow ones,
--      because nothing queries inside it; the card reads it whole.
--   3. licence_history: one row per change to a licence record, holding the
--      record as it was before and as it is after. A renewal replaces the
--      document and the expiry date, and the old ones must stay findable
--      ("we held her 2025 licence until 3 October") rather than be
--      overwritten without trace. Append-only: no update or delete policy.
--   4. cpd_records.hours and cpd_records.completed_date become nullable. A
--      certificate that does not state its hours used to be saved as 0
--      hours, and one with no readable date was dated today. Both are
--      guesses. Now the field is left empty and the card asks for it.
--
-- Nothing here rewrites existing rows. Safe to run more than once.

-- ── 1 and 2. Corporation licence document, and what each read found ────────
alter table public.agencies
  add column if not exists corporation_licence_document_path text,
  add column if not exists corporation_licence_document_file_name text,
  add column if not exists corporation_licence_read jsonb;

comment on column public.agencies.corporation_licence_document_path is
  'Storage path (compliance-evidence bucket) of the corporation licence as uploaded. Superseded documents are kept in Storage and listed in licence_history.';
comment on column public.agencies.corporation_licence_read is
  'What the last read of the corporation licence found, and where each value came from (document or typed, by whom, when). See lib/licence-read.ts.';

alter table public.profiles
  add column if not exists licence_read jsonb;

comment on column public.profiles.licence_read is
  'What the last read of this person''s licence or certificate found, and where each value came from (document or typed, by whom, when). See lib/licence-read.ts.';

-- No new grants for agencies or profiles: they are existing tables and their
-- existing grants and policies cover new columns. (Profiles: self or licensee
-- may update, 0004. Agencies: licensee only, 0004.)

-- ── 3. History of every change to a licence record ──────────────────────────
create table if not exists public.licence_history (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  -- 'profile' for a person's licence or certificate; 'corporation' for the
  -- agency's own licence, which has no profile behind it.
  subject_kind text not null check (subject_kind in ('profile', 'corporation')),
  profile_id uuid references public.profiles(id) on delete cascade,
  -- How the change happened. 'document_read' is RealComply reading an
  -- uploaded file; 'typed' is someone editing the values by hand;
  -- 'document_removed' is the file being detached.
  source text not null check (source in ('document_read', 'typed', 'document_removed')),
  -- The record before and after: type, number, expiry, holder name,
  -- document path and file name. Before is what makes a renewal traceable.
  before jsonb not null default '{}'::jsonb,
  after jsonb not null default '{}'::jsonb,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now()
);

create index if not exists licence_history_agency_idx on public.licence_history (agency_id);
create index if not exists licence_history_profile_idx on public.licence_history (profile_id);

alter table public.licence_history enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'licence_history'
                    and policyname = 'licence history: agency members can view') then
    create policy "licence history: agency members can view"
      on public.licence_history for select
      using (agency_id = public.current_agency_id());
  end if;

  -- Written by the same server actions that change the record, as the
  -- signed-in person. No update or delete policy on purpose: a history row
  -- that can be edited is not a history.
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'licence_history'
                    and policyname = 'licence history: agency members can add') then
    create policy "licence history: agency members can add"
      on public.licence_history for insert
      with check (agency_id = public.current_agency_id());
  end if;
end
$$;

-- Explicit grants. From 30 Oct 2026 Supabase stops granting new public tables
-- to the Data API automatically (RealComply-supabase-data-api-grants-30-Oct.md).
-- Authenticated may read and add, never change. Nothing here is for anon.
grant select, insert on public.licence_history to authenticated;
grant select, insert, update, delete on public.licence_history to service_role;

comment on table public.licence_history is
  'One row per change to a licence or certificate record (a person''s, or the corporation licence), with the record before and after. Keeps superseded documents and expiry dates findable after a renewal. Append-only.';

-- ── 4. CPD: leave a field empty rather than guess it ────────────────────────
alter table public.cpd_records alter column hours drop not null;
alter table public.cpd_records alter column completed_date drop not null;

comment on column public.cpd_records.hours is
  'Hours (or units, for assistant_unit) as stated on the certificate. Null when the certificate does not state them; the CPD card asks for that one field. Null counts as nothing toward the year.';
comment on column public.cpd_records.completed_date is
  'Completion date as stated on the certificate. Null when it could not be read; never defaulted to the upload date.';

-- ── Verify. Expected: 4 columns, 1 table, 2 policies, hours and date nullable ─
select
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'agencies' and column_name in
             ('corporation_licence_document_path', 'corporation_licence_document_file_name', 'corporation_licence_read'))
        or (table_name = 'profiles' and column_name = 'licence_read')))           as columns_expect_4,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'licence_history')            as tables_expect_1,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'licence_history')               as policies_expect_2,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'cpd_records'
      and column_name in ('hours', 'completed_date') and is_nullable = 'YES')     as nullable_expect_2;
