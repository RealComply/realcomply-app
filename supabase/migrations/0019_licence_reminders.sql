-- Licence and certificate expiry reminders (Adam, 18 Aug 2026).
--
-- Adam asked for "a certificate register ... where we can put all employees'
-- certificate of registration ... note the expiry date and set up reminders
-- for each agent and for the principal or licensee so that they're aware of
-- when licences are going to expire."
--
-- The register itself already exists. profiles carries licence_type (which
-- already includes 'certificate_of_registration'), licence_number,
-- licence_expiry (0004_registers.sql) and licence_document_path /
-- licence_document_file_name (0005_registers_expansion.sql), and the agency's
-- own corporation licence sits on agencies (0015_corporation_licence.sql).
-- A certificate of registration is not a different kind of record from a
-- licence — under the Property and Stock Agents Act 2002 (NSW) a person holds
-- either a licence or a certificate of registration, one credential each — so
-- splitting them into two registers would put one person's credential in two
-- places and give the reminder job two tables to read. This migration adds
-- only the thing that was actually missing: a record of which reminders have
-- already gone out.
--
-- Why a table rather than "reminded_at" columns on profiles
-- ---------------------------------------------------------
-- Three reasons, all of which bite the columns version:
--
--   1. There are several thresholds (90 / 30 / 7 days, and expiry day
--      itself), so the columns version is four columns per subject.
--   2. A reminder must not re-send. The daily job would otherwise mail the
--      same person every morning for ninety consecutive days.
--   3. A renewed licence must start a fresh cycle. Storing expiry_date on the
--      reminder row makes that automatic: renew the licence, the expiry date
--      changes, no rows exist for the new date, and the 90-day reminder fires
--      again at the right time. With a plain reminded_at column someone would
--      have to remember to clear it, and nobody ever does.
--
-- The row is also the audit trail — "we told her in April, and again in June"
-- is the answer to a supervision question, so it is worth keeping rather than
-- deleting once sent.

create table public.licence_reminders (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  -- 'profile' = a person's licence or certificate of registration.
  -- 'corporation' = the agency's own corporation licence, which has no
  -- profile row behind it and so leaves profile_id null.
  subject_kind text not null check (subject_kind in ('profile', 'corporation')),
  profile_id uuid references public.profiles(id) on delete cascade,
  -- The expiry the reminder was about. Part of the dedupe key, so renewing
  -- resets the cycle (see above).
  expiry_date date not null,
  -- 90, 30, 7, or 0 for "expires today / has expired".
  threshold_days int not null,
  -- Who it actually went to, for the audit trail. The holder and the
  -- licensee in charge are mailed separately but recorded on one row.
  recipients text[] not null default '{}',
  sent_at timestamptz not null default now()
);

create index licence_reminders_agency_id_idx on public.licence_reminders(agency_id);
create index licence_reminders_profile_id_idx on public.licence_reminders(profile_id);

-- The dedupe key. profile_id is null for the corporation licence, and NULLs
-- compare as distinct in a plain unique constraint, which would let the
-- corporation reminder send every single day. coalescing to the nil UUID
-- gives those rows a real value to be unique on.
create unique index licence_reminders_once_idx
  on public.licence_reminders (
    agency_id,
    subject_kind,
    coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid),
    expiry_date,
    threshold_days
  );

alter table public.licence_reminders enable row level security;

-- Read-only to the agency: the register shows "last reminded" so the office
-- can see the system is doing its job. Nothing in the app writes these — they
-- are written by the cron job through the service client, which bypasses RLS
-- — so there is deliberately no insert, update or delete policy. If a row
-- could be deleted from the app, deleting it would silently re-arm a reminder
-- that has already been sent.
create policy "licence_reminders: agency members can view"
  on public.licence_reminders for select
  using (agency_id = public.current_agency_id());

comment on table public.licence_reminders is
  'One row per reminder actually sent about a licence or certificate expiry. The unique index on (agency, subject, expiry_date, threshold) is what stops a daily job re-sending, and keying on expiry_date is what makes a renewal start a fresh reminder cycle.';
