-- ===== RUN THIS ONE. Migration 0032, trust accounts, 25 Aug 2026 =====
--
-- ⚠️ THIS ONE TRIGGERS THE DESTRUCTIVE-QUERY BOX. Read the note at the bottom
-- before pressing Run. It is expected, it is safe, and you must press the
-- CONFIRM button rather than closing the box.
--
-- More than one trust account per agency (Adam, 25 Aug 2026): "a lot of
-- agencies, mine included, have more than one trust account because you need
-- one trust account for sales and a separate trust account for property
-- management... they can add the trust account, and then they get to name it
-- whatever they want."
--
-- The Act expects this. s86 pays trust money into "a trust account (whether
-- general or separate)", and cl 27(5)(b) reconciles AN account against ITS
-- cash book — so two accounts is two reconciliations every month, not one.
--
-- THE ANNUAL AUDIT IS PER ACCOUNT (Adam, 25 Aug 2026: "annual audit is 1 per
-- account"). I had drawn it agency-level on the reading that s111 puts one
-- duty on the licensee and s112 gives one audit period; he says his auditor
-- reports per account, and he is the one who receives the reports. So
-- trust_audits gains an account reference and its uniqueness moves from
-- (agency, period) to (agency, account, period) — two accounts means two audit
-- records a year, each with its own auditor, report and confirmation.
--
-- Worth being clear that this is the LOOSER model: an agency whose auditor
-- issues a single combined report can still record it once against each
-- account, or once against the account it names. The reverse would not have
-- been true, which is why getting this right before any audit is recorded
-- matters.

-- ── 1. The accounts themselves ────────────────────────────────────────────
create table if not exists public.trust_accounts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  -- Free text on purpose. "Sales", "Property management", "PM — Hornsby".
  -- An agency running three rent rolls through three companies knows their
  -- names better than a fixed list ever would.
  name text not null,
  -- Closing an account archives it rather than removing it: the past
  -- reconciliations are records the agency is still required to keep, and a
  -- register you can erase is not evidence of anything. Archived accounts
  -- leave the switcher and stay in the trail.
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists trust_accounts_agency_id_idx
  on public.trust_accounts (agency_id);

alter table public.trust_accounts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'trust_accounts'
       and policyname = 'trust_accounts: agency members can view'
  ) then
    create policy "trust_accounts: agency members can view"
      on public.trust_accounts for select
      using (agency_id = public.current_agency_id());
  end if;

  -- Adding, renaming and archiving are the licensee's. An assistant can upload
  -- a reconciliation into an account (that is the point of 0031) but cannot
  -- decide what accounts the agency operates.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'trust_accounts'
       and policyname = 'trust_accounts: licensee can insert'
  ) then
    create policy "trust_accounts: licensee can insert"
      on public.trust_accounts for insert
      with check (
        agency_id = public.current_agency_id()
        and exists (
          select 1 from public.profiles me
           where me.id = auth.uid() and me.is_licensee_in_charge
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'trust_accounts'
       and policyname = 'trust_accounts: licensee can update'
  ) then
    create policy "trust_accounts: licensee can update"
      on public.trust_accounts for update
      using (
        agency_id = public.current_agency_id()
        and exists (
          select 1 from public.profiles me
           where me.id = auth.uid() and me.is_licensee_in_charge
        )
      );
  end if;
end $$;

comment on table public.trust_accounts is
  'One row per trust account an agency operates. s86 contemplates several ("whether general or separate"); the usual split is sales and property management. Named by the agency, archived rather than removed when closed.';

-- ── 2. Which account a reconciliation belongs to ──────────────────────────
alter table public.signoff_documents
  add column if not exists trust_account_id uuid references public.trust_accounts(id) on delete set null;

comment on column public.signoff_documents.trust_account_id is
  'For a trust_reconciliation, which account it reconciles. Null on every other category. on delete set null rather than cascade: archiving is the intended path, but if an account row ever does go, the reconciliation is still a record worth keeping.';

create index if not exists signoff_documents_trust_account_idx
  on public.signoff_documents (trust_account_id, period_month);

-- ── 3. Which account an audit covers ──────────────────────────────────────
alter table public.trust_audits
  add column if not exists trust_account_id uuid references public.trust_accounts(id) on delete cascade;

comment on column public.trust_audits.trust_account_id is
  'Which trust account this audit period covers. The app always sets it; left nullable only so this migration is safe to re-run, with the unique index coalescing nulls so an unassigned row still cannot duplicate.';

-- ── 4. Reminders are per account ──────────────────────────────────────────
alter table public.trust_reminders
  add column if not exists trust_account_id uuid references public.trust_accounts(id) on delete cascade;

-- ── 5. Give every agency an account, and adopt what is already filed ──────
--
-- Runs before the index change so the backfilled rows are in place first.
-- Guarded on name so re-running cannot produce a second "Trust account".
insert into public.trust_accounts (agency_id, name)
select a.id, 'Trust account'
  from public.agencies a
 where not exists (
   select 1 from public.trust_accounts t where t.agency_id = a.id
 );

update public.signoff_documents d
   set trust_account_id = (
     select t.id from public.trust_accounts t
      where t.agency_id = d.agency_id
      order by t.created_at
      limit 1
   )
 where d.category = 'trust_reconciliation'
   and d.trust_account_id is null;

update public.trust_audits a
   set trust_account_id = (
     select t.id from public.trust_accounts t
      where t.agency_id = a.agency_id
      order by t.created_at
      limit 1
   )
 where a.trust_account_id is null;

-- ── 6. The dedupe keys have to include the account ──────────────────────────
--
-- THIS IS THE PART THAT TRIGGERS THE BOX. 0031's unique index was
-- (agency, kind, period, stage), which was right when an agency had one
-- account. With two, the second account's reminder for the same month would
-- collide with the first and never be recorded — meaning it would never be
-- sent. The index has to be replaced rather than added to.
--
-- Safe to do: trust_reminders has no rows yet (0031 ran today and no reminder
-- has fired), so nothing is being rewritten.
--
-- coalesce to the nil UUID because NULLs compare as distinct in a unique
-- index, and a null account (an agency-wide reminder) must still be unique.
drop index if exists public.trust_reminders_once_idx;
drop index if exists public.trust_audits_period_idx;

create unique index if not exists trust_reminders_once_idx
  on public.trust_reminders (
    agency_id,
    coalesce(trust_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
    kind,
    period,
    stage
  );

create unique index if not exists trust_audits_period_idx
  on public.trust_audits (
    agency_id,
    coalesce(trust_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period_end
  );

-- ── Verify. Expected: 1 table, 3 columns, 3 policies, 1 account per agency ─
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'trust_accounts')      as table_expect_1,
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and column_name = 'trust_account_id'
      and table_name in ('signoff_documents', 'trust_reminders', 'trust_audits'))
                                                                          as columns_expect_3,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'trust_accounts')         as policies_expect_3,
  (select count(*) from public.trust_accounts)                            as accounts_created,
  (select count(*) from public.signoff_documents
    where category = 'trust_reconciliation' and trust_account_id is null) as reconciliations_unassigned;

-- ─────────────────────────────────────────────────────────────────────────
-- ABOUT THE BOX. Supabase scans the editor for destructive keywords and holds
-- the run behind a "this query may be destructive" dialog when it finds one.
-- Section 6 above replaces two indexes, so it trips that scan.
--
-- The box is a confirmation, not a refusal. PRESS THE CONFIRM BUTTON. Closing
-- it with the X or Cancel does nothing at all and looks exactly like success,
-- which is how three earlier migrations were lost.
--
-- What is actually being replaced is two empty indexes on two empty tables —
-- 0031 created them earlier today and nothing has been recorded in either.
