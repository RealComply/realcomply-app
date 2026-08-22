-- 0027 — the licensee in charge's NAME, alongside their email.
--
-- Adam, 22 Aug 2026, describing agent-tier onboarding: "they have to put in
-- their name, email address, name of their office, the office website, and
-- then their licensee's name and email address."
--
-- Everything on that list was already collected except the licensee's name.
-- 0014 added licensee_email so sign-off links had somewhere to go, and an
-- address was all a link needed.
--
-- A name is not decoration here. On the agent tier the licensee is not a user
-- of the product at all: they exist only as the person a sign-off request is
-- sent to, and the person whose approval the compliance file then rests on.
-- A file that records "signed by someone at this email" is a weaker record
-- than one that names the licensee in charge, and the sign-off statement is
-- snapshotted at the moment it is issued, so the name has to be there before
-- the link is created rather than reconstructed afterwards.
--
-- Safe to run more than once.

alter table public.agencies
  add column if not exists licensee_name text;

comment on column public.agencies.licensee_name is
  'Name of the licensee in charge who signs off compliance files. Paired with licensee_email. On the agent tier this person is not a user of the product.';

-- NEW FUNCTION, not a change to set_agency_licensee_email.
--
-- Postgres will not let CREATE OR REPLACE FUNCTION change a signature, and
-- removing the old one first puts the word Supabase treats as destructive into
-- the script, which hides the whole run behind a confirmation dialog. Same
-- reasoning as invite_preview in 0025. The old single-argument function is
-- left in place and simply falls out of use.
create or replace function public.set_agency_licensee(p_name text, p_email text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.agencies
     set licensee_name = nullif(btrim(p_name), ''),
         licensee_email = nullif(btrim(p_email), '')
   where id = public.current_agency_id();
$$;

grant execute on function public.set_agency_licensee(text, text) to authenticated;

select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='agencies' and column_name='licensee_name') as column_expect_1,
  (select count(*) from information_schema.routines
     where routine_schema='public' and routine_name='set_agency_licensee') as function_expect_1;
