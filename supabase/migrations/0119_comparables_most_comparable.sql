-- ===== 0119: The 3 most comparable sales, each with its reason and the factors weighed =====
--
-- NSW underquoting changes, from 17 November 2026 (Adam, 9 Nov 2026: "go
-- ahead with comparables"; Master, 9 Nov 2026: "one of the 3 most
-- comparable" with a reason and the factors weighed).
--
-- Reg s12C: the agent takes into account the sold prices of the 3 most
-- comparable properties (all of them, if fewer than 3 are comparable).
-- Reg s12D(3) and (5): comparable having regard to the comparison factors,
-- (a) to (o); the 3 most comparable among them.
-- Reg s12F(1)(a)(ii) and (iii): the record says how the agent considered the
-- comparison factors, and why the 3 are the most comparable.
--
-- WAS: each comparable sale on a listing was marked "Relied on" or
-- "Considered", with a note. Nothing said which were the 3 most comparable.
-- NOW: a sale marked "Relied on" can also be marked one of the 3 most
-- comparable, with
--   * the reason it is (required with the mark), and
--   * the comparison factors the agent weighed, from the Regulation's list.
-- The database keeps it to 3 per listing, and only on a sale relied on.
-- Sales already on file are unmarked.
--
-- No new table, so no new grants: property_comparables keeps the access it
-- has (0000), which covers new columns. The check below confirms signed-in
-- users can read and change them. Safe to run twice.

begin;

-- ── 1. The new columns ───────────────────────────────────────────────────
alter table public.property_comparables add column if not exists most_comparable boolean not null default false;
alter table public.property_comparables add column if not exists most_comparable_reason text;
alter table public.property_comparables add column if not exists comparison_factors text[] not null default '{}';

-- One of the 3 most comparable only on a sale relied on, and only with a reason.
alter table public.property_comparables drop constraint if exists property_comparables_most_comparable_reason;
alter table public.property_comparables add constraint property_comparables_most_comparable_reason
  check (not most_comparable
         or (weighting = 'relied' and length(btrim(coalesce(most_comparable_reason, ''))) between 1 and 2000));

-- The comparison factors, Reg s12D(3)(a) to (o), and nothing else.
alter table public.property_comparables drop constraint if exists property_comparables_comparison_factors;
alter table public.property_comparables add constraint property_comparables_comparison_factors
  check (comparison_factors <@ array[
    'date_sold', 'location', 'dwelling_type', 'condition', 'layout', 'floor_area', 'beds_baths', 'parking',
    'special_features', 'construction', 'age', 'style', 'build_status', 'land_size', 'zoning_frontage'
  ]::text[]);

comment on column public.property_comparables.most_comparable is
  'One of the 3 most comparable properties for the listing (Reg s12C, s12D(5); 0119). Only on a sale relied on; at most 3 per listing.';
comment on column public.property_comparables.most_comparable_reason is
  'Why the agent considers it one of the 3 most comparable (Reg s12F(1)(a)(iii); 0119). Required with the mark.';
comment on column public.property_comparables.comparison_factors is
  'The comparison factors the agent weighed for this sale, Reg s12D(3)(a) to (o) (0119).';

-- ── 2. No more than 3 per listing ────────────────────────────────────────
-- Checked one listing at a time, so two marks saved together can't both
-- make the fourth.
create or replace function public.guard_three_most_comparable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_others integer;
begin
  if not new.most_comparable then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('most_comparable:' || new.property_id::text));
  select count(*) into v_others
    from public.property_comparables
   where property_id = new.property_id and most_comparable and id <> new.id;
  if v_others >= 3 then
    raise exception 'Only 3 sales can be marked as the most comparable. Take the mark off one first.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_three_most_comparable() from public, anon, authenticated;

drop trigger if exists property_comparables_three_most_comparable on public.property_comparables;
create trigger property_comparables_three_most_comparable
  before insert or update of most_comparable, property_id on public.property_comparables
  for each row execute function public.guard_three_most_comparable();

commit;

-- ── Check ──────────────────────────────────────────────────────────────
-- One row, every value true.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'property_comparables'
      and column_name in ('most_comparable', 'most_comparable_reason', 'comparison_factors')) = 3
    as columns_added,
  (select count(*) from pg_constraint
    where conrelid = 'public.property_comparables'::regclass
      and conname in ('property_comparables_most_comparable_reason', 'property_comparables_comparison_factors')) = 2
    as rules_added,
  exists (select 1 from pg_trigger
           where tgrelid = 'public.property_comparables'::regclass
             and tgname = 'property_comparables_three_most_comparable' and not tgisinternal)
    as three_at_most_added,
  has_column_privilege('authenticated', 'public.property_comparables', 'most_comparable', 'update')
    and has_column_privilege('authenticated', 'public.property_comparables', 'most_comparable_reason', 'update')
    and has_column_privilege('authenticated', 'public.property_comparables', 'comparison_factors', 'select')
    as signed_in_users_can_mark,
  (select count(*) from public.property_comparables where most_comparable) = 0
    as none_marked_yet;
