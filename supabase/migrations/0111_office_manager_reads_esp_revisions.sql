-- ===== 0111: The office manager reads every listing's ESP revisions and withdrawals =====
--
-- Monthly licensee sign-off pack (Adam, 3 Nov 2026). Run after 0108 and 0109.
--
-- 0108 lets the office's approved office manager READ every listing in the
-- office (can_read_property). Two listing tables were written and run on live
-- before 0108, so their "can view" rules still read can_see_property: the
-- listing's agent, their assistant and the licensee.
--   * esp_revisions (0110, ESP revision history)
--     Was: an office manager saw a listing's d3 card with the latest revised
--     figures, but not the earlier revisions or who recorded them.
--   * listing_withdrawals (0114, Withdraw from market)
--     Was: an office manager saw another agent's withdrawn listing in the
--     stage it was withdrawn from, not under Withdrawn, and not why or when.
-- Now: the same "can view" rule as every other listing table after 0108, so
-- the office manager sees both. Reading only: the "can add" rule on
-- esp_revisions is untouched, so an office manager still can't record a
-- revision on another agent's listing, and listing_withdrawals is still
-- written only through withdraw_listing() and put_listing_back_on_market(),
-- which still ask can_see_property.
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
  if to_regclass('public.listing_withdrawals') is null then
    raise exception 'Run 0114 first: it adds the withdrawals this changes.';
  end if;
end
$$;

alter policy "esp_revisions: whoever sees the listing can view" on public.esp_revisions
  using (agency_id = public.current_agency_id() and public.can_read_property(property_id));

alter policy "listing_withdrawals: whoever can see the listing" on public.listing_withdrawals
  using (agency_id = public.current_agency_id() and public.can_read_property(property_id));

commit;

-- ── Check ──────────────────────────────────────────────────────────────
-- One row, every value true.
select
  exists (select 1 from pg_policies
           where schemaname = 'public' and tablename = 'esp_revisions' and cmd = 'SELECT'
             and qual like '%can_read_property%') as office_manager_reads_revisions,
  exists (select 1 from pg_policies
           where schemaname = 'public' and tablename = 'esp_revisions' and cmd = 'INSERT'
             and with_check like '%can_see_property%' and with_check not like '%can_read_property%') as adding_unchanged,
  exists (select 1 from pg_policies
           where schemaname = 'public' and tablename = 'listing_withdrawals' and cmd = 'SELECT'
             and qual like '%can_read_property%') as office_manager_reads_withdrawals,
  not exists (select 1 from pg_policies
               where schemaname = 'public' and cmd = 'SELECT'
                 and qual ~ 'can_see_property\(property_id\)|can_see_pm_property\(property_id\)') as no_listing_table_missed;
