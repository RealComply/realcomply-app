-- Annual training plans (Adam, 18 Aug 2026), plus the CPD category of
-- practice the plan's hours depend on.
--
-- WHY
-- ---
-- The end-to-end audit found the product had a training LOG but no training
-- PLAN. Those are different obligations and only one of them is required.
--
-- Requirement 2.4 of the NSW Supervision Guidelines obliges the licensee in
-- charge to prepare and maintain an annual training plan, per staff member,
-- developed in consultation with them, aligned to the CPD year, reviewed and
-- updated annually. Confirmed from REINSW's own template, which cites
-- "Requirement 2.4 of the Supervision Guidelines" twice and carries a
-- two-party sign-off whose principal-side wording reads: "I understand that
-- where this training plan is not followed, the agency may be in breach of
-- Requirement 2.4 of the Supervision Guidelines where penalties may be
-- imposed."
--
-- A list of sessions that already happened is not a plan. An inspector asking
-- to see the training plan is asking for this.
--
-- ONE PLAN PER PERSON PER CPD YEAR — not one per agency. Fair Trading's page
-- speaks of "an annual training plan for their agency", but the instrument it
-- describes, and the template the industry actually uses, is per person: one
-- staff member's gaps, one staff member's programs, signed by them and by the
-- principal. The agency's plan is the set of them.

-- ── The category of practice CPD hours are measured against ──────────────
--
-- Fair Trading sets CPD hours per CATEGORY, not per licence class: 7 hours
-- for residential sales, commercial, business broking and stock & station; 6
-- for strata; 4 for on-site short-term residential property management; and
-- residential property management not yet published for 2026–27. The app
-- previously applied a flat 7 to everyone holding a licence, which was simply
-- wrong for three of those categories. See src/lib/rules/nsw-cpd.ts.
--
-- Nullable, and null means "we don't know" rather than a default. A default
-- would silently reintroduce the same wrong number this column exists to fix.
alter table public.profiles
  add column cpd_practice_category text;

comment on column public.profiles.cpd_practice_category is
  'Category of practice CPD hours are measured against (residential_sales, commercial, business_broking, stock_and_station, strata, onsite_short_term_rpm, residential_property_management). Null = not recorded; the app must say it cannot state a requirement rather than assume one.';

-- ── The plan ─────────────────────────────────────────────────────────────
create table public.training_plans (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,

  -- The CPD year the plan covers, as the start date (1 July). Stored as a
  -- date rather than a label so "is there a current plan?" is a comparison,
  -- not string matching.
  cpd_year_start date not null,
  valid_from date,
  valid_to date,

  -- Step 1 and 2 of the REINSW process: what the consultation established.
  -- This is the substance of the plan — the reason each program is on it —
  -- and the reason the whole thing can't be auto-generated.
  consultation_date date,
  identified_gaps text,

  -- Snapshot of the requirement at the time the plan was written, so a plan
  -- signed in August still shows what it was built against after Fair Trading
  -- republishes. Null where Fair Trading had not published a figure.
  required_hours numeric(4,1),
  required_units integer,
  requirement_note text,

  -- Two-party sign-off. The staff member accepts the plan; the principal
  -- approves it and commits to providing time. Both are in the template and
  -- both matter — a plan the staff member never saw is not "developed in
  -- consultation with" them.
  staff_signed_name text,
  staff_signed_at timestamptz,
  principal_signed_name text,
  principal_signed_at timestamptz,

  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One plan per person per CPD year. Re-planning mid-year edits the existing
-- plan rather than creating a second one, which is what "reviewed and updated"
-- means — a second plan for the same year is an ambiguity, not a revision.
create unique index training_plans_person_year_idx
  on public.training_plans (profile_id, cpd_year_start);

create index training_plans_agency_id_idx on public.training_plans(agency_id);

-- ── The line items — the REINSW plan table, one row per program ──────────
create table public.training_plan_items (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  plan_id uuid not null references public.training_plans(id) on delete cascade,

  program_name text not null,
  -- 'compulsory' | 'elective'. Fair Trading has published no elective
  -- component for 2026–27, but the column stays because the template has the
  -- column and the distinction returns in most years.
  classification text not null default 'compulsory',
  -- 'face_to_face' | 'interactive_webinar' | 'online_unit' | 'other'.
  -- Face-to-face is NOT mandatory: a live interactive webinar with assessment
  -- qualifies for compulsory topics; self-paced online does not.
  delivery_type text,
  training_hours numeric(4,1),
  provider text,

  -- "Gap identified / reason for training" in the template. The single most
  -- important field on the row: it is what connects the program to the
  -- consultation and turns a list of courses into a plan.
  gap_reason text,

  due_date date,
  completed_date date,
  -- Where the certificate or statement of attainment lives. Same
  -- upload-then-record-path pattern as licence documents.
  evidence_path text,
  evidence_file_name text,
  -- Set when completing the item also wrote a CPD record, so the two stay
  -- linked and the plan can show what has actually landed in the register.
  cpd_record_id uuid references public.cpd_records(id) on delete set null,

  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index training_plan_items_agency_id_idx on public.training_plan_items(agency_id);
create index training_plan_items_plan_id_idx on public.training_plan_items(plan_id);

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Same agency-wide model as the other registers (0004/0005): everyone in the
-- agency can see the plans, because supervision is not a secret and an agent
-- must be able to read their own. Narrower rules — only the licensee may
-- approve, only the staff member may accept for themselves — are enforced in
-- the server actions, the same way every other licenseeOnly action works.
alter table public.training_plans enable row level security;
alter table public.training_plan_items enable row level security;

create policy "training_plans: agency members can view"
  on public.training_plans for select using (agency_id = public.current_agency_id());
create policy "training_plans: agency members can insert"
  on public.training_plans for insert with check (agency_id = public.current_agency_id());
create policy "training_plans: agency members can update"
  on public.training_plans for update using (agency_id = public.current_agency_id());
create policy "training_plans: agency members can delete"
  on public.training_plans for delete using (agency_id = public.current_agency_id());

create policy "training_plan_items: agency members can view"
  on public.training_plan_items for select using (agency_id = public.current_agency_id());
create policy "training_plan_items: agency members can insert"
  on public.training_plan_items for insert with check (agency_id = public.current_agency_id());
create policy "training_plan_items: agency members can update"
  on public.training_plan_items for update using (agency_id = public.current_agency_id());
create policy "training_plan_items: agency members can delete"
  on public.training_plan_items for delete using (agency_id = public.current_agency_id());

comment on table public.training_plans is
  'Annual training plan per staff member per CPD year — Requirement 2.4 of the NSW Supervision Guidelines. Distinct from training_sessions, which is the log of what happened; this is the forward plan the licensee in charge must prepare, consult on, sign and review annually.';
