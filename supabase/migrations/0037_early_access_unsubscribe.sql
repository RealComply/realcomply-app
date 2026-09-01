-- MIGRATION 0037 — unsubscribe for the early-access list
-- 3 September 2026
--
-- The early-access acknowledgement email (added in the same change) is a
-- commercial electronic message to an Australian address. The Spam Act 2003
-- requires a functional unsubscribe facility on those, so the list needs
-- somewhere to record that someone has used it, and every send has to check.
--
-- No token column, deliberately. The unsubscribe token is an HMAC of the
-- address under a server-only secret, derived at send time. Storing one would
-- mean the insert path needed to read the row back, and that path uses the
-- ANON client against a table that is insert-only by design (0013): adding a
-- select policy so the app could fetch a token would also hand the anon key
-- the ability to read the entire list. Deriving needs no read at all.
--
-- Safe to run more than once.

alter table public.early_access
  add column if not exists unsubscribed_at timestamptz;

comment on column public.early_access.unsubscribed_at is
  'Set when the person used the unsubscribe link. The row is kept rather than deleted: a deleted row would be re-added by their next form submission and start mailing them again. Nothing is sent to an address where this is not null.';

create index if not exists early_access_unsubscribed_at_idx
  on public.early_access(unsubscribed_at);

-- The unsubscribe route verifies the HMAC before it writes, then updates with
-- the service-role client. No anon update policy is added: with RLS enabled
-- and no policy for update, anonymous updates stay denied by default, which is
-- what keeps a stranger from marking other people unsubscribed by guessing.

-- ─────────────────────────────────────────────────────────────────────────
-- Verify (read only — run after the statement above)
-- ─────────────────────────────────────────────────────────────────────────
-- Expect: column true, 0 unsubscribed so far, and your current list size.
select
  exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'early_access'
      and column_name = 'unsubscribed_at')                      as column_added,
  (select count(*) from public.early_access
    where unsubscribed_at is not null)                          as unsubscribed,
  (select count(*) from public.early_access)                    as total_on_list;
