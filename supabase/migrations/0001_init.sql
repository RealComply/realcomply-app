-- RealComply — initial schema
-- Agencies (tenants), profiles (agent / licensee-in-charge roles), properties
-- (multi-property, replacing the single hardcoded prototype property), and a
-- flexible property_items table for the compliance checklist state.
--
-- Every tenant-scoped table carries agency_id and is locked down with
-- Row-Level Security so one agency can never see another's data, per the
-- tenant-isolation note in RealComply-tech-stack-notes.md.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────
-- Agencies (tenants)
-- ─────────────────────────────────────────────────────────────────────────
create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- Profiles — one per auth.users row, scoped to exactly one agency.
-- is_agent / is_licensee_in_charge are independent flags (not mutually
-- exclusive) because a sole-principal agency's one user holds both roles —
-- see RealComply-rules-schema.md §4.3 (authority roles) and the product
-- philosophy doc on licensee-only sign-off.
-- ─────────────────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  full_name text,
  email text not null,
  is_agent boolean not null default true,
  is_licensee_in_charge boolean not null default false,
  created_at timestamptz not null default now()
);

create index profiles_agency_id_idx on public.profiles(agency_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Properties — the multi-property replacement for the single hardcoded
-- listing in the HTML prototype. property_type/is_strata/is_tenanted/
-- has_pool are the setup answers that drive which compliance items apply
-- (tenancy sub-module, strata pool-certificate exemption, etc).
-- stage: 0 Listing set-up · 1 Pre-market · 2 On market · 3 Campaign ·
--        4 Under offer · 5 Settled  (matches the prototype's six stages).
-- ─────────────────────────────────────────────────────────────────────────
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  address text not null,
  property_type text not null default 'House',
  is_strata boolean,
  is_tenanted boolean,
  has_pool boolean,
  stage smallint not null default 0,
  test_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index properties_agency_id_idx on public.properties(agency_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Property items — flexible per-property compliance checklist state.
-- One row per checklist item per property. Deliberately generic (item_key +
-- jsonb data) rather than one column per item, because the rules schema
-- (RealComply-rules-schema.md) models obligations as data, not hardcoded
-- fields — new items/states should not require a schema migration.
--
-- event_date / recorded_at implement the dual-timestamp rule from the
-- product philosophy doc §3: event_date is agent-asserted and editable;
-- recorded_at is server-set and immutable (never updated after insert).
-- evidence_path points at Supabase Storage for uploaded documents; the
-- extracted_date columns support evidence-first date capture (§4).
-- ─────────────────────────────────────────────────────────────────────────
create table public.property_items (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  item_key text not null,
  status text not null default 'open',        -- open | done | flagged
  event_date date,                             -- agent-asserted, editable
  recorded_at timestamptz not null default now(),  -- immutable — do not update
  data jsonb not null default '{}'::jsonb,      -- item-specific fields (notes, amounts, etc.)
  evidence_path text,                           -- Supabase Storage path, if any
  extracted_date date,                          -- AI-extracted date from evidence, pre-fill only
  completed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index property_items_property_id_idx on public.property_items(property_id);
create index property_items_agency_id_idx on public.property_items(agency_id);
create unique index property_items_property_item_key_idx on public.property_items(property_id, item_key);

-- ─────────────────────────────────────────────────────────────────────────
-- Bootstrap RPC — creates a new agency + the caller's own profile together.
-- SECURITY DEFINER because RLS would otherwise block the very first insert
-- (a brand-new user has no agency_id yet to satisfy any policy). Only ever
-- creates data tied to auth.uid() — cannot be used to act as anyone else.
-- First user of a new agency gets both roles ("wears both hats"), matching
-- how Adam operates at Cass Property today.
-- ─────────────────────────────────────────────────────────────────────────
create function public.bootstrap_agency(p_agency_name text, p_full_name text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency_id uuid;
  v_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'profile already exists for this user';
  end if;

  insert into public.agencies (name) values (p_agency_name)
    returning id into v_agency_id;

  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge)
    values (
      auth.uid(),
      v_agency_id,
      p_full_name,
      (select email from auth.users where id = auth.uid()),
      true,
      true
    )
    returning * into v_profile;

  return v_profile;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Row-Level Security — every tenant-scoped table locked to the caller's
-- own agency_id via their profile. This is the one thing flagged in
-- RealComply-tech-stack-notes.md as needing to be right and reviewed.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.agencies enable row level security;
alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.property_items enable row level security;

-- Helper: the calling user's agency_id (or null if no profile yet).
create function public.current_agency_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select agency_id from public.profiles where id = auth.uid();
$$;

-- agencies: readable only by members of that agency. No direct insert —
-- creation only happens via bootstrap_agency().
create policy "agencies: members can view own agency"
  on public.agencies for select
  using (id = public.current_agency_id());

-- profiles: readable by any profile in the same agency (so agents/licensee
-- can see their colleagues); each user manages only their own row.
create policy "profiles: agency members can view each other"
  on public.profiles for select
  using (agency_id = public.current_agency_id());

create policy "profiles: users can update their own profile"
  on public.profiles for update
  using (id = auth.uid());

-- properties: full CRUD, scoped to the caller's own agency.
create policy "properties: agency members can view"
  on public.properties for select
  using (agency_id = public.current_agency_id());

create policy "properties: agency members can insert"
  on public.properties for insert
  with check (agency_id = public.current_agency_id());

create policy "properties: agency members can update"
  on public.properties for update
  using (agency_id = public.current_agency_id());

create policy "properties: agency members can delete"
  on public.properties for delete
  using (agency_id = public.current_agency_id());

-- property_items: full CRUD, scoped to the caller's own agency.
create policy "property_items: agency members can view"
  on public.property_items for select
  using (agency_id = public.current_agency_id());

create policy "property_items: agency members can insert"
  on public.property_items for insert
  with check (agency_id = public.current_agency_id());

create policy "property_items: agency members can update"
  on public.property_items for update
  using (agency_id = public.current_agency_id());

create policy "property_items: agency members can delete"
  on public.property_items for delete
  using (agency_id = public.current_agency_id());
