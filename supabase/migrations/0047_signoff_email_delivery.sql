-- ===== RUN THIS ONE. Migration 0047, sign-off link email delivery, 17 Sep 2026 =====
--
-- Records whether the sign-off link was actually EMAILED, as distinct from
-- whether it was created.
--
-- WHY THIS IS NOT JUST A BOOLEAN IN THE UI. The panel is about to say "Sent to
-- the licensee on <date>", and that sentence has to be earned. An email send
-- can fail — a bad address, a suppressed recipient, a provider having a bad
-- afternoon — and if the screen says "sent" regardless, an agent will sit
-- waiting for a signature on a message that never left the building. That is
-- the same fault as the storage backup panel reading "Nothing outstanding"
-- over an empty bucket (16 Sep 2026), and the same rule applies: anything that
-- reports a status must be able to report that it failed.
--
-- So: three columns. When it was sent, how many times it has been attempted,
-- and what went wrong last time. A row with attempts > 0 and no email_sent_at
-- is a link that exists and was never delivered, and the agent is told to copy
-- it and send it themselves.
--
-- Additive and re-runnable. Safe to run twice.

alter table public.property_signoff_requests
  add column if not exists email_sent_at   timestamptz,
  add column if not exists email_attempts  integer not null default 0,
  add column if not exists email_error     text;

comment on column public.property_signoff_requests.email_sent_at is
  'When RealComply successfully handed this link to the email provider. NULL means it was never delivered — the link may still be valid and copyable.';
comment on column public.property_signoff_requests.email_attempts is
  'Send attempts. Climbing against a NULL email_sent_at is the signal that delivery is broken rather than slow.';
comment on column public.property_signoff_requests.email_error is
  'Last delivery failure, for the agent and for the logs. NULL once a send succeeds.';

-- Verify. Expect 3.
select count(*) as columns_expect_3
from information_schema.columns
where table_schema = 'public'
  and table_name = 'property_signoff_requests'
  and column_name in ('email_sent_at', 'email_attempts', 'email_error');
