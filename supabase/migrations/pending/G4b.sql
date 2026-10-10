-- ===== G4b: sign-offs for people who join later; when a trust account opened, 10 October 2026 =====
--
-- Two changes from the 10 Oct function check (document sign-offs and trust
-- accounts). Plain SQL, safe to run more than once. Nothing here edits or
-- removes an existing row: one adds unsigned sign-off rows for people who are
-- missing them, the other adds an empty column.
--
-- Run before merging fix/G4b. The app copes with the column not being there
-- yet (it reads trust_accounts with select *), but giving a new account an
-- "opened on" date needs it.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 1. Someone who joins after an SG Manual version is published is asked to
--    sign it.
-- ─────────────────────────────────────────────────────────────────────────
--
-- createSignoffDocument (src/lib/actions/signoffs.ts) makes one unsigned row
-- per person in the office at the moment a version is published, and nothing
-- ever added a row for anyone who joined afterwards. Since 0058 a person with
-- no row cannot even see the document, so a new starter's SG Manual page had
-- no sign-off on it, Sign-offs said "Nothing waiting on your signature", and
-- the licensee's card read "N of N signed" in green with the new person on
-- it nowhere.
--
-- Now: whenever someone becomes an active member of an agency (joins, moves
-- in, or is brought back after being removed), they get an unsigned row on
-- that agency's CURRENT SG Manual version — the newest one, the same version
-- the SG Manual page shows. Not on older versions: those were superseded
-- before they arrived. With the row in place, the 0058 rules already let them
-- see the document and sign their own row, and the licensee sees them as
-- outstanding.
--
-- SECURITY DEFINER because the person joining cannot see the document yet;
-- that is the problem being solved. It only ever adds an unsigned row for the
-- person whose profile row fired it, in their own agency.

create or replace function public.add_current_signoffs_for_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.agency_id is null or new.archived_at is not null then
    return new;
  end if;
  -- Only on becoming a member: a new profile, a change of agency, or being
  -- brought back. An ordinary edit to a profile changes nothing here.
  if tg_op = 'UPDATE'
     and old.agency_id is not distinct from new.agency_id
     and old.archived_at is null then
    return new;
  end if;

  insert into public.signoff_signatures (document_id, agency_id, signer_id)
  select d.id, d.agency_id, new.id
    from public.signoff_documents d
   where d.id = (
     select cur.id from public.signoff_documents cur
      where cur.agency_id = new.agency_id
        and cur.category = 'sg_manual'
        and cur.signer_scope = 'all_staff'
      order by cur.created_at desc
      limit 1)
  on conflict (document_id, signer_id) do nothing;

  return new;
end
$$;
revoke execute on function public.add_current_signoffs_for_member() from public, anon, authenticated;

drop trigger if exists profiles_add_current_signoffs on public.profiles;
create trigger profiles_add_current_signoffs
  after insert or update of agency_id, archived_at on public.profiles
  for each row execute function public.add_current_signoffs_for_member();

-- The people already caught by this: everyone active in an agency with no row
-- on its current SG Manual version. Everyone in the office when a version was
-- published got one then, so these are the people who joined since.
insert into public.signoff_signatures (document_id, agency_id, signer_id)
select cur.id, cur.agency_id, p.id
  from (
    select distinct on (d.agency_id) d.id, d.agency_id
      from public.signoff_documents d
     where d.category = 'sg_manual' and d.signer_scope = 'all_staff'
     order by d.agency_id, d.created_at desc
  ) cur
  join public.profiles p on p.agency_id = cur.agency_id and p.archived_at is null
  join public.agencies a on a.id = cur.agency_id and a.ended_at is null
on conflict (document_id, signer_id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. When a trust account opened.
-- ─────────────────────────────────────────────────────────────────────────
--
-- A trust account added in October for an account that opened on 1 October
-- showed July, August and September as overdue straight away, and asked for
-- the audit of the year before it existed. The red badge could only be
-- cleared by filing reconciliations for months the account never had.
--
-- The date the account OPENED, given by the licensee, not created_at. They
-- differ for every agency that joins part way through a year, and for every
-- account 0032 created on 25 Aug 2026 for the agencies already here: those
-- still owed their July reconciliations and their 2025-26 audit, and reading
-- created_at would have gone quiet about both.
--
-- Null means it was already open, so every existing account carries on
-- exactly as before. Covered by the existing trust_accounts policies (the
-- licensee adds and edits accounts).

alter table public.trust_accounts
  add column if not exists opened_on date;

comment on column public.trust_accounts.opened_on is
  'The day the account opened, when it opened part way through a year. Months and audit periods that ended before it are not owed (src/lib/trust-account.ts monthBeforeOpening, auditOwed). Null: already open, everything owed.';
