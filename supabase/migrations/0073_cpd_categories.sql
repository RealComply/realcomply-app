-- ===== RUN THIS ONE. Migration 0073, CPD with more than one category of practice, 14 October 2026 =====
--
-- Brief of 14 Oct 2026 (Adam; mockup approved). Trent Lloyd holds residential
-- sales, business broking and stock and station. The category of practice
-- took one value (0020), so his CPD showed a third of what he has to do.
--
-- What this file does:
--
--   1. profiles.cpd_categories: every category and area a person works in,
--      ticked, not picked from a list of one. Each person's existing single
--      category (profiles.cpd_practice_category, 0020) is moved across. The
--      old column stays as it was, for the record, and the app stops reading it.
--   2. profiles.cpd_livestock_only: an assistant agent in stock and station
--      who only sells livestock, who has no CPD to do.
--   3. profiles.licence_started_on: when the licence or certificate started.
--      A licence that starts late in the CPD year is exempt for that year, and
--      an assistant agent who starts part way through owes 1 unit, not 3.
--   4. cpd_records.topics: the compulsory topics a certificate covers, read off
--      it when it is uploaded. cpd_records.topics_not_covered: the categories
--      the person (or their licensee) unticked for a topic, because the course
--      didn't cover that category's learning outcomes. Who last changed either
--      and when.
--
-- The hours and the topics themselves are NOT in the database. Fair Trading
-- republishes them each year, so they live in the app's rules layer
-- (src/lib/rules/nsw-cpd.ts), dated and versioned by CPD year. The topics
-- column holds that ruleset's topic keys.
--
-- No new tables, so no new grants: the columns fall under the policies the
-- two tables already have (0058: your own, or the licensee's). Nothing is
-- deleted. Safe to run more than once.

begin;

-- Order check: 0020 (the single category) and 0051 (undated certificates) first.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profiles'
                    and column_name = 'cpd_practice_category')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'cpd_records'
                       and column_name = 'completed_date' and is_nullable = 'YES') then
    raise exception 'Run 0020 and 0051 before this one. Nothing was changed.';
  end if;
end $$;

-- ── 1 to 3. The person ──────────────────────────────────────────────────
alter table public.profiles add column if not exists cpd_categories text[] not null default '{}';
alter table public.profiles add column if not exists cpd_livestock_only boolean not null default false;
alter table public.profiles add column if not exists licence_started_on date;

alter table public.profiles drop constraint if exists profiles_cpd_categories_ok;
alter table public.profiles add constraint profiles_cpd_categories_ok check (
  cpd_categories <@ array[
    'residential_sales', 'residential_property_management', 'buyers_agent', 'commercial',
    'business_broking', 'onsite_short_term_rpm', 'strata', 'stock_and_station'
  ]::text[]
);

comment on column public.profiles.cpd_categories is
  'Every category of practice and real estate area the person works in (0073). Sets their CPD for the year: the hours and topics for each are in the app''s rules layer. Empty = not recorded; the app says it can''t state a requirement rather than assume one.';
comment on column public.profiles.cpd_livestock_only is
  'An assistant agent in stock and station who only sells livestock: exempt from CPD (0073). Read only for a certificate of registration.';
comment on column public.profiles.licence_started_on is
  'When the licence or certificate of registration started (0073). Only matters for the part-year rules: a start late in the CPD year is exempt for that year, and an assistant agent who starts part way through owes 1 unit.';
comment on column public.profiles.cpd_practice_category is
  'Superseded by cpd_categories (0073), which this was copied into. Kept as it was; the app no longer reads it.';

-- Move each person's single category across. Same names, so it is a straight
-- copy. The old "Residential sales / buyer's agent" choice was stored as
-- residential_sales, and moves across as residential sales.
update public.profiles
   set cpd_categories = array[cpd_practice_category]
 where cpd_practice_category in (
         'residential_sales', 'residential_property_management', 'commercial', 'business_broking',
         'onsite_short_term_rpm', 'strata', 'stock_and_station')
   and cpd_categories = '{}';

-- ── 4. What each certificate covers ─────────────────────────────────────
alter table public.cpd_records add column if not exists topics text[];
alter table public.cpd_records add column if not exists topics_not_covered text[] not null default '{}';
alter table public.cpd_records add column if not exists topics_changed_by uuid references public.profiles(id) on delete set null;
alter table public.cpd_records add column if not exists topics_changed_at timestamptz;

alter table public.cpd_records drop constraint if exists cpd_records_topics_ok;
alter table public.cpd_records add constraint cpd_records_topics_ok check (
  (topics is null or (cardinality(topics) <= 40
                      and array_to_string(topics, ',') ~ '^([a-z0-9_]{1,60}(,[a-z0-9_]{1,60})*)?$'))
  and cardinality(topics_not_covered) <= 80
  and array_to_string(topics_not_covered, ',') ~ '^([a-z0-9_]{1,60}:[a-z_]{1,40}(,[a-z0-9_]{1,60}:[a-z_]{1,40})*)?$'
);

comment on column public.cpd_records.topics is
  'The compulsory topics this certificate covers, as topic keys from the rules layer for its CPD year (0073). Null = not read for topics yet (the app reads the title); empty = none of them.';
comment on column public.cpd_records.topics_not_covered is
  'topic:category pairs unticked by the person or their licensee, because the course did not cover that category''s learning outcomes (0073).';
comment on column public.cpd_records.topics_changed_by is
  'Who last changed which topics this certificate counts for (0073).';

-- ── Check ───────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('cpd_categories', 'cpd_livestock_only', 'licence_started_on')) = 3 as person_columns,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'cpd_records'
      and column_name in ('topics', 'topics_not_covered', 'topics_changed_by', 'topics_changed_at')) = 4 as certificate_columns,
  (select count(*) from public.profiles
    where cpd_practice_category is not null and not (cpd_practice_category = any (cpd_categories))) = 0 as categories_moved,
  (select count(*) from public.profiles where cardinality(cpd_categories) > 0) as people_with_categories;

commit;
