-- ===== RUN THIS ONE. Migration 0043, signatures on the document, 8 September 2026 =====
--
-- MIGRATION 0043 — the signed copy, and permission to record it
-- 8 September 2026
--
-- REPLACES 0042. If 0042 has already been run this is still safe — it creates
-- the same policy only when absent. If 0042 has NOT been run, run this one and
-- forget 0042 entirely; everything it did is repeated below.
--
-- WHY. Adam, 8 Sep 2026: "there's no signature on these documents. We have a
-- button that says sign. It labels the document as being signed. And then when
-- you open it, there's no signature."
--
-- Signing wrote a row in signoff_signatures and left the uploaded PDF exactly
-- as it arrived. So RealComply knew the reconciliation was signed and the
-- document did not. Hand that file to an auditor, an accountant or Fair
-- Trading — which is the entire point of keeping it — and it is an unsigned
-- reconciliation statement. Our own knowledge does not travel with the file,
-- and the file is what gets sent.
--
-- Signing now writes a SECOND file: the report with a signature page appended,
-- naming the licensee, the moment they signed, and the Electronic Transactions
-- Act 2000 (NSW) s9 basis on which a typed adopted name is a signature. The two
-- columns below point at it.
--
-- THE ORIGINAL IS NEVER TOUCHED. file_path still holds the upload byte for
-- byte. "The document as uploaded" and "the document as signed" are two
-- records, and an auditor is entitled to see that they differ only by the page
-- we added — which is impossible if we overwrite.
--
-- THE UPDATE POLICY (this is the part carried over from 0042). 0009 gave
-- signoff_documents policies for select, insert and delete and none for update.
-- Row-level security denies what it does not allow, so writing these columns —
-- and replacing a report — was refused, and refused QUIETLY: a blocked update
-- is not an error, it reports success having changed no rows. Without this the
-- signature page would be generated, uploaded to storage, and then never
-- recorded against the document, and the screen would look exactly as it does
-- now.
--
-- Restricting these actions to the licensee in charge happens in signoffs.ts.
-- The policy is agency-scoped, matching the insert and delete policies beside
-- it; splitting the role check across two places would leave neither telling
-- the whole story.
--
-- SAFE TO RUN TWICE.

alter table public.signoff_documents
  add column if not exists signed_file_path text,
  add column if not exists signed_file_name text;

comment on column public.signoff_documents.signed_file_path is
  'The uploaded document with a signature page appended, written when it is signed. Null until then. The original at file_path is never modified.';

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'signoff_documents'
      and policyname = 'signoff_documents: agency members can update'
  ) then
    create policy "signoff_documents: agency members can update"
      on public.signoff_documents for update
      using (agency_id = public.current_agency_id())
      with check (agency_id = public.current_agency_id());
  end if;
end $$;

-- ── Verify. One row. Each number should match its column name. ────────────
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'signoff_documents'
      and column_name in ('signed_file_path', 'signed_file_name'))
    as signed_columns_expect_2,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'signoff_documents'
      and policyname = 'signoff_documents: agency members can update')
    as update_policy_expect_1,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'signoff_documents')
    as document_policies_expect_4,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'signoff_signatures')
    as signature_policies_expect_3;
