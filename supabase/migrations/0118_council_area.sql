-- ===== 0118: Each listing's council area, for metro or non-metro =====
--
-- NSW underquoting changes, from 17 November 2026 (Adam, 9 Nov 2026: "go
-- ahead with metro or non-metro"; Master, 9 Nov 2026: council area read from
-- the contract's planning certificate, asked when it can't be read).
--
-- Reg s12A: the metropolitan area is 36 named local government areas (from
-- Bayside to Woollahra); everywhere else in NSW is a non-metropolitan area.
-- Reg s12D(2) and (4): where the agent looks for comparable sales depends on
-- which it is (2 km and 6 months, or 12 if fewer than 3 are comparable, in
-- the metropolitan area; 5 km and 18 months outside it).
--
-- WAS: a listing had its address, but nothing said which council area it is
-- in, so nothing could say metro or non-metro.
-- NOW: each listing keeps
--   * its council area (the app keeps it to the 128 NSW council areas and
--     works out metro or non-metro from the Regulation's list),
--   * where it came from: read off the planning certificate in the contract,
--     or chosen by someone in the office,
--   * who set it and when. The database stamps these itself, so they can't
--     be typed in.
-- Listings already on file stay blank until the contract is read again or
-- someone chooses the council area.
--
-- No new table, so no new grants: properties keeps the access it has (0000),
-- which covers new columns. The check below confirms signed-in users can read
-- and change them. Safe to run twice.

begin;

-- ── 1. The new columns ───────────────────────────────────────────────────
alter table public.properties add column if not exists council_area text;
alter table public.properties add column if not exists council_area_from text;
alter table public.properties add column if not exists council_area_set_by uuid references public.profiles(id) on delete set null;
alter table public.properties add column if not exists council_area_set_at timestamptz;

alter table public.properties drop constraint if exists properties_council_area_text;
alter table public.properties add constraint properties_council_area_text
  check (council_area is null or length(btrim(council_area)) between 1 and 80);
alter table public.properties drop constraint if exists properties_council_area_from;
alter table public.properties add constraint properties_council_area_from
  check (council_area_from is null or council_area_from in ('planning_certificate', 'agent'));
alter table public.properties drop constraint if exists properties_council_area_together;
alter table public.properties add constraint properties_council_area_together
  check ((council_area is null) = (council_area_from is null)
         and (council_area is null) = (council_area_set_at is null));

comment on column public.properties.council_area is
  'The council area the listing is in (Reg s12A; 0118), one of the 128 NSW council areas. The app works out metro or non-metro from it.';
comment on column public.properties.council_area_from is
  'Where the council area came from (0118): planning_certificate (read off the contract) or agent (chosen in the app).';
comment on column public.properties.council_area_set_by is
  'Who set the council area (0118). Stamped by the database.';
comment on column public.properties.council_area_set_at is
  'When the council area was set (0118). Stamped by the database.';

-- ── 2. Who and when, stamped by the database ─────────────────────────────
-- Set whenever the council area or where it came from changes; anything
-- else sent for these two columns is put back as it was.
create or replace function public.stamp_council_area()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or new.council_area is distinct from old.council_area
     or new.council_area_from is distinct from old.council_area_from then
    new.council_area_set_at := case when new.council_area is null then null else now() end;
    new.council_area_set_by := case when new.council_area is null then null else auth.uid() end;
  else
    new.council_area_set_at := old.council_area_set_at;
    new.council_area_set_by := old.council_area_set_by;
  end if;
  return new;
end;
$$;
revoke execute on function public.stamp_council_area() from public, anon, authenticated;

drop trigger if exists properties_council_area_stamp on public.properties;
create trigger properties_council_area_stamp
  before insert or update of council_area, council_area_from, council_area_set_by, council_area_set_at
  on public.properties
  for each row execute function public.stamp_council_area();

commit;

-- ── Check ──────────────────────────────────────────────────────────────
-- One row, every value true.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'properties'
      and column_name in ('council_area', 'council_area_from', 'council_area_set_by', 'council_area_set_at')) = 4
    as columns_added,
  (select count(*) from pg_constraint
    where conrelid = 'public.properties'::regclass
      and conname in ('properties_council_area_text', 'properties_council_area_from', 'properties_council_area_together')) = 3
    as rules_added,
  exists (select 1 from pg_trigger
           where tgrelid = 'public.properties'::regclass and tgname = 'properties_council_area_stamp' and not tgisinternal)
    as stamp_added,
  has_column_privilege('authenticated', 'public.properties', 'council_area', 'select')
    and has_column_privilege('authenticated', 'public.properties', 'council_area', 'update')
    and has_column_privilege('authenticated', 'public.properties', 'council_area_from', 'update')
    as signed_in_users_can_set_it,
  (select count(*) from public.properties
    where (council_area is null) <> (council_area_from is null)
       or (council_area is null) <> (council_area_set_at is null)) = 0
    as every_listing_consistent;
