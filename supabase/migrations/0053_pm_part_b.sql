-- ===== RUN THIS ONE. Migration 0053, property management (PM) Part B, 6 October 2026 =====
--
-- MIGRATION 0053 — property management, Part B
--
-- Brief: claude/RealComply-PM-build-brief-6-Oct.md (Part B). Run after 0052.
-- Adds to the PM tables only. Nothing here touches sales, billing or plans.
--
-- What this adds:
--
--   1. Who ended the tenancy (pm_tenancies.ended_by) and, when the landlord
--      ended it, the ground (pm_tenancies.termination_ground). The Exit
--      wording for each ground lives in the rules file, not here.
--   2. Management has ended (pm_properties.management_ended_on and
--      management_ended_reason). The property moves to Archived.
--   3. pm_item_states.detail and pm_item_events.detail: the answers behind an
--      item that is more than a tick (the three water usage questions). Kept
--      in the history like every tick.
--   4. pm_records. Things that are recorded rather than ticked, each press
--      with the person and the time: Property being sold, Photos for
--      advertising, Landlord or agent details change, pet requests (Stage 4)
--      and Pet on the application (Stage 2). A pet request can later be
--      marked "Response given"; nothing else on a record can change.
--   5. pm_retention_reminders. One row per 3-year file reminder sent, so the
--      daily job never sends the same one twice. Written only by the server
--      (service role); nobody signed in can read or write it.
--
-- Same security as 0052: every table carries agency_id, is locked to the
-- caller's agency through current_agency_id(), and uses composite foreign
-- keys so a row can never point at another agency's property. Grants for
-- every new table; nothing to anon.
--
-- Safe to run more than once.

-- ── 1. Who ended the tenancy, and on what ground ───────────────────────────
alter table public.pm_tenancies
  add column if not exists ended_by text,
  add column if not exists termination_ground text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pm_tenancies_ended_by_check') then
    alter table public.pm_tenancies
      add constraint pm_tenancies_ended_by_check check (ended_by in ('tenant', 'landlord'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pm_tenancies_termination_ground_check') then
    alter table public.pm_tenancies
      add constraint pm_tenancies_termination_ground_check check (
        termination_ground is null
        or (termination_ground in ('owner_moving_in', 'sold_vacant_possession', 'offered_for_sale',
                                   'renovation', 'breach', 'other_ground')
            and ended_by = 'landlord'));
  end if;
end
$$;

comment on column public.pm_tenancies.ended_by is
  'Who ended the tenancy: tenant or landlord. Asked with "Tenant is vacating".';
comment on column public.pm_tenancies.termination_ground is
  'The ground, when the landlord ended it. The notice, documents and exclusion period for each ground are in src/lib/rules/nsw-pm.ts.';

-- ── 2. Management has ended ─────────────────────────────────────────────────
alter table public.pm_properties
  add column if not exists management_ended_on date,
  add column if not exists management_ended_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pm_properties_management_ended_reason_check') then
    alter table public.pm_properties
      add constraint pm_properties_management_ended_reason_check check (
        management_ended_reason in ('owner_moving_in', 'sold', 'renovation', 'another_agent'));
  end if;
end
$$;

comment on column public.pm_properties.management_ended_on is
  'The date the management ended ("Management has ended"). The 3-year file reminder counts from here.';

-- ── 3. The answers behind an item ──────────────────────────────────────────
alter table public.pm_item_states add column if not exists detail jsonb not null default '{}'::jsonb;
alter table public.pm_item_events add column if not exists detail jsonb not null default '{}'::jsonb;

-- The history now records a change of answers as well as a change of state.
create or replace function public.pm_item_states_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.state = old.state and new.detail = old.detail then
    return new;
  end if;
  insert into public.pm_item_events (agency_id, property_id, tenancy_id, item_key, state, detail, changed_by, changed_at)
  values (new.agency_id, new.property_id, new.tenancy_id, new.item_key, new.state, new.detail, new.changed_by, new.changed_at);
  return new;
end;
$$;

-- ── 4. Things recorded rather than ticked ──────────────────────────────────
create table if not exists public.pm_records (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  property_id uuid not null,
  tenancy_id uuid not null,
  kind text not null check (kind in ('property_sold', 'advertising_photos', 'details_change',
                                     'pet_request', 'pet_application')),
  -- Pets only: the date received, the outcome and the ground. Empty otherwise.
  data jsonb not null default '{}'::jsonb,
  recorded_by uuid not null default auth.uid() references public.profiles(id),
  recorded_at timestamptz not null default now(),
  -- Pet requests only: "Response given" pressed.
  response_given_by uuid references public.profiles(id),
  response_given_at timestamptz,
  foreign key (property_id, agency_id) references public.pm_properties (id, agency_id) on delete cascade,
  foreign key (tenancy_id, agency_id) references public.pm_tenancies (id, agency_id) on delete cascade
);

create index if not exists pm_records_property_idx on public.pm_records (property_id);
create index if not exists pm_records_agency_idx on public.pm_records (agency_id);

comment on table public.pm_records is
  'Property management: things recorded rather than ticked (Stage 4 events, pet requests, pet on the application). Who and when on every row. Only "Response given" can be added later.';

-- Who and when are the server's facts. On a later update only "Response
-- given" may change, and it is stamped the same way.
create or replace function public.pm_records_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.recorded_by := coalesce(auth.uid(), new.recorded_by);
    new.recorded_at := now();
    new.response_given_by := null;
    new.response_given_at := null;
    return new;
  end if;
  if new.agency_id <> old.agency_id or new.property_id <> old.property_id
     or new.tenancy_id <> old.tenancy_id or new.kind <> old.kind or new.data <> old.data
     or new.recorded_by <> old.recorded_by or new.recorded_at <> old.recorded_at then
    raise exception 'A record cannot be changed once it is saved.';
  end if;
  if old.kind <> 'pet_request' or old.response_given_at is not null then
    raise exception 'A record cannot be changed once it is saved.';
  end if;
  new.response_given_by := coalesce(auth.uid(), new.response_given_by);
  new.response_given_at := now();
  return new;
end;
$$;

drop trigger if exists pm_records_stamp on public.pm_records;
create trigger pm_records_stamp
  before insert or update on public.pm_records
  for each row execute function public.pm_records_stamp();

-- ── 5. File reminders sent ─────────────────────────────────────────────────
create table if not exists public.pm_retention_reminders (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  -- 'tenancy': 3 years after the tenant moved out. 'management': 3 years
  -- after the management ended.
  subject_kind text not null check (subject_kind in ('tenancy', 'management')),
  subject_id uuid not null,
  due_date date not null,
  recipients text[] not null default '{}',
  sent_at timestamptz not null default now(),
  unique (subject_kind, subject_id, due_date)
);

comment on table public.pm_retention_reminders is
  'Property management: one row per 3-year file reminder sent. Written by the daily job only, so a reminder is never sent twice.';

-- ── Row-level security ─────────────────────────────────────────────────────
alter table public.pm_records enable row level security;
alter table public.pm_retention_reminders enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pm_records'
                  and policyname = 'pm_records: agency members can view') then
    create policy "pm_records: agency members can view"
      on public.pm_records for select
      using (agency_id = public.current_agency_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pm_records'
                  and policyname = 'pm_records: agency members can add') then
    create policy "pm_records: agency members can add"
      on public.pm_records for insert
      with check (agency_id = public.current_agency_id());
  end if;
  -- Only "Response given" can change (the trigger above refuses anything else).
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pm_records'
                  and policyname = 'pm_records: agency members can mark a response given') then
    create policy "pm_records: agency members can mark a response given"
      on public.pm_records for update
      using (agency_id = public.current_agency_id())
      with check (agency_id = public.current_agency_id());
  end if;
  -- pm_retention_reminders has no policies on purpose: only the service role
  -- (the daily job) reads or writes it.
end
$$;

-- ── Grants. Nothing to anon. ───────────────────────────────────────────────
grant select, insert, update on public.pm_records to authenticated;
grant select, insert, update, delete on public.pm_records to service_role;
grant select, insert, update, delete on public.pm_retention_reminders to service_role;

-- ── Verify. Expected: 6 columns, 2 tables, 15 policies ─────────────────────
select
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'pm_tenancies' and column_name in ('ended_by', 'termination_ground'))
        or (table_name = 'pm_properties' and column_name in ('management_ended_on', 'management_ended_reason'))
        or (table_name in ('pm_item_states', 'pm_item_events') and column_name = 'detail'))) as columns_expect_6,
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('pm_records', 'pm_retention_reminders'))                       as tables_expect_2,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename like 'pm\_%')                             as policies_expect_15;
