-- Licence/CPD register + training log — the "licensee-specific compliance"
-- surface from RealComply-website-IA.md (Registers + Training screens) and
-- the people-obligations table in RealComply-NSW-sales-obligation-register.md
-- §A: hold a current licence/certificate, PI insurance current (s22 PSA
-- Act), CPD each year (7 hrs for Class 1/2, +Fair Trading forum + AUSTRAC
-- AML for Class 1, 3 units for assistant agents), CPD year running 1 Jul–30
-- Jun. This is agency-level/people compliance, distinct from the per-property
-- sales items in nsw-sales.ts.

-- ── Licence details live directly on profiles (one holder, one licence) ───
alter table public.profiles
  add column licence_type text,       -- 'class_1' | 'class_2' | 'certificate_of_registration'
  add column licence_number text,
  add column licence_expiry date;

-- ── PI insurance is a condition of the agency's licence(s), not per-person ─
alter table public.agencies
  add column pi_insurer text,
  add column pi_policy_number text,
  add column pi_expiry date;

-- ─────────────────────────────────────────────────────────────────────────
-- Training sessions — the office training log (s32: outcome-based, no
-- prescribed frequency; agency sets its own cadence, defaults quarterly).
-- ─────────────────────────────────────────────────────────────────────────
create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  title text not null,
  session_date date not null,
  is_cpd_eligible boolean not null default false,
  cpd_hours numeric(4,1),             -- only meaningful when is_cpd_eligible
  trainer_name text,
  is_external boolean not null default false,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index training_sessions_agency_id_idx on public.training_sessions(agency_id);

create table public.training_attendance (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (session_id, profile_id)
);

create index training_attendance_agency_id_idx on public.training_attendance(agency_id);
create index training_attendance_session_id_idx on public.training_attendance(session_id);

-- ─────────────────────────────────────────────────────────────────────────
-- CPD records — per-person, per-activity. source_session_id links back to
-- an auto-generated record from marking attendance at a CPD-eligible
-- training session (see recordAttendance in registers.ts); re-saving
-- attendance deletes and re-inserts those rows, so it's safe to run twice.
-- Manually-logged CPD (an external course, the AUSTRAC AML training, a Fair
-- Trading forum) has source_session_id null.
-- ─────────────────────────────────────────────────────────────────────────
create table public.cpd_records (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  activity_name text not null,
  category text not null default 'general', -- general | fair_trading_forum | austrac_aml | assistant_unit
  hours numeric(4,1) not null,
  completed_date date not null,
  notes text,
  source_session_id uuid references public.training_sessions(id) on delete set null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index cpd_records_agency_id_idx on public.cpd_records(agency_id);
create index cpd_records_profile_id_idx on public.cpd_records(profile_id);
create index cpd_records_source_session_id_idx on public.cpd_records(source_session_id);

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — same agency-wide-CRUD trust model as properties/property_items
-- (see 0001_init.sql): every member of an agency can view and maintain the
-- agency's own registers. Individual UI/action-level gating (e.g. PI
-- insurance edits restricted to the licensee) happens in registers.ts, same
-- pattern as the licenseeOnly item gating in compliance.ts.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.training_sessions enable row level security;
alter table public.training_attendance enable row level security;
alter table public.cpd_records enable row level security;

create policy "training_sessions: agency members can view"
  on public.training_sessions for select
  using (agency_id = public.current_agency_id());
create policy "training_sessions: agency members can insert"
  on public.training_sessions for insert
  with check (agency_id = public.current_agency_id());
create policy "training_sessions: agency members can update"
  on public.training_sessions for update
  using (agency_id = public.current_agency_id());
create policy "training_sessions: agency members can delete"
  on public.training_sessions for delete
  using (agency_id = public.current_agency_id());

create policy "training_attendance: agency members can view"
  on public.training_attendance for select
  using (agency_id = public.current_agency_id());
create policy "training_attendance: agency members can insert"
  on public.training_attendance for insert
  with check (agency_id = public.current_agency_id());
create policy "training_attendance: agency members can delete"
  on public.training_attendance for delete
  using (agency_id = public.current_agency_id());

create policy "cpd_records: agency members can view"
  on public.cpd_records for select
  using (agency_id = public.current_agency_id());
create policy "cpd_records: agency members can insert"
  on public.cpd_records for insert
  with check (agency_id = public.current_agency_id());
create policy "cpd_records: agency members can update"
  on public.cpd_records for update
  using (agency_id = public.current_agency_id());
create policy "cpd_records: agency members can delete"
  on public.cpd_records for delete
  using (agency_id = public.current_agency_id());

-- profiles previously only allowed self-update; the licensee also needs to
-- correct a colleague's licence details (e.g. entering them on the
-- colleague's behalf during onboarding). Row-level security can't restrict
-- this to just the licence_* columns — registers.ts enforces that narrower
-- rule at the application layer, same as every other licenseeOnly action.
create policy "profiles: licensee can update agency members"
  on public.profiles for update
  using (
    agency_id = public.current_agency_id()
    and exists (
      select 1 from public.profiles me
      where me.id = auth.uid() and me.is_licensee_in_charge
    )
  );

-- agencies had no update policy at all yet (nothing needed to change it
-- until now) — needed so the licensee can set PI insurance details.
create policy "agencies: licensee can update own agency"
  on public.agencies for update
  using (
    id = public.current_agency_id()
    and exists (
      select 1 from public.profiles me
      where me.id = auth.uid() and me.is_licensee_in_charge
    )
  );
