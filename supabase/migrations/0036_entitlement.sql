-- MIGRATION 0036 — what an agency is entitled to
-- 26 August 2026
--
-- The first half of billing, and deliberately the half with no Stripe in it.
--
-- The model was decided on 22 Aug and is written up in
-- RealComply-pricing-and-billing-model.md. The architectural decision that
-- matters most is this one, quoted from it:
--
--   "Entitlement is a property of the agency. Access is decided by fields on
--    the agency row, and Stripe is one of the things that writes to them. Not
--    the other way round."
--
-- So this migration builds the thing access is decided by. Stripe comes second
-- and writes to fields that already exist and already work. That ordering is
-- what makes it possible to put a customer on a plan by hand tomorrow, to comp
-- an adviser permanently, and to keep working when Stripe has an outage or a
-- webhook is missed.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ON LAPSE: READ-ONLY, NEVER LOCKED — and enforced in one place
-- ─────────────────────────────────────────────────────────────────────────
--
-- A lapsed agency keeps full read access and can export everything. They cannot
-- create new listings or record new compliance items until they are current.
--
-- Not generosity. Their file is a legal record, and the reason they stopped
-- paying may be the same reason they suddenly need it. Locking an agency out of
-- its own compliance records while Fair Trading is asking questions is
-- indefensible.
--
-- Enforced by two INSERT triggers rather than by checks scattered through the
-- application, for the same reason 0035 put archiving into current_agency_id():
-- one place that cannot be forgotten beats twenty that can. Reads, updates to
-- existing records, exports and sign-offs are all deliberately untouched —
-- finishing work already started is not the same as starting new work.
--
-- Safe to run more than once.

-- ─────────────────────────────────────────────────────────────────────────
-- The fields
-- ─────────────────────────────────────────────────────────────────────────

alter table public.agencies
  add column if not exists plan text not null default 'office_1',
  add column if not exists status text not null default 'comped',
  add column if not exists trial_ends_at timestamptz,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists comped_by uuid references public.profiles(id),
  add column if not exists comped_reason text,
  add column if not exists comped_until timestamptz;

-- Everything that exists today is comped, and that is the correct answer rather
-- than a convenience. Cass Property is the design partner; the other two are
-- test agencies. None of them should ever generate an invoice, and none should
-- break when Stripe has a bad day.
--
-- comped is a real status, not a 100% discount coupon. A coupon would still
-- demand a payment method, still generate $0 invoices and churn events, and
-- would pollute revenue reporting permanently.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agencies_plan_check') then
    alter table public.agencies add constraint agencies_plan_check
      check (plan in ('agent','office_1','office_2','office_3','office_4','office_5'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agencies_status_check') then
    alter table public.agencies add constraint agencies_status_check
      check (status in ('trialing','active','past_due','canceled','comped'));
  end if;
end
$$;

comment on column public.agencies.status is
  'trialing | active | past_due | canceled | comped. Everything except past_due and canceled may create new records; those two are read-only. comped is a genuinely free account with no Stripe records at all — advisers and design partners.';

create index if not exists agencies_stripe_customer_idx on public.agencies(stripe_customer_id);

-- ─────────────────────────────────────────────────────────────────────────
-- May this agency create new records right now?
-- ─────────────────────────────────────────────────────────────────────────
--
-- One function, so the answer is defined once. A comp with an expiry that has
-- passed stops counting — otherwise "free until the end of the pilot" quietly
-- becomes free forever, which is a decision nobody made.
create or replace function public.agency_may_write(p_agency_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select case
       when a.status in ('trialing','active') then true
       when a.status = 'comped' then (a.comped_until is null or a.comped_until > now())
       else false
     end
     from public.agencies a where a.id = p_agency_id),
    false);
$$;

grant execute on function public.agency_may_write(uuid) to authenticated;

create or replace function public.guard_agency_may_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.agency_may_write(new.agency_id) then
    return new;
  end if;
  raise exception
    'This agency''s subscription is not current, so new records can''t be added. Everything already on file stays readable and exportable.';
end;
$$;

-- Only on INSERT, and only on the two tables that represent new compliance
-- work. Updating an item that already exists, signing off a file that is
-- already open, reading anything, exporting anything — all still allowed. The
-- rule is "no new work", not "no access".
create or replace trigger properties_entitlement_guard
  before insert on public.properties
  for each row execute function public.guard_agency_may_write();

create or replace trigger property_items_entitlement_guard
  before insert on public.property_items
  for each row execute function public.guard_agency_may_write();

-- ─────────────────────────────────────────────────────────────────────────
-- The counted metric: LISTINGS over a ROLLING 12 MONTHS
-- ─────────────────────────────────────────────────────────────────────────
--
-- Listings, not sales: RealComply does its work per listing whether it sells or
-- not. An unsold listing still needs an ESP, weekly price checks, material
-- facts and sign-off. Charging on sales would undercharge the agencies working
-- hardest and make unsold stock free.
--
-- Rolling, not calendar: nothing to game at a year boundary, an agency joining
-- in November is not handed a full year's quota for two months' use, and there
-- is no per-agency reset date to track.
create or replace function public.agency_listing_count(p_agency_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer from public.properties p
  where p.agency_id = p_agency_id
    and p.test_mode is not true
    and p.created_at > now() - interval '365 days';
$$;

grant execute on function public.agency_listing_count(uuid) to authenticated;

-- Which office tier a listing count implies. Kept in the database beside the
-- count so the number and the tier it produces can never disagree — the app
-- reads both from here rather than reimplementing the ladder in TypeScript.
create or replace function public.office_tier_for(p_listings integer)
returns text
language sql
immutable
as $$
  select case
    when p_listings <= 50  then 'office_1'
    when p_listings <= 150 then 'office_2'
    when p_listings <= 250 then 'office_3'
    when p_listings <= 400 then 'office_4'
    else 'office_5'
  end;
$$;

grant execute on function public.office_tier_for(integer) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Verify (read only — run after the statements above)
-- ─────────────────────────────────────────────────────────────────────────
-- Expect: 8 new columns, 2 triggers, 3 agencies all comped, every one able to
-- write, and a listing count for Cass that looks like reality.
select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='agencies'
       and column_name in ('plan','status','trial_ends_at','stripe_customer_id',
                           'stripe_subscription_id','comped_by','comped_reason','comped_until'))
                                                                    as new_columns,
  (select count(*) from pg_trigger
     where tgname in ('properties_entitlement_guard','property_items_entitlement_guard'))
                                                                    as triggers,
  (select count(*) from public.agencies)                            as agencies,
  (select count(*) from public.agencies where status = 'comped')    as comped,
  (select count(*) from public.agencies a
     where not public.agency_may_write(a.id))                       as blocked_agencies,
  (select public.agency_listing_count(a.id) from public.agencies a
     where a.name ilike '%cass%' limit 1)                           as cass_listings_12mo,
  (select public.office_tier_for(
     (select public.agency_listing_count(a.id) from public.agencies a
        where a.name ilike '%cass%' limit 1)))                      as cass_implied_tier;
