-- ===== RUN THIS ONE. Migration 0052, property management (PM) Part A, 6 October 2026 =====
--
-- MIGRATION 0052 — property management, first version (Part A)
--
-- Brief: claude/RealComply-PM-build-brief-6-Oct.md (Part A). Design source of
-- truth: claude/RealComply-PM-design-decisions-6-Oct.md and its addendum.
--
-- PM sits BESIDE sales. Nothing here touches properties, property_items or any
-- other sales table, and nothing touches billing or plans.
--
-- What this adds:
--
--   1. agencies.pm_enabled. PM is off for every agency by default. Switched on
--      at the bottom of this script for Cass Property and Comply Real Estate
--      only. There is no in-app switch: turning PM on for an agency is a SQL
--      job, like platform admin (0044).
--   2. agencies.pm_records_system. Where the office keeps its PM records
--      ("PropertyMe"). Named once per agency; nothing is asked per item.
--      Set through set_agency_pm_records_system(), because agencies has a
--      SELECT policy only (same reasoning as set_agency_website, 0017).
--   3. pm_properties. One row per managed property: address, its one property
--      manager, how it came to RealComply (new or existing), and which group
--      it sits in (Onboarding, For lease, Tenanted, Tenant vacating, Vacant,
--      Archived).
--   4. pm_tenancies. One row per letting cycle (getting a tenant in, move-in,
--      the tenancy, exit). Part A only ever creates the first one; Part B adds
--      the next. Each tenancy is its own record and is never overwritten. The
--      move-in, vacate and move-out dates live here. before_stages lists the
--      stages that happened before the property came to RealComply: greyed,
--      never tickable, never recorded as done.
--   5. pm_item_states. The current state of each tick: done, N/A, or open
--      again after an untick. Holds no documents: RealComply holds no PM
--      documents, a tick records who confirmed it and when.
--   6. pm_item_events. Every tick, N/A and untick, ever. Written by a trigger
--      on pm_item_states, so it cannot be skipped by the app and cannot be
--      written to directly. Append-only: nothing is ever silently lost.
--   7. pm_group_moves. Every move between groups (Put up for lease, Tenant has
--      moved in, and so on), with the date entered. Append-only.
--
-- Security. Every table carries agency_id and is locked to the caller's agency
-- through current_agency_id(), the same pattern the sales tables use, so one
-- agency can never see another's properties. Archived people get nothing
-- (0035). The child tables use composite foreign keys (property_id, agency_id)
-- so a row can never point at another agency's property. Explicit grants for
-- every new table (RealComply-supabase-data-api-grants-30-Oct.md). Nothing is
-- granted to anon.
--
-- Which stage may be ticked (the locking rules) is enforced in the server
-- actions (src/lib/actions/pm.ts) against the rules layer
-- (src/lib/rules/nsw-pm.ts, src/lib/rules/pm-engine.ts), the same way the sales
-- stage hold is. The rules stay out of the database so another state is a
-- content job.
--
-- Nothing here rewrites existing rows except the two pm_enabled switches.
-- Safe to run more than once.

-- ── 1 and 2. The switch and the records system ─────────────────────────────
alter table public.agencies
  add column if not exists pm_enabled boolean not null default false,
  add column if not exists pm_records_system text;

comment on column public.agencies.pm_enabled is
  'Property management module switched on for this agency. Off by default. Set in SQL only (migration 0052 turned it on for Cass Property and Comply Real Estate).';
comment on column public.agencies.pm_records_system is
  'Where this office keeps its PM records, as the office names it (for example PropertyMe). Shown as "Records are kept in ...". Set with set_agency_pm_records_system().';

create or replace function public.set_agency_pm_records_system(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if v_agency is null then
    raise exception 'not authenticated';
  end if;
  if v_name is not null and length(v_name) > 80 then
    raise exception 'Keep the name of the records system under 80 characters.';
  end if;
  update public.agencies set pm_records_system = v_name where id = v_agency;
end;
$$;

revoke all on function public.set_agency_pm_records_system(text) from public;
grant execute on function public.set_agency_pm_records_system(text) to authenticated;

-- ── 3. Properties under management ─────────────────────────────────────────
create table if not exists public.pm_properties (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  address text not null check (length(btrim(address)) > 0),
  -- The one property manager, chosen from the agency's people.
  manager_id uuid not null references public.profiles(id),
  -- How it came to RealComply. 'new' runs Management onboarding (Stage 1);
  -- the two existing kinds never do.
  origin text not null check (origin in ('new', 'existing_tenanted', 'existing_vacant')),
  grp text not null check (grp in ('onboarding', 'for_lease', 'tenanted', 'tenant_vacating', 'vacant', 'archived')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id)
);

create index if not exists pm_properties_agency_grp_idx on public.pm_properties (agency_id, grp);
create index if not exists pm_properties_manager_idx on public.pm_properties (manager_id);

comment on table public.pm_properties is
  'Property management: one row per managed property. Sits beside the sales properties table and shares nothing with it.';

-- The property manager must belong to the same agency as the property.
create or replace function public.pm_properties_check_manager()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles
                  where id = new.manager_id and agency_id = new.agency_id) then
    raise exception 'The property manager must be someone in this agency.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pm_properties_check_manager on public.pm_properties;
create trigger pm_properties_check_manager
  before insert or update on public.pm_properties
  for each row execute function public.pm_properties_check_manager();

-- Same "no new work while lapsed" rule as sales listings (0036). Reuses the
-- existing function; billing itself is untouched.
drop trigger if exists pm_properties_entitlement_guard on public.pm_properties;
create trigger pm_properties_entitlement_guard
  before insert on public.pm_properties
  for each row execute function public.guard_agency_may_write();

-- ── 4. Tenancies (letting cycles) ──────────────────────────────────────────
create table if not exists public.pm_tenancies (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  property_id uuid not null,
  -- 1 for the first tenancy RealComply sees, then 2, 3 ... Part B adds them.
  seq integer not null default 1 check (seq >= 1),
  -- Stages that happened before RealComply (2, 3, and 5 for an existing
  -- vacant property). Greyed, not tickable, count as complete for locking.
  -- RealComply never records them as done.
  before_stages smallint[] not null default '{}',
  move_in_date date,
  vacate_date date,
  move_out_date date,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (property_id, seq),
  foreign key (property_id, agency_id) references public.pm_properties (id, agency_id) on delete cascade
);

create index if not exists pm_tenancies_agency_idx on public.pm_tenancies (agency_id);

comment on table public.pm_tenancies is
  'Property management: one row per tenancy (letting cycle). Never overwritten; a new tenant is a new row.';

-- ── 5. Current state of each tick ──────────────────────────────────────────
create table if not exists public.pm_item_states (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  property_id uuid not null,
  -- Null for Management onboarding items, which belong to the property and
  -- are done once. Set for every per-tenancy item.
  tenancy_id uuid,
  -- The item's key in the rules layer (src/lib/rules/nsw-pm.ts).
  item_key text not null,
  -- 'open' is what an untick leaves behind. The row stays so the history
  -- reads straight through.
  state text not null check (state in ('done', 'na', 'open')),
  changed_by uuid not null references public.profiles(id),
  changed_at timestamptz not null default now(),
  foreign key (property_id, agency_id) references public.pm_properties (id, agency_id) on delete cascade,
  foreign key (tenancy_id, agency_id) references public.pm_tenancies (id, agency_id) on delete cascade
);

create unique index if not exists pm_item_states_property_item_idx
  on public.pm_item_states (property_id, item_key) where tenancy_id is null;
create unique index if not exists pm_item_states_tenancy_item_idx
  on public.pm_item_states (tenancy_id, item_key) where tenancy_id is not null;
create index if not exists pm_item_states_agency_idx on public.pm_item_states (agency_id);

comment on table public.pm_item_states is
  'Property management: the current state of each tick (done, N/A, or open after an untick), who and when. No documents. Full history in pm_item_events.';

-- Who and when are the server's facts, not the caller's: whoever is signed in,
-- at the database's clock.
create or replace function public.pm_item_states_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.changed_by := coalesce(auth.uid(), new.changed_by);
  new.changed_at := now();
  return new;
end;
$$;

drop trigger if exists pm_item_states_stamp on public.pm_item_states;
create trigger pm_item_states_stamp
  before insert or update on public.pm_item_states
  for each row execute function public.pm_item_states_stamp();

-- ── 6. Every tick, N/A and untick, ever ────────────────────────────────────
create table if not exists public.pm_item_events (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  property_id uuid not null,
  tenancy_id uuid,
  item_key text not null,
  state text not null check (state in ('done', 'na', 'open')),
  changed_by uuid not null references public.profiles(id),
  changed_at timestamptz not null default now(),
  foreign key (property_id, agency_id) references public.pm_properties (id, agency_id) on delete cascade
);

create index if not exists pm_item_events_property_idx on public.pm_item_events (property_id);
create index if not exists pm_item_events_agency_idx on public.pm_item_events (agency_id);

comment on table public.pm_item_events is
  'Property management: one row for every tick, N/A and untick. Written only by a trigger on pm_item_states. Append-only.';

create or replace function public.pm_item_states_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.state = old.state then
    return new;
  end if;
  insert into public.pm_item_events (agency_id, property_id, tenancy_id, item_key, state, changed_by, changed_at)
  values (new.agency_id, new.property_id, new.tenancy_id, new.item_key, new.state, new.changed_by, new.changed_at);
  return new;
end;
$$;

drop trigger if exists pm_item_states_log on public.pm_item_states;
create trigger pm_item_states_log
  after insert or update on public.pm_item_states
  for each row execute function public.pm_item_states_log();

-- ── 7. Every move between groups ───────────────────────────────────────────
create table if not exists public.pm_group_moves (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  property_id uuid not null,
  tenancy_id uuid,
  from_grp text not null,
  to_grp text not null,
  -- The date entered with the move (move-in, vacate, move-out). Null for a
  -- move that asks only for a confirm.
  event_date date,
  moved_by uuid not null default auth.uid() references public.profiles(id),
  moved_at timestamptz not null default now(),
  foreign key (property_id, agency_id) references public.pm_properties (id, agency_id) on delete cascade
);

create index if not exists pm_group_moves_property_idx on public.pm_group_moves (property_id);

comment on table public.pm_group_moves is
  'Property management: one row per move between groups, with the date entered. Append-only.';

-- ── Row-level security ─────────────────────────────────────────────────────
alter table public.pm_properties enable row level security;
alter table public.pm_tenancies enable row level security;
alter table public.pm_item_states enable row level security;
alter table public.pm_item_events enable row level security;
alter table public.pm_group_moves enable row level security;

do $$
declare
  t text;
begin
  -- View, add and change, own agency only. No delete policy on any of them:
  -- a property leaves by moving to Archived, and a tick leaves by an untick
  -- that is itself recorded.
  foreach t in array array['pm_properties', 'pm_tenancies', 'pm_item_states'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                    and policyname = t || ': agency members can view') then
      execute format('create policy %I on public.%I for select using (agency_id = public.current_agency_id())',
                     t || ': agency members can view', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                    and policyname = t || ': agency members can add') then
      execute format('create policy %I on public.%I for insert with check (agency_id = public.current_agency_id())',
                     t || ': agency members can add', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                    and policyname = t || ': agency members can change') then
      execute format('create policy %I on public.%I for update using (agency_id = public.current_agency_id()) with check (agency_id = public.current_agency_id())',
                     t || ': agency members can change', t);
    end if;
  end loop;

  -- History: view only. Written by the trigger above.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pm_item_events'
                  and policyname = 'pm_item_events: agency members can view') then
    create policy "pm_item_events: agency members can view"
      on public.pm_item_events for select
      using (agency_id = public.current_agency_id());
  end if;

  -- Moves: view and add. Never changed.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pm_group_moves'
                  and policyname = 'pm_group_moves: agency members can view') then
    create policy "pm_group_moves: agency members can view"
      on public.pm_group_moves for select
      using (agency_id = public.current_agency_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pm_group_moves'
                  and policyname = 'pm_group_moves: agency members can add') then
    create policy "pm_group_moves: agency members can add"
      on public.pm_group_moves for insert
      with check (agency_id = public.current_agency_id());
  end if;
end
$$;

-- ── Grants (RealComply-supabase-data-api-grants-30-Oct.md). Nothing to anon. ─
grant select, insert, update on public.pm_properties to authenticated;
grant select, insert, update on public.pm_tenancies to authenticated;
grant select, insert, update on public.pm_item_states to authenticated;
grant select on public.pm_item_events to authenticated;
grant select, insert on public.pm_group_moves to authenticated;

grant select, insert, update, delete on public.pm_properties to service_role;
grant select, insert, update, delete on public.pm_tenancies to service_role;
grant select, insert, update, delete on public.pm_item_states to service_role;
grant select, insert, update, delete on public.pm_item_events to service_role;
grant select, insert, update, delete on public.pm_group_moves to service_role;

-- ── Switch PM on for the two agencies in the brief ─────────────────────────
update public.agencies set pm_enabled = true
 where name in ('Cass Property', 'Comply Real Estate');

-- ── Verify. Expected: 2 columns, 5 tables, 12 policies, 2 agencies with PM on ─
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'agencies'
      and column_name in ('pm_enabled', 'pm_records_system'))                     as columns_expect_2,
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('pm_properties', 'pm_tenancies', 'pm_item_states',
                         'pm_item_events', 'pm_group_moves'))                      as tables_expect_5,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename like 'pm\_%')                       as policies_expect_12,
  (select string_agg(name, ', ' order by name) from public.agencies
    where pm_enabled)                                                              as pm_on_expect_cass_and_comply;
