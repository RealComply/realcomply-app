-- Breach / corrective-actions register — Supervision Guidelines Requirement 3
-- (Adam, 13 Aug 2026). Flagged in the obligation register's punch-list and
-- the forms mapping as the highest-priority missing build: the one SG
-- requirement with no home in the product at all.
--
-- What Req 3 actually asks for is two things together, which is why this is
-- one table and not just an incident log: record the **non-compliance** and
-- record the **corrective action taken about it**. A breach with no recorded
-- remedy is the failure mode the requirement exists to prevent, so
-- corrective_action / corrective_action_date sit on the same row and the UI
-- surfaces anything still missing one.
--
-- The notifiable/notified pair handles the case with a real statutory clock
-- attached. Property and Stock Agents Act 2002 (NSW) s89 — "Licensee to
-- notify trust account becoming overdrawn" — requires the licensee to notify
-- the Secretary **in writing within 5 days** of becoming aware, stating the
-- account name and number, the amount overdrawn, and the reason (maximum
-- penalty 100 penalty units). Verified against the Act 13 Aug 2026, current
-- version 29 June 2026. That deadline runs from *awareness*, which is
-- exactly what identified_date records — so the register can count the days
-- rather than relying on someone remembering. notifiable is kept general
-- (any breach the licensee judges reportable to NSW Fair Trading), with the
-- trust-overdrawn case as the concrete driver.
--
-- Tenancy and RLS follow the same agency-wide-view model as the other
-- registers in 0005_registers_expansion.sql: everyone in the agency can see
-- the register (it is a supervision tool, and hiding breaches from the team
-- defeats the point), any member can log one, and deletion is left to the
-- same agency-member scope as gifts/complaints — the UI restricts the
-- destructive action to the licensee, consistent with those panels.

create table public.breaches (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  identified_date date not null,          -- when the agency became aware; the s89 clock runs from here
  description text not null,              -- what went wrong
  category text not null,                 -- 'pricing' | 'agency_agreement' | 'material_facts' | 'trust_account' | 'advertising' | 'record_keeping' | 'conduct' | 'supervision' | 'other'
  severity text not null default 'minor', -- 'minor' | 'material' | 'serious'
  agent_id uuid references public.profiles(id),
  property_id uuid references public.properties(id) on delete set null,
  corrective_action text,                 -- what was done about it — the other half of SG Req 3
  corrective_action_date date,
  notifiable boolean not null default false, -- reportable to NSW Fair Trading (s89 trust-overdrawn being the clear-cut case)
  notified_date date,                     -- when the notification actually went in
  status text not null default 'open',    -- 'open' | 'action_taken' | 'closed'
  closed_date date,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index breaches_agency_id_idx on public.breaches(agency_id);
create index breaches_property_id_idx on public.breaches(property_id);

alter table public.breaches enable row level security;

create policy "breaches: agency members can view" on public.breaches for select
  using (agency_id = public.current_agency_id());
create policy "breaches: agency members can insert" on public.breaches for insert
  with check (agency_id = public.current_agency_id());
create policy "breaches: agency members can update" on public.breaches for update
  using (agency_id = public.current_agency_id());
create policy "breaches: agency members can delete" on public.breaches for delete
  using (agency_id = public.current_agency_id());
