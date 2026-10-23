-- ===== RUN THIS ONE. Migration 0088, expiry reminders for everything, 23 October 2026 =====
--
-- Adam, 22 Oct 2026: "Every item in RealComply that has an expiry date sends
-- reminder emails at 90, 60, 30, 14 and 7 days before expiry, the same way
-- licence and CPD reminders already work." Until now only licences (a
-- person's, and the office's corporation licence) were reminded. The three
-- insurance policies on the office row (professional indemnity, cyber, iCare
-- workers) and every added policy in insurance_policies (0078) were not.
--
-- The reminder job stays one job, and licence_reminders stays its record.
-- The table is NOT renamed: the register and the job read it by name, and a
-- rename would break whichever ran first, the SQL or the new code. Its
-- comment now says it holds every expiry reminder.
--
-- What this file does:
--
--   1. subject_kind: no longer only 'profile' and 'corporation'. Any short
--      lower-case key may be used, so a future table with an expiry date
--      plugs into the job in code without another change here. Today's keys:
--      profile, corporation, insurance_pi, insurance_cyber, insurance_icare,
--      insurance_policy.
--   2. subject_id: which row a reminder was about, when there can be more
--      than one of a kind in an office (an added insurance policy). A
--      person's licence keeps using profile_id, as it always has.
--   3. The "never send twice" key becomes (office, kind, subject, expiry
--      date, threshold). Keeping the expiry date in it is still what makes a
--      renewal start a fresh cycle: a later date has no rows yet.
--
-- No new table, so no new grants (RealComply-supabase-data-api-grants-30-Oct.md
-- applies to new tables only). The read rule is unchanged: a person sees
-- reminders about their own licence, the licensee sees all of them,
-- insurance included. Nothing is deleted and no reminder already sent
-- changes. Safe to run more than once.
--
-- Best run before the code that comes with it goes live. Either order is
-- safe: until this has run, licence reminders carry on as before and the new
-- insurance reminders are refused by the old check and simply wait (nothing
-- is marked as sent, so they go out on the first morning after it runs).

begin;

-- Order check: the reminders table (0019).
do $$
begin
  if to_regclass('public.licence_reminders') is null then
    raise exception 'Run 0019 before this one. Nothing was changed.';
  end if;
end $$;

-- ── 1. Any kind of expiring item ──────────────────────────────────────────
alter table public.licence_reminders drop constraint if exists licence_reminders_subject_kind_check;
alter table public.licence_reminders add constraint licence_reminders_subject_kind_check
  check (subject_kind ~ '^[a-z][a-z_]{1,39}$');

comment on column public.licence_reminders.subject_kind is
  'What expired: profile (a person''s licence or certificate), corporation (the office''s corporation licence), insurance_pi, insurance_cyber, insurance_icare (the three policies on the office row), insurance_policy (a row in insurance_policies). New kinds are added in code (src/lib/email/licence-reminders.ts).';

-- ── 2. Which row it was about ─────────────────────────────────────────────
alter table public.licence_reminders add column if not exists subject_id uuid;

comment on column public.licence_reminders.subject_id is
  'The row the reminder was about, when an office can have more than one of that kind and it is not a person (insurance_policy: insurance_policies.id). A person''s licence uses profile_id instead. Null for things an office has only one of (corporation licence, the three fixed policies). No foreign key, because it can point at different tables.';

-- ── 3. Never the same reminder twice ──────────────────────────────────────
-- subject_id, else profile_id, so two people (or two added policies) with
-- the same expiry date never collide, and every row already sent keeps
-- exactly the key it had.
drop index if exists public.licence_reminders_once_idx;
create unique index licence_reminders_once_idx
  on public.licence_reminders (
    agency_id,
    subject_kind,
    coalesce(subject_id, profile_id, '00000000-0000-0000-0000-000000000000'::uuid),
    expiry_date,
    threshold_days
  );

comment on table public.licence_reminders is
  'One row per expiry reminder actually sent: licences, the corporation licence and insurance (0088). The unique index on (agency, kind, subject, expiry_date, threshold) is what stops a daily job re-sending, and keying on expiry_date is what makes a renewal start a fresh reminder cycle.';

commit;

-- ── Verify. Expected: true, true, 1 ──
select
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.licence_reminders'::regclass
      and conname = 'licence_reminders_subject_kind_check') like '%~%'               as check_is_open_expect_true,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'licence_reminders'
             and column_name = 'subject_id')                                          as subject_id_expect_true,
  (select count(*) from pg_indexes
    where tablename = 'licence_reminders' and indexname = 'licence_reminders_once_idx'
      and indexdef like '%subject_id%')                                               as unique_key_expect_1;
