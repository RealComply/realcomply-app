-- MIGRATION 0038 — office name on the early-access list
-- 3 September 2026
--
-- Adam: "i think we should ask for their office name too so i can look them
-- up." The form asked for an email and nothing else, so a registration told
-- him an address and left him to guess who was behind it.
--
-- NULLABLE, even though the form requires it. The rows already on the list
-- were captured before the field existed and cannot be backfilled, and a NOT
-- NULL column would need a default that invents an office name for them. The
-- form is where the requirement belongs; the column just has to be able to
-- hold what was collected, including nothing for the people who registered
-- first.
--
-- Safe to run more than once.

alter table public.early_access
  add column if not exists agency_name text;

comment on column public.early_access.agency_name is
  'The office or agency the person registered from. Required by the form since 3 Sep 2026; null on rows captured before that. Used to identify who a registration actually came from.';

-- ─────────────────────────────────────────────────────────────────────────
-- Verify (read only — run after the statement above)
-- ─────────────────────────────────────────────────────────────────────────
-- Expect: column true, and a count of the early rows that predate the field.
-- Those are the ones to ask when you reply to them.
select
  exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'early_access'
      and column_name = 'agency_name')                      as column_added,
  (select count(*) from public.early_access
    where agency_name is null)                              as rows_without_office_name,
  (select count(*) from public.early_access)                as total_on_list;
