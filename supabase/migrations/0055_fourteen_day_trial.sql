-- ===== RUN THIS ONE. Migration 0055, new offices start on a 14-day trial, 9 October 2026 =====
--
-- MIGRATION 0055 — a new agency starts on a trial, not free
--
-- Adam, 9 Oct 2026: "the trial is 14 days, not 30, to match terms clause 4.3.
-- A new office starts on a 14-day trial with card details taken at sign-up.
-- Comped must only ever be set by hand."
--
-- Terms v.4 cl 4.3: "The Provider may offer a 14 day trial period and to
-- access such trial the Subscriber will be required to enter their payment
-- details."
--
-- What this changes:
--
--   1. agencies.status now defaults to 'trialing', not 'comped'. 0036 set
--      'comped' as the default to cover the three agencies that existed then,
--      and nothing at sign-up ever changed it, so every agency created since
--      was free with no end (including founder invites, whose 0045 note says
--      "FREE BY DEFAULT"). That note no longer holds. Comped is now set only
--      by hand: the staff switch on the billing page, or SQL.
--   2. A trial counts only once the card is in. agency_may_write() treats a
--      'trialing' agency as able to add records only when it has a Stripe
--      subscription, which exists only after Stripe's checkout has taken the
--      card. Until then the app shows one page: start your 14-day trial.
--      The 14 days themselves are Stripe's (trial_period_days = 14), counted
--      from checkout.
--
-- NOT CHANGED: any existing agency. No row is updated. The default only
-- applies to agencies created after this runs. Existing comped agencies stay
-- comped (Adam, 9 Oct 2026: "Don't change any existing agency yet").
--
-- SAFE TO RUN TWICE.

alter table public.agencies alter column status set default 'trialing';

comment on column public.agencies.status is
  'trialing | active | past_due | canceled | comped. New agencies start trialing (0055) and may add records once Stripe checkout has taken a card (stripe_subscription_id set). past_due and canceled are read-only. comped is set only by hand: a genuinely free account with no Stripe records.';

create or replace function public.agency_may_write(p_agency_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select case
       when a.status = 'active' then true
       -- A trial counts once the card is in (0055).
       when a.status = 'trialing' then a.stripe_subscription_id is not null
       when a.status = 'comped' then (a.comped_until is null or a.comped_until > now())
       else false
     end
     from public.agencies a where a.id = p_agency_id),
    false);
$$;

-- ── Verify. One row. ──────────────────────────────────────────────────────
select
  (select column_default from information_schema.columns
     where table_schema = 'public' and table_name = 'agencies' and column_name = 'status')
                                                                   as default_expect_trialing,
  (select count(*) from public.agencies where status = 'trialing'
     and stripe_subscription_id is null)                           as trial_without_card_expect_0,
  (select count(*) from public.agencies a
     where a.status in ('active', 'comped') and not public.agency_may_write(a.id))
                                                                   as current_agencies_blocked_expect_0;
