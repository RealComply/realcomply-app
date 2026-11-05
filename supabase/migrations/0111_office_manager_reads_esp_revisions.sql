-- ===== 0111: The office manager reads every listing's ESP revision history =====
--
-- Monthly licensee sign-off pack (Adam, 3 Nov 2026). Run after 0108 and 0109.
--
-- 0108 lets the office's approved office manager READ every listing in the
-- office (can_read_property). 0110 (ESP revision history) was written and
-- run on live before 0108, so its "can view" rule still reads
-- can_see_property: the listing's agent, their assistant and the licensee.
-- Was: an office manager saw a listing's d3 card with the latest revised
-- figures, but not the earlier revisions or who recorded them.
-- Now: the same "can view" rule as every other listing table after 0108, so
-- the office manager sees every revision too. Reading only: the "can add"
-- rule is untouched, so an office manager still can't record a revision on
-- another agent's listing.
--
-- No new table. Safe to run twice.

begin;

do $$
begin
  if to_regprocedure('public.can_read_property(uuid)') is null then
    raise exception 'Run 0108 first: it adds the office manager''s reading rule this uses.';
  end if;
  if to_regclass('public.esp_revisions') is null then
    raise exception 'Run 0110 first: it adds the ESP revision history this changes.';
  end if;
end
$$;

alter policy "esp_revisions: whoever sees the listing can view" on public.esp_revisions
  using (agency_id = public.current_agency_id() and public.can_read_property(property_id));

commit;

-- ── Check ──────────────────────────────────────────────────────────────
-- One row, both values true.
select
  exists (select 1 from pg_policies
           where schemaname = 'public' and tablename = 'esp_revisions' and cmd = 'SELECT'
             and qual like '%can_read_property%') as office_manager_reads_revisions,
  exists (select 1 from pg_policies
           where schemaname = 'public' and tablename = 'esp_revisions' and cmd = 'INSERT'
             and with_check like '%can_see_property%' and with_check not like '%can_read_property%') as adding_unchanged;
