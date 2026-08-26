-- MIGRATION 0035 — the licensee can manage the people in their office
-- 26 August 2026
--
-- Adam: "as the licensee i should be able to edit staff."
--
-- WHAT EXISTED. A licensee could invite someone and, from the Licences &
-- certificates register, correct their licence details (0004 opened the profile
-- update policy for exactly that). Nothing else. A name typed wrong at invite
-- time stayed wrong unless that person fixed it themselves; a role chosen at
-- invite time could never change; and there was no way to remove anybody at
-- all, ever. An agency's roster only grew.
--
-- This migration covers the two halves that need to live in the database:
-- removal, and the invariant that protects it.
--
-- ─────────────────────────────────────────────────────────────────────────
-- REMOVAL IS ARCHIVING, NOT DELETION
-- ─────────────────────────────────────────────────────────────────────────
--
-- A departed agent's signatures, CPD records, gift entries and the listings
-- they ran are the record of what happened. Deleting the person would either
-- destroy that or leave it pointing at nothing, and this is a product whose
-- whole promise is that the record is complete. So the row stays, the history
-- stays, and one timestamp says they are no longer active.
--
-- Same reasoning as read-only-on-lapse in the billing model, and as keeping a
-- closed trust account readable: the moment somebody most needs a compliance
-- record is often the moment after the relationship ended.
--
-- ─────────────────────────────────────────────────────────────────────────
-- HOW ARCHIVING ACTUALLY REVOKES ACCESS — one line, not a hundred
-- ─────────────────────────────────────────────────────────────────────────
--
-- current_agency_id() is what nearly every RLS policy in this database is
-- written against. Teaching it that an archived member has no agency means an
-- archived person's every query fails closed, everywhere, at once — properties,
-- items, registers, trust accounts, storage, all of it — without touching a
-- single policy or trusting the application to remember a check.
--
-- The alternative was an `archived_at is null` clause added to dozens of
-- policies, which is dozens of chances to miss one, and the one missed is the
-- one that matters.
--
-- Their colleagues still see them: "profiles: agency members can view each
-- other" tests the VIEWER's agency, so an archived person's row stays readable
-- to the office. That is deliberate and necessary — a signature from two years
-- ago still has to resolve to a name.
--
-- Safe to run more than once.

alter table public.profiles
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id);

comment on column public.profiles.archived_at is
  'When set, this person no longer has access to the agency. Their records stay: signatures, CPD, gifts and the listings they ran are the compliance history and are never removed with the person.';

create index if not exists profiles_archived_at_idx on public.profiles(archived_at);

-- The one line that does the work.
create or replace function public.current_agency_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select agency_id from public.profiles
  where id = auth.uid() and archived_at is null;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- The invariant: an agency always has a licensee in charge
-- ─────────────────────────────────────────────────────────────────────────
--
-- In the database rather than the Server Action, because this one genuinely
-- cannot be allowed to happen. An agency with no licensee in charge is an
-- agency where no compliance file can ever be signed off again — every file
-- would stall at the final step with nobody able to complete it, and the fix
-- would need someone reaching into the database.
--
-- It is reachable by two different moves — archiving the only licensee, or
-- demoting them — so the guard covers both rather than sitting on one path.
create or replace function public.guard_last_licensee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_losing_licensee boolean;
  v_remaining integer;
begin
  -- Did this update either take the licensee flag away, or archive the person
  -- who held it? Anything else is none of this trigger's business.
  v_losing_licensee :=
    (old.is_licensee_in_charge and not new.is_licensee_in_charge)
    or (old.is_licensee_in_charge and old.archived_at is null and new.archived_at is not null);

  if not v_losing_licensee then
    return new;
  end if;

  select count(*) into v_remaining
  from public.profiles p
  where p.agency_id = new.agency_id
    and p.id <> new.id
    and p.is_licensee_in_charge
    and p.archived_at is null;

  if v_remaining = 0 then
    raise exception
      'An agency must always have a licensee in charge. Appoint someone else first, then make this change.';
  end if;

  return new;
end;
$$;

create or replace trigger profiles_last_licensee_guard
  before update on public.profiles
  for each row execute function public.guard_last_licensee();

-- ─────────────────────────────────────────────────────────────────────────
-- Verify (read only — run after the statements above)
-- ─────────────────────────────────────────────────────────────────────────
-- Expect: both columns true, trigger true, 0 archived so far, and every
-- existing agency still has at least one active licensee in charge.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('archived_at', 'archived_by'))            as new_columns,
  exists (select 1 from pg_trigger
    where tgname = 'profiles_last_licensee_guard')                  as trigger_exists,
  (select count(*) from public.profiles
    where archived_at is not null)                                  as archived_people,
  (select count(*) from public.agencies a
    where not exists (
      select 1 from public.profiles p
      where p.agency_id = a.id and p.is_licensee_in_charge and p.archived_at is null
    ))                                                              as agencies_without_licensee;
