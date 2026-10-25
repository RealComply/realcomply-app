-- 0090: One-off announcements, the record of each one sent (22 Oct 2026).
--
-- NUMBERING. Run on live by Adam on 22 Oct 2026 as "0087", before
-- 0087_first_listing_before_annexure.sql reached main from another branch.
-- Renumbered 0090 (25 Oct) so the two never share a number; 0088 and 0089
-- were taken. The SQL is unchanged and safe to run again.
--
-- The first: Adam, 22 Oct 2026, "one-off email telling five offices that
-- property management is now in their account". Sent from the staff page to
-- the licensee in charge of five named offices. "Each office gets it once.
-- Record each send so a second run sends nothing."
--
-- One row per office per announcement, the same pattern as cpd_reminders
-- (0084):
--   * written through the service key BEFORE the email goes, so a failed
--     write never sends;
--   * a unique index on (announcement, office) so an office can't get the
--     same announcement twice, even if two runs overlap;
--   * status says what happened: 'sending' until the email provider answers,
--     then 'sent' or 'failed'. A failed one is not retried by itself; a
--     person looks at it.
--
-- Staff only. Read and written by the staff page through the service key, so
-- RLS is on with no policies: nobody signed in to the app can read or change
-- a row. A row removable from the app would re-arm an announcement already
-- sent.
--
-- New table, so the grants block (from 30 Oct 2026 Supabase stops granting
-- new tables to the Data API automatically). Nothing existing changes. Safe
-- to run more than once.

create table if not exists public.announcement_sends (
  id uuid primary key default gen_random_uuid(),
  -- Which announcement, e.g. 'pm-launch-2026-10'.
  announcement text not null check (length(announcement) between 1 and 80),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  -- The licensee in charge it went to. Their name and address are copied
  -- into the row too, so the record still reads if the person later leaves.
  profile_id uuid references public.profiles(id) on delete set null,
  office_name text not null,
  recipient_name text,
  recipient text not null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- The dedupe key, and the reason the table exists.
create unique index if not exists announcement_sends_once_idx
  on public.announcement_sends (announcement, agency_id);
create index if not exists announcement_sends_agency_id_idx on public.announcement_sends (agency_id);
create index if not exists announcement_sends_profile_id_idx on public.announcement_sends (profile_id);

alter table public.announcement_sends enable row level security;

-- Grants. Only the platform (the service key) reads or writes. Nothing for
-- anon or signed-in people.
revoke all on table public.announcement_sends from public, anon, authenticated;
grant select, insert, update, delete on public.announcement_sends to service_role;

comment on table public.announcement_sends is
  'One row per office per one-off announcement email sent from the staff page (first: property management is now in your account, Oct 2026). The unique index on (announcement, office) stops a repeat. Written before the email goes. Service key only.';

-- What you should see: one row. table_ready true, rls_on true, grants_ok
-- true, sends_so_far 0 (or 5 once the announcement has gone).
select
  to_regclass('public.announcement_sends') is not null as table_ready,
  (select relrowsecurity from pg_class where oid = 'public.announcement_sends'::regclass) as rls_on,
  (has_table_privilege('service_role', 'public.announcement_sends', 'insert')
   and has_table_privilege('service_role', 'public.announcement_sends', 'update')
   and not has_table_privilege('authenticated', 'public.announcement_sends', 'select')
   and not has_table_privilege('authenticated', 'public.announcement_sends', 'insert')
   and not has_table_privilege('anon', 'public.announcement_sends', 'select')) as grants_ok,
  (select count(*) from public.announcement_sends) as sends_so_far;
