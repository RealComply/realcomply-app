-- ===== RUN THIS ONE. Migration 0042, replacing a signed report, 8 September 2026 =====
--
-- MIGRATION 0042 — let a document already on file be corrected
-- 8 September 2026
--
-- WHY. Adam, 8 Sep 2026: "I accidentally put August's report in the July
-- section and signed it off. Now I can't see a way to go back and reopen it to
-- amend the document."
--
-- The app now offers Replace on a reconciliation month. It could not work
-- without this: 0009 gave signoff_documents policies for select, insert and
-- delete, and none for update. Row-level security denies anything not
-- explicitly allowed, so the update was refused — and refused QUIETLY, which is
-- the part worth noting. A blocked update is not an error; it reports success
-- having changed no rows. The screen would have said the report was replaced
-- while the wrong file stayed exactly where it was.
--
-- WHAT THIS ALLOWS, AND WHAT IT DOES NOT. The policy is agency-scoped, the same
-- shape as the insert and delete policies beside it. Restricting the correction
-- to the licensee in charge happens in replaceSignoffDocument, which is also
-- where the signature is voided and the amendment written into the record —
-- putting the role check here as well would split one rule across two places
-- and neither would tell the whole story.
--
-- Signatures are untouched by this. signoff_signatures already has exactly one
-- update policy and it lets a person write only their own row, which is the
-- control that actually matters and stays as it is: clearing a voided
-- signature works because the licensee is clearing their own.
--
-- SAFE TO RUN TWICE. It creates the policy only if it is absent.

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
