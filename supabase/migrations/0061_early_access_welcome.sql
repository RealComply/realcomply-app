-- ===== RUN THIS ONE. Migration 0061, early access welcome email, 10 October 2026 =====
--
-- MIGRATION 0061 — record when an early access registrant was sent the welcome
--
-- Brief, 10 Oct 2026 (early access invites): when someone signs up with the
-- invitation link from their early access row, RealComply sends them a welcome
-- email, once. "Send it once only: record when it was sent."
--
-- The welcome is claimed by an UPDATE whose WHERE clause includes
-- `welcome_sent_at is null`, the same claim-is-the-check pattern as the
-- founder invite in 0045. Two sign-up paths finishing at the same moment (the
-- signup form and /auth/callback) cannot both send it, because the second
-- update matches nothing.
--
-- Nothing else changes. The invitation itself is still recorded in the
-- existing invited_at and invited_token columns (0049), and arrival is still
-- read from founder_invites.accepted_at. No new table, so no grants block.
--
-- SAFE TO RUN TWICE.

alter table public.early_access
  add column if not exists welcome_sent_at timestamptz;

comment on column public.early_access.welcome_sent_at is
  'When the welcome email went to this registrant after they signed up with their invitation link (0061). Set once; a non-null value means it is never sent again.';

-- The welcome looks the row up by the founder token that was just spent.
create index if not exists early_access_invited_token_idx
  on public.early_access(invited_token);

-- ── Verify. One row, both true. ───────────────────────────────────────────
select
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'early_access'
            and column_name = 'welcome_sent_at')                 as column_added,
  exists (select 1 from pg_indexes
          where schemaname = 'public' and indexname = 'early_access_invited_token_idx') as index_added;
