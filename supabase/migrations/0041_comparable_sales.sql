-- ===== RUN THIS ONE. Migration 0041, comparable sales, 7 September 2026 =====
--
-- MIGRATION 0041 — the subject property's own details, and the comparables
-- 7 September 2026
--
-- WHY. Adam, 6 Sep 2026: "once we have the comparable sales uploaded into
-- RealComply, how much work could the AI do in generating notes for each of
-- the comparable properties? and potentially stacking them up against the
-- current listing."
--
-- The answer was: most of the factual half, and none of it was possible,
-- because RealComply knew nothing about the subject property except its
-- address and type. You cannot stack a comparable against a listing when only
-- one side of the comparison exists. This migration builds the other side, and
-- a table for the sales themselves.
--
-- THE DESIGN DECISION THAT MATTERS, and the reason for the weighting column:
--
--   The AI produces the comparison. The agent produces the conclusion.
--
-- s72A makes the estimated selling price the agent's own opinion and s72A(5)
-- makes them hold evidence of its reasonableness. So this table stores facts
-- read off a report, PLUS one thing that can only come from a human: which
-- sales they relied on, which they considered, which they rejected, and why.
-- That is the methodology record, and stage 2 of the underquoting reforms is
-- expected to require it. See RealComply-comparable-sales-AI-notes-design.md
-- and RealComply-NSW-underquoting-reforms-late-2026.md.
--
-- Nothing here is ever pre-selected. A pre-set weighting is the same mistake as
-- a pre-ticked REINSW box, on the one item most likely to be challenged under
-- s74 — rejected once already on 24 Aug 2026 and not creeping back.
--
-- Safe to run more than once.

-- ─────────────────────────────────────────────────────────────────────────
-- The subject property's own attributes
-- ─────────────────────────────────────────────────────────────────────────
--
-- These are the fields that actually explain a price difference between two
-- houses. Everything is nullable: an agent should be able to run a listing
-- without answering any of it, and a comparison table that is missing a row is
-- better than a form that blocks the file.

alter table public.properties
  add column if not exists bedrooms smallint,
  add column if not exists bathrooms smallint,
  add column if not exists car_spaces smallint,
  add column if not exists land_size_sqm numeric(10,2),
  add column if not exists internal_area_sqm numeric(10,2),
  add column if not exists condition_note text,
  -- What the AI read off the uploaded documents, held separately from the
  -- confirmed values above. THE SEPARATION IS THE POINT: a figure a model read
  -- off a PDF and a figure the agent stands behind are different things, and
  -- the compliance record must be able to tell them apart. Suggestions are
  -- shown for confirmation and are never used in the comparison until a person
  -- has accepted them.
  add column if not exists attribute_suggestions jsonb,
  add column if not exists attributes_confirmed_at timestamptz,
  add column if not exists attributes_confirmed_by uuid references public.profiles(id);

comment on column public.properties.condition_note is
  'Free text: renovated, original, needs work, plus anything materially unusual (battle-axe, main road, easement). Explains price differences that bed/bath counts cannot.';

comment on column public.properties.attribute_suggestions is
  'What extraction read about the SUBJECT property, awaiting the agent''s confirmation. Never the source of truth — the confirmed columns are.';

-- ─────────────────────────────────────────────────────────────────────────
-- One row per comparable sale
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.property_comparables (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,

  -- Facts, read from the report or typed by the agent.
  address text not null,
  sale_price numeric(12,2),
  sale_date date,
  bedrooms smallint,
  bathrooms smallint,
  car_spaces smallint,
  land_size_sqm numeric(10,2),
  internal_area_sqm numeric(10,2),
  distance_m integer,
  property_type text,

  -- Where the row came from. 'report' rows were read by the AI off the
  -- comparable-sales document; 'agent' rows were entered by hand. Kept because
  -- a regulator asking how a figure got into the record deserves an answer,
  -- and because a re-read of the report must never overwrite something a
  -- person typed.
  source text not null default 'report',

  -- THE AGENT'S JUDGEMENT. Null until they say. Never defaulted.
  weighting text,
  agent_note text,

  -- Display order as the report listed them, so the table on screen matches
  -- the document beside it.
  position smallint not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'property_comparables_source_check') then
    alter table public.property_comparables add constraint property_comparables_source_check
      check (source in ('report','agent'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'property_comparables_weighting_check') then
    alter table public.property_comparables add constraint property_comparables_weighting_check
      check (weighting is null or weighting in ('relied','considered','not_comparable'));
  end if;
end
$$;

comment on column public.property_comparables.weighting is
  'relied | considered | not_comparable, set only by the agent. This column is the methodology record: which sales formed the estimate and which were rejected. Never pre-set, never written by extraction.';

comment on column public.property_comparables.agent_note is
  'The agent''s own words about this sale. Written by a person or dictated by one; never generated.';

create index if not exists property_comparables_property_idx on public.property_comparables(property_id);
create index if not exists property_comparables_agency_idx on public.property_comparables(agency_id);

alter table public.property_comparables enable row level security;

-- One policy covering every command, keyed on the agency, matching how every
-- other tenant-scoped table in this schema behaves. Agency members read, add,
-- weight and remove their own listings' comparables; nobody else sees them.
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'property_comparables'
                    and policyname = 'comparables: agency members') then
    create policy "comparables: agency members"
      on public.property_comparables for all
      using (agency_id = public.current_agency_id())
      with check (agency_id = public.current_agency_id());
  end if;
end
$$;

-- Keep updated_at honest, the same way the rest of the schema does.
create or replace function public.touch_property_comparables()
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
  if not exists (select 1 from pg_trigger where tgname = 'property_comparables_touch') then
    create trigger property_comparables_touch
      before update on public.property_comparables
      for each row execute function public.touch_property_comparables();
  end if;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Verify. Pressing Run also checks the work.
-- ─────────────────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'property_comparables')          as table_expect_1,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'properties'
      and column_name in ('bedrooms','bathrooms','car_spaces','land_size_sqm',
                          'internal_area_sqm','condition_note','attribute_suggestions',
                          'attributes_confirmed_at','attributes_confirmed_by'))     as property_columns_expect_9,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'property_comparables')          as comparable_columns_expect_19,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'property_comparables')             as policies_expect_1,
  (select count(*) from pg_constraint
    where conname in ('property_comparables_source_check',
                      'property_comparables_weighting_check'))                      as checks_expect_2;
