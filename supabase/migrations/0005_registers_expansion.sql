-- Rounds out the Registers surface to match realcomply-registers mockup
-- (gifts + complaints tabs, licence document upload, thresholds) and adds
-- the SG Manual store + the Portfolio dashboard's data needs (nothing new
-- there — it reads existing tables).

-- ── Licence document (one per person, same simplicity as property evidence) ─
alter table public.profiles
  add column licence_document_path text,
  add column licence_document_file_name text;

-- ── Agency-level settings the two new registers need ───────────────────────
alter table public.agencies
  add column gift_threshold numeric(10,2) not null default 150,
  add column complaint_resolution_target_days integer not null default 30;

-- ─────────────────────────────────────────────────────────────────────────
-- Gifts & benefits register — Rules of Conduct probity/conflicts control.
-- status: 'recorded' (under threshold, routine) | 'flagged' (over threshold,
-- awaiting licensee review) | 'reviewed' (licensee has looked at a flagged
-- entry and cleared it).
-- ─────────────────────────────────────────────────────────────────────────
create table public.gifts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id), -- the agent involved
  gift_date date not null,
  description text not null,
  counterparty text,
  value numeric(10,2),
  direction text not null default 'received', -- 'received' | 'given'
  status text not null default 'recorded',    -- 'recorded' | 'flagged' | 'reviewed'
  property_id uuid references public.properties(id) on delete set null,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index gifts_agency_id_idx on public.gifts(agency_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Complaints register — tracked to resolution, optionally cross-linked to a
-- property file (e.g. a pricing complaint tied to that file's flags).
-- ─────────────────────────────────────────────────────────────────────────
create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  received_date date not null,
  complainant text not null,
  agent_id uuid references public.profiles(id),
  property_id uuid references public.properties(id) on delete set null,
  nature text not null,
  status text not null default 'open', -- 'open' | 'under_review' | 'resolved'
  resolved_date date,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index complaints_agency_id_idx on public.complaints(agency_id);
create index complaints_property_id_idx on public.complaints(property_id);

-- ─────────────────────────────────────────────────────────────────────────
-- SG Manual store — simple upload + version history (the full AI
-- gap-analysis/redline review flow from the mockup is a deliberate later
-- build; this just gets the document somewhere real, versioned). Current
-- version = most recent row by created_at.
-- ─────────────────────────────────────────────────────────────────────────
create table public.sg_manual_versions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  version_label text,
  file_path text not null,
  file_name text not null,
  notes text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index sg_manual_versions_agency_id_idx on public.sg_manual_versions(agency_id);

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — same agency-wide-CRUD trust model as every other register/training
-- table (see 0004_registers.sql).
-- ─────────────────────────────────────────────────────────────────────────
alter table public.gifts enable row level security;
alter table public.complaints enable row level security;
alter table public.sg_manual_versions enable row level security;

create policy "gifts: agency members can view" on public.gifts for select
  using (agency_id = public.current_agency_id());
create policy "gifts: agency members can insert" on public.gifts for insert
  with check (agency_id = public.current_agency_id());
create policy "gifts: agency members can update" on public.gifts for update
  using (agency_id = public.current_agency_id());
create policy "gifts: agency members can delete" on public.gifts for delete
  using (agency_id = public.current_agency_id());

create policy "complaints: agency members can view" on public.complaints for select
  using (agency_id = public.current_agency_id());
create policy "complaints: agency members can insert" on public.complaints for insert
  with check (agency_id = public.current_agency_id());
create policy "complaints: agency members can update" on public.complaints for update
  using (agency_id = public.current_agency_id());
create policy "complaints: agency members can delete" on public.complaints for delete
  using (agency_id = public.current_agency_id());

create policy "sg_manual_versions: agency members can view" on public.sg_manual_versions for select
  using (agency_id = public.current_agency_id());
create policy "sg_manual_versions: agency members can insert" on public.sg_manual_versions for insert
  with check (agency_id = public.current_agency_id());
create policy "sg_manual_versions: agency members can delete" on public.sg_manual_versions for delete
  using (agency_id = public.current_agency_id());
