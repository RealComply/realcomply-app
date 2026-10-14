-- ===== RUN THIS ONE. Migration 0073, more than one type of licence, 14 October 2026 =====
--
-- Trent Lloyd holds residential sales, business broking and stock and station.
-- The category of practice took one value (0020), so his CPD looked like a
-- third of what he has to do.
--
-- Adam, 14 Oct 2026: "We want an agent to be able to select which class of
-- license they hold. And then when it comes to CPD points for the year, they
-- simply tick whether or not they have completed what's relevant and then
-- have the option of uploading their CPD certificate from whichever trainer
-- they used. That's it. Keep it simple."
--
-- What this file does:
--
--   1. profiles.licence_categories: every type of licence or certificate the
--      person holds, ticked (residential sales, business broking, stock and
--      station and so on). The class (Class 1, Class 2, certificate of
--      registration) stays in licence_type, as now.
--   2. Each person's existing single category (profiles.cpd_practice_category)
--      is copied across. The old column is kept as it was; the app stops
--      reading it.
--
-- The CPD itself is unchanged: one tick for the year (cpd_year_signoffs, 0023)
-- and, if they like, the certificate. No hours and no topics are kept.
--
-- No new tables, so no new grants: the column falls under the profile
-- policies the table already has. Nothing is deleted. Safe to run more than
-- once.

begin;

-- Order check: 0020 (the single category) first.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profiles'
                    and column_name = 'cpd_practice_category') then
    raise exception 'Run 0020 before this one. Nothing was changed.';
  end if;
end $$;

alter table public.profiles add column if not exists licence_categories text[] not null default '{}';

alter table public.profiles drop constraint if exists profiles_licence_categories_ok;
alter table public.profiles add constraint profiles_licence_categories_ok check (
  licence_categories <@ array[
    'residential_sales', 'residential_property_management', 'buyers_agent', 'commercial',
    'business_broking', 'onsite_short_term_rpm', 'strata', 'stock_and_station'
  ]::text[]
);

comment on column public.profiles.licence_categories is
  'Every type of licence or certificate the person holds, ticked on their licence card (0073). The class is licence_type.';
comment on column public.profiles.cpd_practice_category is
  'Superseded by licence_categories (0073), which this was copied into. Kept as it was; the app no longer reads it.';

-- Copy each person's single category across. Same names, so it is a straight
-- copy. The old "Residential sales / buyer's agent" choice was stored as
-- residential_sales, and moves across as residential sales.
update public.profiles
   set licence_categories = array[cpd_practice_category]
 where cpd_practice_category in (
         'residential_sales', 'residential_property_management', 'commercial', 'business_broking',
         'onsite_short_term_rpm', 'strata', 'stock_and_station')
   and licence_categories = '{}';

-- ── Check ───────────────────────────────────────────────────────────────
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'profiles'
             and column_name = 'licence_categories') as column_added,
  (select count(*) from public.profiles
    where cpd_practice_category is not null and not (cpd_practice_category = any (licence_categories))) = 0 as categories_moved,
  (select count(*) from public.profiles where cardinality(licence_categories) > 0) as people_with_licences_ticked;

commit;
