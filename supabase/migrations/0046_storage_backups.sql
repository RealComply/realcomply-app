-- ===== RUN THIS ONE. Migration 0046, storage backup ledger, 16 September 2026 =====
--
-- MIGRATION 0046 — a ledger of which uploaded documents have been copied out
-- 16 September 2026
--
-- WHY THIS EXISTS. Found 15 Sep while answering SURA's underwriting question
-- "are your backups tested for restorability?". Checking that honestly turned
-- up something worse than the answer:
--
--   SUPABASE DATABASE BACKUPS DO NOT INCLUDE STORAGE. Their own documentation:
--   "Database backups do not include objects you store via the Storage API."
--
-- Every document an agency uploads lives in Storage — agency agreements,
-- contracts for sale and their s52A prescribed documents, comparable sales
-- reports, trust account reconciliation statements and their signed copies,
-- CPD certificates, licence documents, signed compliance packs. The database
-- holds only the PATHS to them (evidence_path, file_path, signed_file_path).
--
-- So a perfect database restore produces a complete, correct database in which
-- every document link points at nothing. The register would show July's
-- reconciliation as uploaded and signed, and opening it would fail.
--
-- For a product whose whole purpose is holding evidence an agency must keep
-- for three years under s104 of the Property and Stock Agents Act, backing up
-- the index and not the documents is close to backing up nothing.
--
-- WHAT THIS TABLE IS. A ledger, not the backup. The backup is a copy of each
-- object in an independent S3 bucket in Sydney. This table records what has
-- already been copied so each run moves only what is new or changed, rather
-- than re-uploading everything nightly.
--
-- THE LEDGER IS NOT THE RECOVERY MECHANISM, and that distinction matters. If
-- this database were lost entirely, the S3 bucket still holds every file under
-- its original path — and the first path segment is the agency id, so the
-- objects are attributable without this table existing. Losing the ledger
-- costs one expensive re-scan, not the documents.
--
-- SAFE TO RUN TWICE.

create table if not exists public.storage_backups (
  -- The object's path in the source bucket. Primary key because one path is
  -- one object; a replaced file gets a new path (see buildEvidencePath, which
  -- stamps Date.now() into every name), so paths are never reused.
  path              text primary key,
  bucket            text not null default 'compliance-evidence',
  size_bytes        bigint,
  -- The source object's last-modified as reported by Storage when it was
  -- copied. A later value on the source means the object changed and needs
  -- copying again — the ordinary case is that it never does.
  source_updated_at timestamptz,
  backed_up_at      timestamptz,
  -- Where it went, recorded rather than assumed, so a bucket rename later does
  -- not silently orphan the history of what was copied where.
  destination       text,
  -- Visibility on failure. A file that cannot be copied — too large, a
  -- transient S3 error, a permissions problem — must be VISIBLE rather than
  -- retried silently forever. attempts climbing with a stale backed_up_at is
  -- the signal something needs a human.
  attempts          integer not null default 0,
  last_error        text,
  last_attempt_at   timestamptz
);

create index if not exists storage_backups_pending_idx
  on public.storage_backups (backed_up_at nulls first, last_attempt_at);

comment on table public.storage_backups is
  'Ledger of uploaded documents copied to the independent backup bucket. Supabase database backups exclude Storage objects; this tracks the copy that covers that gap. The ledger is an optimisation, not the recovery mechanism.';

-- ── Access ────────────────────────────────────────────────────────────────
--
-- Written only by the backup job, which runs with the service key and is not
-- subject to RLS. Readable by platform admins so backup health can be shown on
-- the staff page without another mechanism. No agency-level access at all:
-- this is RealComply's operational record, not an agency's compliance record.

alter table public.storage_backups enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'storage_backups'
      and policyname = 'storage_backups: platform admins can view'
  ) then
    create policy "storage_backups: platform admins can view"
      on public.storage_backups for select
      using (public.is_platform_admin());
  end if;
end $$;

-- ── Verify. One row. Each number should match its column name. ────────────
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'storage_backups')      as table_expect_1,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'storage_backups')      as columns_expect_9,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'storage_backups')         as policies_expect_1,
  (select count(*) from pg_indexes
    where schemaname = 'public' and tablename = 'storage_backups')         as indexes_expect_2;
