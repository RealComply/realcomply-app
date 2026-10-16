-- ===== RUN AFTER THE AGENT ACKNOWLEDGEMENT CHANGE IS LIVE. Migration 0072, 14 October 2026 =====
--
-- Turns the agent acknowledgement and the annexure lock (0071) on for every
-- office made from now on. Offices that exist when this runs keep the lock
-- off (Adam, 14 Oct 2026: "locks off for live offices"), and nothing about
-- any existing office changes. Run it once the new screens are on the live
-- site: before then, a new office would be locked with no way to upload the
-- signed annexure.
--
-- To switch one existing office on later:
--   update public.agencies set annexure_gate = true where id = '...';
--
-- Safe to run more than once.

alter table public.agencies alter column annexure_gate set default true;

-- Check: one row, true.
select column_default = 'true' as new_offices_locked_until_signed
  from information_schema.columns
 where table_schema = 'public' and table_name = 'agencies' and column_name = 'annexure_gate';
