-- ===== RUN THIS ONE. Migration 0075, "No, wrong person" on your own CPD certificate, 15 October 2026 =====
--
-- Found in the preview test of PR #49 (15 Oct 2026). When an agent uploads
-- their own CPD certificate and it is in another name, RealComply asks "Is
-- this [person]'s certificate?". "No, wrong person" is meant to remove the
-- file. For the licensee it does. For the agent it couldn't: since 0058 only
-- the licensee deletes files, so the agent's "No" left the file in storage
-- (not on any record) and said so.
--
-- A licence had the same problem and 0060 fixed it with a narrow exception:
-- your own licence upload, within the hour, that never went on a record. This
-- is the same exception for a CPD certificate. Everything else stays with
-- the licensee.
--
-- What this file does:
--
--   1. A person may delete a file in their own CPD folder only if they
--      uploaded it themselves, less than an hour ago, and it has never been
--      on a CPD record.
--   2. "Never on a record" is kept honest: from now on, a certificate that
--      leaves a CPD record (replaced, removed, or its record deleted) is
--      written to the list 0060 keeps for listing files, so it can't then be
--      deleted under this exception.
--
-- No new tables, so no new grants. Nothing is deleted and no record
-- changes. Safe to run more than once.

begin;

-- Order check: 0058 (only the licensee deletes files), 0060 (the list of
-- files once on a record) and 0074 (the certificate name question) first.
do $$
begin
  if to_regclass('public.evidence_files_once_on_record') is null
     or to_regprocedure('public.record_evidence_leaving_card()') is null then
    raise exception 'Run 0060 before this one. Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'cpd_records'
                    and column_name = 'name_on_certificate') then
    raise exception 'Run 0074 before this one. Nothing was changed.';
  end if;
end $$;

-- ── 1. Your own unsaved CPD certificate, within the hour ─────────────────
create or replace function public.own_cpd_upload_deletable(p_name text, p_owner text, p_created_at timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_seg text[] := storage.foldername(p_name);
begin
  if auth.uid() is null or p_owner is distinct from auth.uid()::text then
    return false;
  end if;
  if p_created_at is null or p_created_at <= now() - interval '1 hour' then
    return false;
  end if;
  -- {agency}/_cpd/{you}/{file}: your own folder, in your own office.
  if coalesce(array_length(v_seg, 1), 0) <> 3
     or v_seg[1] is distinct from public.current_agency_id()::text
     or v_seg[2] is distinct from '_cpd'
     or v_seg[3] is distinct from auth.uid()::text then
    return false;
  end if;
  return not exists (select 1 from public.cpd_records c where c.evidence_path = p_name)
     and not exists (select 1 from public.evidence_files_once_on_record r where r.name = p_name);
end
$$;
revoke execute on function public.own_cpd_upload_deletable(text, text, timestamptz) from public, anon;
grant execute on function public.own_cpd_upload_deletable(text, text, timestamptz) to authenticated;

drop policy if exists "compliance-evidence: own unsaved CPD certificate can be removed" on storage.objects;
create policy "compliance-evidence: own unsaved CPD certificate can be removed" on storage.objects
  for delete using (
    bucket_id = 'compliance-evidence'
    and public.own_cpd_upload_deletable(name, coalesce(owner_id, owner::text), created_at));

-- ── 2. A certificate that leaves a CPD record is written down ────────────
-- The same function 0060 uses for a listing card: it needs only the
-- record's evidence_path and agency_id, which a CPD record has too.
drop trigger if exists cpd_records_record_evidence_leaving on public.cpd_records;
create trigger cpd_records_record_evidence_leaving
  after update of evidence_path or delete on public.cpd_records
  for each row execute function public.record_evidence_leaving_card();

-- ── Check ───────────────────────────────────────────────────────────────
select
  exists (select 1 from pg_policy
           where polrelid = 'storage.objects'::regclass
             and polname = 'compliance-evidence: own unsaved CPD certificate can be removed') as rule_added,
  exists (select 1 from pg_trigger
           where tgrelid = 'public.cpd_records'::regclass
             and tgname = 'cpd_records_record_evidence_leaving') as leaving_recorded,
  exists (select 1 from pg_policy
           where polrelid = 'storage.objects'::regclass
             and polname = 'compliance-evidence: licensee can delete') as licensee_rule_unchanged;

commit;
