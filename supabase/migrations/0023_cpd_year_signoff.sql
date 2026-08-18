-- CPD, simplified to a certificate and a tick (Adam, 18 Aug 2026).
--
-- His words: "we also don't need to fill in all the details, like the
-- category of practice, because once we complete the CPD a certificate is
-- issued, and then I think all we need to do is upload that certificate and
-- tick that the CPD's been done for that year. Because all the information we
-- need will be on the certificate. Again, less friction, less manual data
-- entry."
--
-- That is the product's own rule, applied to a screen that had drifted from
-- it. The evidence model says forms are an index to evidence, not a re-tick,
-- and that where a fact is printed on a document the agent is uploading
-- anyway, the AI reads it rather than the agent retyping it. The CPD screen
-- had a provider field, an hours field, a category selector and a date
-- picker — every one of which is stated on the record of completion the
-- provider issues.
--
-- So the record of completion becomes the record, and this table holds the
-- only thing that isn't on it: the human confirmation that the year is done.
--
-- WHY A TABLE AND NOT A COLUMN ON profiles
-- ----------------------------------------
-- The tick is per person PER YEAR. A boolean on profiles would have to be
-- cleared every 1 July by something that remembers to, and the year it
-- applied to would be unrecoverable afterwards. A row keyed to the CPD year
-- makes last year's confirmation permanent evidence and this year's absence
-- the default, with nothing to reset.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ----------------------------------
-- It does not check the hours add up. Fair Trading sets required hours per
-- category of practice, and dropping the category question — which is what
-- removed the friction — removes the ability to compute a target. Adam took
-- that trade knowingly. RealComply records what was done and who confirmed
-- it; it does not tell someone they are three hours short in June. The tick
-- is an attestation by a named person, dated, which is the same posture the
-- rest of the product takes at every genuine decision point.

create table if not exists public.cpd_year_signoffs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- The CPD year as its start date (1 July). Same convention as
  -- training_plans.cpd_year_start, so "this year's" is a comparison rather
  -- than string matching on a label.
  cpd_year_start date not null,
  -- Who ticked it and when. Not defaulted to now() on insert alone: this is
  -- an attestation, and it should be as explicit as the signatures elsewhere.
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- One confirmation per person per year. Un-ticking deletes the row rather
-- than setting a flag false, so there is never a "confirmed = false" record
-- that reads, wrongly, like someone actively declared they had not done it.
create unique index if not exists cpd_year_signoffs_person_year_idx
  on public.cpd_year_signoffs (profile_id, cpd_year_start);

create index if not exists cpd_year_signoffs_agency_id_idx
  on public.cpd_year_signoffs(agency_id);

alter table public.cpd_year_signoffs enable row level security;

-- Agency-wide visibility, same as every other register: the licensee has to
-- see who is done, and an agent has to be able to see their own.
drop policy if exists "cpd_year_signoffs: agency members can view" on public.cpd_year_signoffs;
create policy "cpd_year_signoffs: agency members can view"
  on public.cpd_year_signoffs for select using (agency_id = public.current_agency_id());
drop policy if exists "cpd_year_signoffs: agency members can insert" on public.cpd_year_signoffs;
create policy "cpd_year_signoffs: agency members can insert"
  on public.cpd_year_signoffs for insert with check (agency_id = public.current_agency_id());
drop policy if exists "cpd_year_signoffs: agency members can delete" on public.cpd_year_signoffs;
create policy "cpd_year_signoffs: agency members can delete"
  on public.cpd_year_signoffs for delete using (agency_id = public.current_agency_id());

comment on table public.cpd_year_signoffs is
  'Per person, per CPD year: the confirmation that CPD is complete. The certificates in cpd_records are the evidence; this is the human tick that the year is done. No row means not yet confirmed.';
