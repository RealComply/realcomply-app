-- ===== RUN THIS ONE. Migration 0050, on-market listings, 29 September 2026 =====
--
-- MIGRATION 0050 — properties on the market, beside the comparable sales
--
-- WHY. Stephen Borg (compliance trainer), 28 Sep 2026: the reasoning behind
-- an estimated selling price should consider the properties an agent is
-- competing against as well as what has sold. A buyer looking at this listing
-- is also looking at the three down the street, and the price the vendor can
-- expect is shaped by them. Adam agreed; design in
-- RealComply-on-market-properties-design.md.
--
-- WHY A TABLE OF ITS OWN rather than a "kind" column on property_comparables.
-- Every existing query, draft and PDF section reads property_comparables as
-- "sales". A listing has no sale price and no sale date, and an asking price
-- is another agent's advertised figure, not a transaction. Mixing the two in
-- one table would put a listing one forgotten filter away from being printed
-- in the compliance record as a sale. Separate tables make that mistake
-- impossible rather than merely unlikely.
--
-- DECISIONS BUILT IN (Adam, 28–29 Sep 2026):
--
--   * The list is "on the market as at the date of the agency agreement", not
--     "now". That date is read from the agency agreement card (a3) when the
--     list is shown, so as_at is NULL for that original list.
--   * When the ESP is revised mid-campaign, the agent records a fresh list as
--     at the revision date. Those rows carry that date in as_at. (The card for
--     it comes in a later release; the column is here so the table does not
--     have to change again.)
--   * The agent marks each listing DIRECT COMPETITION or CONSIDERED. There is
--     no "not comparable": Adam, 29 Sep, "if it's not a comparable property, it
--     shouldn't be there" — the agent removes it instead.
--   * Asking price is free text. Guides are ranges, "Contact agent", auction
--     guides; forcing a number would force the agent to invent one.
--   * Nothing is pre-selected, and extraction never writes a weighting. Same
--     rule as the sales, for the same reason: a defaulted mark is a record of a
--     decision nobody made.
--
-- Safe to run more than once.

create table if not exists public.property_market_listings (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,

  -- Facts, read from the report or typed by the agent.
  address text not null,
  asking_price text,            -- as advertised, free text: "$1.2m–$1.3m", "Contact agent"
  sale_method text,             -- as advertised: "Private treaty", "Auction 18 Oct"
  listed_date date,             -- first listed, where the report says
  bedrooms smallint,
  bathrooms smallint,
  car_spaces smallint,
  land_size_sqm numeric(10,2),
  internal_area_sqm numeric(10,2),
  distance_m integer,
  property_type text,

  -- 'report' rows were read by the AI off the comparable-sales document;
  -- 'agent' rows were typed by hand.
  source text not null default 'report',

  -- THE AGENT'S JUDGEMENT. Null until they say. Never defaulted.
  weighting text,
  agent_note text,

  -- NULL = the original list, as at the agency agreement date (read from a3).
  -- A date = a later list recorded when the ESP was revised.
  as_at date,

  position smallint not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'property_market_listings_source_check') then
    alter table public.property_market_listings add constraint property_market_listings_source_check
      check (source in ('report','agent'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'property_market_listings_weighting_check') then
    alter table public.property_market_listings add constraint property_market_listings_weighting_check
      check (weighting is null or weighting in ('competition','considered'));
  end if;
end
$$;

comment on column public.property_market_listings.weighting is
  'competition | considered, set only by the agent. Never pre-set, never written by extraction. No "not comparable": a listing that is not comparable is removed (Adam, 29 Sep 2026).';

comment on column public.property_market_listings.asking_price is
  'The advertised price or guide exactly as published by the other agent. Not a sale price.';

comment on column public.property_market_listings.as_at is
  'NULL for the original list, which is as at the agency agreement date (read from item a3). A date for a list recorded when the ESP was revised.';

create index if not exists property_market_listings_property_idx on public.property_market_listings(property_id);
create index if not exists property_market_listings_agency_idx on public.property_market_listings(agency_id);

alter table public.property_market_listings enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'property_market_listings'
                    and policyname = 'market listings: agency members') then
    create policy "market listings: agency members"
      on public.property_market_listings for all
      using (agency_id = public.current_agency_id())
      with check (agency_id = public.current_agency_id());
  end if;
end
$$;

-- Explicit grants. From 30 Oct 2026 Supabase stops granting new public tables
-- to the Data API automatically (RealComply-supabase-data-api-grants-30-Oct.md).
-- Authenticated and service role only. Nothing here is for anon.
grant select, insert, update, delete on public.property_market_listings to authenticated;
grant select, insert, update, delete on public.property_market_listings to service_role;

create or replace function public.touch_property_market_listings()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'property_market_listings_touch') then
    create trigger property_market_listings_touch
      before update on public.property_market_listings
      for each row execute function public.touch_property_market_listings();
  end if;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Verify. Pressing Run also checks the work.
-- ─────────────────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'property_market_listings')      as table_expect_1,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'property_market_listings')      as columns_expect_21,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'property_market_listings')         as policies_expect_1,
  (select count(*) from pg_constraint
    where conname in ('property_market_listings_source_check',
                      'property_market_listings_weighting_check'))                  as checks_expect_2;
