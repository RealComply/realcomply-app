-- ===== RUN THIS ONE. Migration 0031, trust account, 25 Aug 2026 =====
--
-- Monthly trust account reconciliations and the annual audit (Adam, 25 Aug
-- 2026): "the monthly sign off for bank reconciliations of trust accounts and
-- also a tick box to confirm that the trust audit has happened for the year...
-- I want the licensee or the licensee's assistant to be able to [put] the PDF
-- into RealComply so that the licensee can sign within RealComply."
--
-- (One word of that quote is bracketed. Adam's actual word is the one the
-- Supabase SQL editor treats as a destructive keyword, and its presence
-- anywhere in the script — comments included — puts the whole run behind a
-- confirmation modal that silently swallows it. This has cost three failed
-- migration attempts before; see the code-delivery workflow doc.)
--
-- Three things, and one of them is the reason the other two are possible.
--
-- 1. signoff_documents.period_month
--    The monthly reconciliation already exists — a PDF uploaded with a
--    free-text period label ("August 2026") and signed by the licensee. What
--    it could not do is answer "which months are missing", because the period
--    was prose. A date makes the calendar possible, and the calendar is what
--    lets a reminder know whether it should fire at all.
--
--    Stored as the FIRST DAY of the month it covers. Postgres has no month
--    type and a first-of-month date sorts, compares and formats correctly
--    everywhere, which a text 'YYYY-MM' does not.
--
-- 2. trust_audits
--    The annual audit under s111 of the Property and Stock Agents Act 2002
--    (NSW), which must be carried out within 3 months of the end of the audit
--    period; the audit period is the year ending 30 June (s112). The report
--    must be kept for at least 3 years (s111(3)), so period_end is the natural
--    key and retention is computed from the report date rather than stored.
--
-- 3. trust_reminders
--    Which reminders have actually gone out, so a daily job cannot mail the
--    same licensee about the same month every morning. Exactly the pattern
--    licence_reminders uses, and for the same reason — the "never twice"
--    guarantee lives in a unique index, not in application code.
--
-- Additive and re-runnable. Nothing existing is removed or rewritten; the one
-- backfill below is guarded and skips anything it cannot parse.

-- ── 1. The month a reconciliation covers ──────────────────────────────────
alter table public.signoff_documents
  add column if not exists period_month date;

comment on column public.signoff_documents.period_month is
  'For a trust_reconciliation, the first day of the month the reconciliation covers. Null on every other category. This is what makes a missing month knowable; period_label stays as the free-text display form.';

create index if not exists signoff_documents_period_month_idx
  on public.signoff_documents (agency_id, category, period_month);

-- Best-effort backfill of rows written before this column existed. Only
-- touches labels that look exactly like "August 2026", and the whole thing is
-- wrapped so an unparseable label can never abort the migration — a null
-- period_month is a row the calendar shows as unmatched, which is recoverable;
-- a failed migration is not.
do $$
begin
  update public.signoff_documents
     set period_month = to_date(period_label, 'FMMonth YYYY')
   where category = 'trust_reconciliation'
     and period_month is null
     and period_label ~ '^[A-Za-z]+ [0-9]{4}$';
exception
  when others then
    raise notice 'period_month backfill skipped: %', sqlerrm;
end $$;

-- ── 2. The annual audit ───────────────────────────────────────────────────
create table if not exists public.trust_audits (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  -- 30 June of the audit year. s112 fixes the audit period as the year ending
  -- 30 June unless the Secretary orders otherwise, so this is a date rather
  -- than a year integer — an agency on a Secretary-fixed period still fits.
  period_end date not null,
  auditor_name text,
  report_received_on date,
  file_path text,
  file_name text,
  -- The confirmation itself. Deliberately a person and a timestamp rather
  -- than a boolean: "the audit happened" is an assertion somebody makes, and
  -- a tick with nobody's name against it is not a record of anything.
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists trust_audits_period_idx
  on public.trust_audits (agency_id, period_end);

alter table public.trust_audits enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'trust_audits'
       and policyname = 'trust_audits: agency members can view'
  ) then
    create policy "trust_audits: agency members can view"
      on public.trust_audits for select
      using (agency_id = public.current_agency_id());
  end if;

  -- Write is licensee-only. The assistant can upload a monthly reconciliation
  -- (that is the point of this migration) but confirming that the annual audit
  -- has happened is the licensee's assertion and nobody else's.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'trust_audits'
       and policyname = 'trust_audits: licensee can insert'
  ) then
    create policy "trust_audits: licensee can insert"
      on public.trust_audits for insert
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
     where schemaname = 'public' and tablename = 'trust_audits'
       and policyname = 'trust_audits: licensee can update'
  ) then
    create policy "trust_audits: licensee can update"
      on public.trust_audits for update
      using (
        agency_id = public.current_agency_id()
        and exists (
          select 1 from public.profiles me
           where me.id = auth.uid() and me.is_licensee_in_charge
        )
      );
  end if;
end $$;

comment on table public.trust_audits is
  'One row per audit period (year ending 30 June, s112 PSA Act 2002). Holds the auditor, the report, and the licensee in charge''s confirmation that the audit under s111 has been carried out. There is deliberately no delete policy: a confirmation that can be removed is not evidence of anything.';

-- ── 3. Reminders actually sent ────────────────────────────────────────────
create table if not exists public.trust_reminders (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  kind text not null check (kind in ('reconciliation', 'audit')),
  -- First day of the month for a reconciliation; period_end for an audit.
  period date not null,
  -- Which reminder in the sequence. 'day1' / 'day7' / 'day18' for a monthly
  -- reconciliation; 'month1' / 'month2' / 'month3' for the three audit
  -- reminders across July, August and September. A stage rather than a day
  -- number because the audit reminders all fall on the 1st and would
  -- otherwise collide in the unique index below.
  stage text not null,
  recipients text[] not null default '{}',
  sent_at timestamptz not null default now()
);

create index if not exists trust_reminders_agency_id_idx
  on public.trust_reminders (agency_id);

-- The dedupe key, and the whole reason this table exists.
create unique index if not exists trust_reminders_once_idx
  on public.trust_reminders (agency_id, kind, period, stage);

alter table public.trust_reminders enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'trust_reminders'
       and policyname = 'trust_reminders: agency members can view'
  ) then
    -- Read-only to the agency, same as licence_reminders. These rows are
    -- written by the cron job through the service client, which bypasses RLS.
    -- No insert, update or delete policy on purpose: a row removable from the
    -- app would silently re-arm a reminder that has already been sent.
    create policy "trust_reminders: agency members can view"
      on public.trust_reminders for select
      using (agency_id = public.current_agency_id());
  end if;
end $$;

comment on table public.trust_reminders is
  'One row per reminder actually sent about a trust account obligation. The unique index on (agency, kind, period, stage) is what stops the daily job re-sending the same reminder every morning.';

-- ── Verify. Expected: 1 column, 2 tables, 4 policies. ─────────────────────
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'signoff_documents'
      and column_name = 'period_month')                                  as columns_expect_1,
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('trust_audits', 'trust_reminders'))             as tables_expect_2,
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('trust_audits', 'trust_reminders'))              as policies_expect_4,
  (select count(*) from public.signoff_documents
    where category = 'trust_reconciliation' and period_month is not null) as reconciliations_dated,
  (select count(*) from public.signoff_documents
    where category = 'trust_reconciliation' and period_month is null)     as reconciliations_undated;
