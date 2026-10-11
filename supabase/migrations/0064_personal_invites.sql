-- ===== RUN THIS ONE. Migration 0064, personal invites sent by email, 12 October 2026 =====
--
-- MIGRATION 0064 — personal invites are emailed from the staff page
--
-- Adam, 12 Oct 2026: "I would like anyone that I personally invite to ... have
-- the same functionality as early access invites. So I can send the
-- invitation via the website." Until now a founder invite was a link he
-- copied into his own email. The staff page now sends it, so each invite
-- needs to remember who it went to and when.
--
-- Three new columns on founder_invites, all optional. Existing invites keep
-- working exactly as before and simply show as "link only" until emailed.
-- No new table, so no grants block is needed (founder_invites already has
-- its grants, and its RLS is unchanged: admins read, nobody writes from a
-- browser).
--
-- Changes no existing row. SAFE TO RUN TWICE.

alter table public.founder_invites add column if not exists email text;
alter table public.founder_invites add column if not exists first_name text;
alter table public.founder_invites add column if not exists sent_at timestamptz;

comment on column public.founder_invites.email is
  'Where the staff page emailed this invite. Null for a link Adam copied and sent himself.';
comment on column public.founder_invites.first_name is
  'The name the invitation email greets.';
comment on column public.founder_invites.sent_at is
  'When the staff page last emailed this link. Null means never emailed from the site.';

-- Check: should list email, first_name and sent_at.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'founder_invites'
  and column_name in ('email', 'first_name', 'sent_at')
order by column_name;
