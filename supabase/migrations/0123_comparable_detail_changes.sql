-- 0123: Edit a comparable's details (Adam, 10 Nov 2026).
--
-- An "Edit details" link on each comparable sale changes its bedrooms,
-- bathrooms, parking, land size, floor area, sold price and sale date. The
-- edited figures are used from then on, including in the drafted reasoning.
-- What was read from the report is kept: every change is written here, one
-- row per figure, by the database itself, with who and when. The card and
-- the compliance record then say, for example:
--
--   Changed by Ana Agent, 10 November 2026: land size 650 m² (read from
--   report) to 210 m²
--
-- Nobody writes to this table directly. The trigger below does, on any
-- change to one of the seven figures, whoever makes it and however. Nobody
-- changes or deletes a row: it goes with its sale, its listing or its office.
--
-- Run once, in the SQL editor. Safe to run again.

create table if not exists public.property_comparable_changes (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  comparable_id uuid not null references public.property_comparables (id) on delete cascade,
  field text not null check (field in (
    'bedrooms', 'bathrooms', 'car_spaces', 'land_size_sqm', 'internal_area_sqm', 'sale_price', 'sale_date')),
  -- As stored: '650.00', '2026-10-01'. Null where the figure was empty.
  old_value text,
  new_value text,
  -- The figure changed was the one the report gave: a sale from the report,
  -- and this figure not changed before.
  was_from_report boolean not null,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_by_name text not null check (char_length(changed_by_name) between 1 and 200),
  changed_at timestamptz not null default now()
);

create index if not exists property_comparable_changes_comparable
  on public.property_comparable_changes (comparable_id, changed_at);
create index if not exists property_comparable_changes_property
  on public.property_comparable_changes (property_id);

comment on table public.property_comparable_changes is
  'Every change to a comparable sale''s bedrooms, bathrooms, parking, land size, floor area, sold price or sale date, written by the database when the sale is changed (0123). Read only.';

alter table public.property_comparable_changes enable row level security;

-- Whoever can see the sale can see what was changed on it. No policy for
-- adding, changing or deleting: only the trigger writes.
drop policy if exists "comparable changes: whoever sees the listing can view" on public.property_comparable_changes;
create policy "comparable changes: whoever sees the listing can view" on public.property_comparable_changes
  for select using (agency_id = public.current_agency_id() and public.can_read_property(property_id));

-- Grants (every new table in public carries its own): read only for a
-- signed-in person, through the policy above; nothing signed out.
revoke all on table public.property_comparable_changes from public, anon, authenticated;
grant select on public.property_comparable_changes to authenticated;
grant select, insert, update, delete on public.property_comparable_changes to service_role;

drop trigger if exists property_comparable_changes_not_ended_guard on public.property_comparable_changes;
create trigger property_comparable_changes_not_ended_guard
  before insert or update or delete on public.property_comparable_changes
  for each row execute function public.guard_agency_not_ended();

-- ── Written by the database when a sale's figures change ────────────────
-- After the update, so only a change that went through (past the signed-off
-- lock and the office's own rules) is recorded. One row per figure changed.
create or replace function public.log_comparable_detail_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_field text;
begin
  select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.email), ''))
    into v_name
    from public.profiles p
   where p.id = v_uid;

  foreach v_field in array array[
    'bedrooms', 'bathrooms', 'car_spaces', 'land_size_sqm', 'internal_area_sqm', 'sale_price', 'sale_date']
  loop
    if (v_old ->> v_field) is distinct from (v_new ->> v_field) then
      insert into public.property_comparable_changes
        (agency_id, property_id, comparable_id, field, old_value, new_value, was_from_report, changed_by, changed_by_name)
      values (
        new.agency_id, new.property_id, new.id, v_field, v_old ->> v_field, v_new ->> v_field,
        old.source = 'report' and not exists (
          select 1 from public.property_comparable_changes c
           where c.comparable_id = new.id and c.field = v_field),
        case when v_name is null then null else v_uid end,
        coalesce(left(v_name, 200), 'RealComply'));
    end if;
  end loop;
  return new;
end
$$;
revoke execute on function public.log_comparable_detail_changes() from public, anon, authenticated;

drop trigger if exists property_comparables_detail_changes on public.property_comparables;
create trigger property_comparables_detail_changes
  after update of bedrooms, bathrooms, car_spaces, land_size_sqm, internal_area_sqm, sale_price, sale_date
  on public.property_comparables
  for each row execute function public.log_comparable_detail_changes();

-- ── Check query (run after; every column should be true) ─────────────────
-- select
--   to_regclass('public.property_comparable_changes') is not null                      as changes_table,
--   (select relrowsecurity from pg_class where oid = 'public.property_comparable_changes'::regclass) as rls_on,
--   (select count(*) from pg_policies where schemaname = 'public'
--      and tablename = 'property_comparable_changes') = 1
--     and (select cmd from pg_policies where schemaname = 'public'
--      and tablename = 'property_comparable_changes') = 'SELECT'                        as one_read_policy,
--   has_table_privilege('authenticated', 'public.property_comparable_changes', 'select')
--     and not has_table_privilege('authenticated', 'public.property_comparable_changes', 'insert')
--     and not has_table_privilege('authenticated', 'public.property_comparable_changes', 'update')
--     and not has_table_privilege('authenticated', 'public.property_comparable_changes', 'delete') as signed_in_read_only,
--   not has_table_privilege('anon', 'public.property_comparable_changes', 'select')    as signed_out_nothing,
--   has_table_privilege('service_role', 'public.property_comparable_changes', 'insert') as app_writes,
--   (select prosecdef from pg_proc where proname = 'log_comparable_detail_changes')    as writer_is_definer,
--   not has_function_privilege('authenticated', 'public.log_comparable_detail_changes()', 'execute') as not_callable,
--   exists (select 1 from pg_trigger where tgname = 'property_comparables_detail_changes'
--      and tgrelid = 'public.property_comparables'::regclass)                          as written_on_change,
--   exists (select 1 from pg_trigger where tgname = 'property_comparable_changes_not_ended_guard') as ended_guard,
--   (select count(*) from public.property_comparable_changes) = 0                      as nothing_changed_yet;
