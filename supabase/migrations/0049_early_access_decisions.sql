-- ===== RUN THIS ONE. Migration 0049, early access decisions, 18 Sep 2026 =====
--
-- Turns the early-access list from a pile of names into a queue with two
-- decisions on it: invite, or decline.
--
-- Adam, 18 Sep 2026: "I want to know what it looks like once we are ready and
-- live to accept invitations... so I can either deny or accept anyone that's
-- registered for early access."
--
-- WHY IT NEEDED TO BECOME A DECISION AND NOT A READ. Until now the list was
-- write-only: people registered, Adam got a notification, and the rows sat in
-- the database with nothing recording what he did about any of them. That is
-- workable for eleven names and unworkable the moment the ads are running
-- again, because the question stops being "who registered" and becomes "who
-- have I already dealt with".
--
-- WHY A DECLINE IS RECORDED RATHER THAN REMOVED, and this is the point of the
-- migration. On 18 Sep 2026 **Think Real Estate** — a training company that
-- also supplies the compliance forms this product replaces — registered for
-- early access through a Facebook ad. That is a competitor doing reconnaissance
-- rather than a customer, and the answer was no.
--
-- A row that is gone cannot say no. It looks identical to someone who never
-- registered, so the same name arriving again in three months gets considered
-- from scratch — possibly by a tired person on a Friday who does not recognise
-- it. A declined row with a note keeps the reasoning attached to the name.
--
-- DECLINING SENDS NOTHING. There is deliberately no email on this path. An
-- automated rejection reads badly to a real prospect who was simply too early,
-- and for a competitor it confirms they were spotted. A decline is a filing
-- decision; anything Adam wants to say, he says himself.
--
-- Additive and re-runnable.

alter table public.early_access
  add column if not exists invited_at    timestamptz,
  add column if not exists invited_token text,
  add column if not exists declined_at   timestamptz,
  add column if not exists declined_note text;

comment on column public.early_access.invited_at is
  'When a founder invite was sent to this registrant. NULL means still waiting on a decision.';
comment on column public.early_access.invited_token is
  'The founder_invites token issued to them, so the staff page can show invited-but-not-signed-up separately from invited-and-now-an-agency.';
comment on column public.early_access.declined_at is
  'When this registrant was declined. Nothing is emailed on decline — see the note at the top of this migration.';
comment on column public.early_access.declined_note is
  'Why. Kept so the same name arriving again is considered with the earlier reasoning to hand rather than from scratch.';

-- Verify. Expect 4.
select count(*) as columns_expect_4
from information_schema.columns
where table_schema = 'public'
  and table_name = 'early_access'
  and column_name in ('invited_at', 'invited_token', 'declined_at', 'declined_note');
