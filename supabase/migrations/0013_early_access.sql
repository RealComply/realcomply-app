-- Early-access list for the public landing page (Adam, 13 Aug 2026).
--
-- Context: the root route had been reduced to a redirect straight to /login
-- on 12 Aug, on the reasoning that there was no audience to pitch and no
-- reason to show the product to competitors. Meta ads change that — paid
-- clicks need somewhere to land — so the homepage returns, and the single
-- ask on it is this list.
--
-- THIS MIGRATION MUST BE APPLIED BEFORE ANY AD SPEND. The /aml waitlist page
-- shipped in Aug 2026 against a table (0007_aml_waitlist.sql) that was never
-- created, so every submission during the window it was live failed silently
-- and no signup was ever recoverable. That is the same shape as this feature
-- and the same failure is available here. See the migration-status section of
-- RealComply-code-delivery-workflow.md.
--
-- Access model: write-only from the public internet. The form is submitted by
-- unauthenticated visitors, so RLS has to permit an anonymous INSERT. There is
-- deliberately NO select/update/delete policy — with RLS enabled and no policy
-- for those commands, they are denied by default, so the anon key cannot read
-- the list back even though it can add to it. Adam reads the list in the
-- Supabase dashboard, which uses the service role and bypasses RLS.
--
-- Not using createServiceClient() for the insert, despite that being simpler:
-- src/lib/supabase/service.ts states it must never be reached from a request
-- driven by end-user input, and this is exactly that.

create table public.early_access (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text,                            -- which ad or page sent them, from ?src= on the URL
  created_at timestamptz not null default now()
);

-- One row per address. Prevents a bot or an impatient double-click turning
-- the list into duplicates, and lets the action treat "already there" as
-- success rather than surfacing an error that would tell a stranger whether
-- an address is already on the list.
create unique index early_access_email_key on public.early_access (lower(email));

alter table public.early_access enable row level security;

create policy "early_access: anyone can join" on public.early_access for insert
  with check (true);
