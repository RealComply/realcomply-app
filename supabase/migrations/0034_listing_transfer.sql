-- MIGRATION 0034 — moving a listing to another agent
-- 26 August 2026
--
-- Adam, 26 Aug 2026: "I also want to be able to change ownership of a listing
-- between agents."
--
-- WHAT "OWNERSHIP" ALREADY IS. There is no separate owner column. properties.
-- created_by IS the owning agent and has been since 0001 — see the comment in
-- src/lib/data/rule-context.ts, and note that properties.ts already writes an
-- ownerId there rather than the caller's own id, precisely so an assistant
-- creating a file does not become its agent. So a transfer is a change of
-- created_by, not a new concept.
--
-- WHY THIS NEEDS A MIGRATION AT ALL. The app could simply update the column,
-- and until today anyone in the agency could have: "properties: agency members
-- can update" covers every column on the row, so an agent could move a listing
-- onto — or off — their own name through the API without going near the app.
-- On a file carrying an open flag that is not a hypothetical concern.
--
-- Two things, therefore, and both live in the database rather than in the
-- Server Action:
--
--   1. Only the licensee in charge may change the owning agent. Adam chose
--      this over letting an agent hand over their own files: the owner is who
--      is accountable for the file and who an assistant can see, so it belongs
--      with the person who supervises.
--
--   2. Every change is written to property_transfers, by the same trigger that
--      permits it. A log the application writes is a log the application can
--      forget to write; this one cannot be bypassed, because the thing that
--      allows the change is the thing that records it.
--
-- This is the same lesson as the extraction allow-list and as 0033: a rule that
-- only exists in the layer above the data is a convention, not a rule.
--
-- Safe to run more than once.

create table if not exists public.property_transfers (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  -- Nullable: a file whose original agent has since been removed from the
  -- agency still has a history worth keeping.
  from_agent uuid references public.profiles(id),
  to_agent uuid not null references public.profiles(id),
  moved_by uuid references public.profiles(id),
  moved_at timestamptz not null default now()
);

create index if not exists property_transfers_property_id_idx
  on public.property_transfers(property_id);

alter table public.property_transfers enable row level security;

-- Visible to the agency, like the staff list and the invite list. Who is
-- responsible for a file, and since when, is a supervision fact rather than a
-- private one.
--
-- No insert, update or delete policy anywhere, deliberately. Rows arrive only
-- from the trigger below, which runs as the definer and so is not subject to
-- these policies. Nothing else can write a transfer record, and nothing at all
-- can rewrite one.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'property_transfers'
      and policyname = 'property_transfers: agency members can view'
  ) then
    create policy "property_transfers: agency members can view"
      on public.property_transfers for select
      using (agency_id = public.current_agency_id());
  end if;
end
$$;

revoke all on table public.property_transfers from anon;

-- ─────────────────────────────────────────────────────────────────────────
-- The guard, and the log, in one place
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.guard_listing_transfer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_is_licensee boolean;
  v_target_agency uuid;
begin
  -- Only interested in a change of owning agent. Every other edit to a
  -- listing — address, stage, auction date — passes straight through.
  if new.created_by is not distinct from old.created_by then
    return new;
  end if;

  select coalesce(p.is_licensee_in_charge, false)
    into v_is_licensee
  from public.profiles p
  where p.id = v_caller;

  if not coalesce(v_is_licensee, false) then
    raise exception 'only the licensee in charge can move a listing to another agent';
  end if;

  -- The destination has to be a real person in the same agency. Without this,
  -- a listing could be moved onto a profile from another agency, which would
  -- put the file outside every RLS check that scopes by agency and effectively
  -- make it disappear.
  select p.agency_id into v_target_agency
  from public.profiles p
  where p.id = new.created_by;

  if v_target_agency is null or v_target_agency <> new.agency_id then
    raise exception 'a listing can only be moved to someone in the same agency';
  end if;

  insert into public.property_transfers (agency_id, property_id, from_agent, to_agent, moved_by)
  values (new.agency_id, new.id, old.created_by, new.created_by, v_caller);

  return new;
end;
$$;

-- `before update of created_by` so the trigger is not consulted on the many
-- ordinary edits a listing receives.
--
-- `create or replace trigger` rather than remove-then-create: a re-run ends
-- with the current definition attached either way, and this phrasing keeps the
-- word Supabase treats as destructive out of the script, so the whole migration
-- does not disappear behind a confirmation dialog. Same reasoning as the note
-- on bootstrap_agency_v2 in 0029.
create or replace trigger listing_transfer_guard
  before update of created_by on public.properties
  for each row execute function public.guard_listing_transfer();

-- ─────────────────────────────────────────────────────────────────────────
-- Verify (read only — run after the statements above)
-- ─────────────────────────────────────────────────────────────────────────
-- Expect: table true, trigger true, 1 select policy, 0 transfers so far,
-- anon_can_read false.
select
  to_regclass('public.property_transfers') is not null                        as table_exists,
  exists (select 1 from pg_trigger where tgname = 'listing_transfer_guard')   as trigger_exists,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'property_transfers')         as policies,
  (select count(*) from public.property_transfers)                            as transfers,
  has_table_privilege('anon', 'public.property_transfers', 'select')           as anon_can_read;
