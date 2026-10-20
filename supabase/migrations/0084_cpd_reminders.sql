-- 0084: CPD deadline reminders, the record of each one sent (19 Oct 2026).
--
-- The CPD year runs 1 July to 30 June. Adam, 19 Oct 2026: reminders on
-- 1 April, 1 May, 1 June and 23 June to everyone whose CPD for the year isn't
-- ticked as done (cpd_year_signoffs, 0023), and one summary to the licensee in
-- charge of who is still outstanding. Done means quiet: the job reads the
-- tick at send time.
--
-- This table is the record of what went out, the same pattern as
-- licence_reminders (0019) and trust_reminders (0031):
--   * one row per email actually sent, written by the daily job through the
--     service client BEFORE the email goes, so a failed write never sends;
--   * a unique index on (person, CPD year, send date, kind) so nobody gets
--     the same date twice, even if two runs overlap;
--   * read-only from the app. No insert, update or delete policy: a row
--     removable from the app would re-arm a reminder already sent.
--
-- kind 'person'  : the reminder to someone whose year isn't ticked.
--                  profile_id is that person.
-- kind 'summary' : the licensee in charge's list of who is outstanding.
--                  profile_id is the licensee it went to; outstanding holds
--                  who was on the list, as it stood at send time.
--
-- New table, so the grants block (from 30 Oct 2026 Supabase stops granting
-- new tables to the Data API automatically). Nothing existing changes. Safe
-- to run more than once.

create table if not exists public.cpd_reminders (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('person', 'summary')),
  -- 1 July that starts the CPD year the reminder was about.
  cpd_year_start date not null check (extract(month from cpd_year_start) = 7 and extract(day from cpd_year_start) = 1),
  -- Which of the four dates: 1 April, 1 May, 1 June or 23 June of the year
  -- the CPD year ends in.
  send_date date not null,
  -- Who was outstanding, for a summary. Empty for a person reminder.
  outstanding uuid[] not null default '{}',
  recipients text[] not null default '{}',
  sent_at timestamptz not null default now()
);

create index if not exists cpd_reminders_agency_id_idx on public.cpd_reminders (agency_id);
create index if not exists cpd_reminders_profile_id_idx on public.cpd_reminders (profile_id);

-- The dedupe key, and the reason the table exists.
create unique index if not exists cpd_reminders_once_idx
  on public.cpd_reminders (profile_id, kind, cpd_year_start, send_date);

alter table public.cpd_reminders enable row level security;

-- Each person sees their own; the licensee sees the office's. Same as
-- licence_reminders since 0058.
drop policy if exists "cpd_reminders: own or licensee can view" on public.cpd_reminders;
create policy "cpd_reminders: own or licensee can view" on public.cpd_reminders
  for select using (agency_id = public.current_agency_id()
                    and (public.acts_as_licensee() or profile_id = auth.uid()));

-- Grants. Signed-in people may read (the policy above narrows it); only the
-- platform's own jobs write. Nothing for anon.
revoke all on table public.cpd_reminders from public, anon;
revoke insert, update, delete on table public.cpd_reminders from authenticated;
grant select on public.cpd_reminders to authenticated;
grant select, insert, update, delete on public.cpd_reminders to service_role;

comment on table public.cpd_reminders is
  'One row per CPD deadline reminder sent (1 April, 1 May, 1 June, 23 June): a person whose CPD year is not ticked done, or the licensee in charge''s summary of who is outstanding. The unique index on (person, kind, CPD year, send date) stops a repeat. Written only by the daily job.';

-- What you should see: one row. table_ready true, policy_ready true,
-- grants_ok true, reminders_so_far 0.
select
  to_regclass('public.cpd_reminders') is not null as table_ready,
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cpd_reminders'
           and policyname = 'cpd_reminders: own or licensee can view') as policy_ready,
  (has_table_privilege('authenticated', 'public.cpd_reminders', 'select')
   and not has_table_privilege('authenticated', 'public.cpd_reminders', 'insert')
   and not has_table_privilege('authenticated', 'public.cpd_reminders', 'update')
   and not has_table_privilege('authenticated', 'public.cpd_reminders', 'delete')
   and not has_table_privilege('anon', 'public.cpd_reminders', 'select')
   and has_table_privilege('service_role', 'public.cpd_reminders', 'insert')) as grants_ok,
  (select count(*) from public.cpd_reminders) as reminders_so_far;
