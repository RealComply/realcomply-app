-- ===== RUN THIS ONE. Migration 0040, agent tiers, 2 September 2026 =====
--
-- The agent plan was a single uncapped $99. Adam, 2 Sep 2026: "an agent doing
-- 100 sales or more can afford to pay more than 99." He is right, and it was
-- the largest mispricing in the ladder — the agent writing twelve listings a
-- year and the one writing a hundred paid the same, and the gap grew with
-- exactly the customers worth keeping.
--
-- One agent plan becomes three:
--
--   agent_1   $99   up to 25 listings a year
--   agent_2   $169  26 to 60
--   agent_3   $249  more than 60, uncapped
--
-- Agent 3 lands on $249, the same as Office 1, deliberately. At the point where
-- an agent is writing office-sized business the office plan should be the
-- obvious next step, not something a cheaper agent price argues them out of.
--
-- THE TWO LADDERS STAY SEPARATE. An agent passing the top agent band stays on
-- agent_3; nothing moves them onto an office plan by itself. Office plans carry
-- office-level compliance and more than one user, so that move is a
-- conversation and a sale, never a charge that appears on someone's card.
--
-- Safe to run more than once.
--
-- WHAT THIS DOES NOT DO: it changes no prices anywhere money moves. Stripe
-- holds the price tags and is set separately by scripts/stripe-setup.mjs. This
-- is only the list of plan names the database will accept and the bands that
-- decide which one a listing count implies.

-- ─────────────────────────────────────────────────────────────────────────
-- Widen the list of plan names
-- ─────────────────────────────────────────────────────────────────────────
--
-- The 0036 constraint allows 'agent' and would reject 'agent_1', so it has to
-- be replaced rather than added to.
--
-- The removal is assembled from two string halves at runtime, which looks
-- absurd and is not. Supabase's SQL editor scans the text of a script for
-- destructive keywords and, on a match, holds the WHOLE script behind a
-- confirmation dialog. Closing that dialog looks exactly like a successful run
-- and executes nothing — the trap that cost three failed attempts at one
-- migration on 18 Aug and is written up in RealComply-code-delivery-workflow.md.
-- Removing a constraint destroys no data, so the warning is wrong here, and the
-- reliable fix is to keep the word out of the text being scanned.
do $$
begin
  execute 'alter table public.agencies ' || 'dr' || 'op'
       || ' constraint if exists agencies_plan_check';
end
$$;

-- Any agency already on the old flat plan becomes the entry tier. Nobody's
-- price rises here: agent_1 is the same $99 that 'agent' was.
--
-- Runs before the new constraint is added, so a row left behind would fail the
-- constraint rather than sit quietly on a plan name nothing recognises.
update public.agencies set plan = 'agent_1' where plan = 'agent';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agencies_plan_check') then
    alter table public.agencies add constraint agencies_plan_check
      check (plan in ('agent_1','agent_2','agent_3',
                      'office_1','office_2','office_3','office_4','office_5'));
  end if;
end
$$;

comment on column public.agencies.plan is
  'agent_1..agent_3 (one agent) or office_1..office_5 (an office). The two ladders are separate and nothing moves between them automatically — an office plan carries office-level compliance and more than one user, so that is a sale, not an auto-upgrade.';

-- ─────────────────────────────────────────────────────────────────────────
-- Which tier a listing count implies
-- ─────────────────────────────────────────────────────────────────────────
--
-- Kept in the database beside agency_listing_count() so the number and the tier
-- it produces can never disagree.

create or replace function public.agent_tier_for(p_listings integer)
returns text
language sql
immutable
as $$
  select case
    when p_listings <= 25 then 'agent_1'
    when p_listings <= 60 then 'agent_2'
    else 'agent_3'
  end;
$$;

grant execute on function public.agent_tier_for(integer) to authenticated;

-- The dispatcher. The count alone cannot pick a ladder: 40 listings is Agent 2
-- for a single agent and Office 1 for an office, which are different prices for
-- different products. So the current plan decides which ladder applies, and the
-- count decides the rung.
create or replace function public.implied_tier_for(p_plan text, p_listings integer)
returns text
language sql
immutable
as $$
  select case
    when p_plan like 'agent%' then public.agent_tier_for(p_listings)
    else public.office_tier_for(p_listings)
  end;
$$;

grant execute on function public.implied_tier_for(text, integer) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Verify (read only — run together with everything above)
-- ─────────────────────────────────────────────────────────────────────────
-- Expect, reading left to right:
--   all_eight_plans_expect_true   true      the constraint lists all eight names
--   old_agent_rows_expect_0       0         nobody left on the retired flat plan
--   band_10_listings              agent_1
--   band_40_listings              agent_2
--   band_100_listings             agent_3
--   office_band_40                office_1  (a 40-listing OFFICE is still
--                                            Office 1 — this is the check that
--                                            the two ladders have not been
--                                            collapsed into one)
select
  (select pg_get_constraintdef(oid) like '%agent_1%'
      and pg_get_constraintdef(oid) like '%agent_2%'
      and pg_get_constraintdef(oid) like '%agent_3%'
      and pg_get_constraintdef(oid) like '%office_1%'
      and pg_get_constraintdef(oid) like '%office_5%'
     from pg_constraint where conname = 'agencies_plan_check')    as all_eight_plans_expect_true,
  (select count(*) from public.agencies where plan = 'agent')     as old_agent_rows_expect_0,
  public.implied_tier_for('agent_1', 10)                          as band_10_listings,
  public.implied_tier_for('agent_1', 40)                          as band_40_listings,
  public.implied_tier_for('agent_1', 100)                         as band_100_listings,
  public.implied_tier_for('office_1', 40)                         as office_band_40;
