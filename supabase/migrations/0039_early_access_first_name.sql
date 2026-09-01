-- MIGRATION 0039 — first name on the early-access list
-- 3 September 2026
--
-- Adam: "lets do Name (first name is fine), office and email."
--
-- Separate from 0038 rather than folded into it. 0038 had already been handed
-- over in a bundle, and quietly editing a migration someone may have run is
-- how two databases end up disagreeing about what has been applied. Additive
-- and unambiguous beats tidy.
--
-- This is what restores the acknowledgement email's original greeting. Adam's
-- approved copy always opened "Hi [first name],"; it shipped as "Hi there,"
-- purely because there was no field to fill it from.
--
-- NULLABLE, same reasoning as agency_name in 0038: the rows already on the
-- list predate the field, and NOT NULL would need a default that invents a
-- name for them. The form carries the requirement; the column holds what was
-- collected, including nothing for the earliest registrations. Those fall back
-- to "Hi there," which is exactly what they would have got anyway.
--
-- Safe to run more than once.

alter table public.early_access
  add column if not exists first_name text;

comment on column public.early_access.first_name is
  'First name of the person who registered. Required by the form since 3 Sep 2026; null on rows captured before that, which fall back to a generic greeting. Used to address the acknowledgement email.';

-- ─────────────────────────────────────────────────────────────────────────
-- Verify (read only — run after the statement above)
-- ─────────────────────────────────────────────────────────────────────────
-- Expect: both columns true, and a count of the rows predating the fields.
-- Those are the ones to ask when you reply to them by hand.
select
  exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'early_access'
      and column_name = 'first_name')                       as first_name_added,
  exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'early_access'
      and column_name = 'agency_name')                      as agency_name_added,
  (select count(*) from public.early_access
    where first_name is null or agency_name is null)        as rows_missing_details,
  (select count(*) from public.early_access)                as total_on_list;
