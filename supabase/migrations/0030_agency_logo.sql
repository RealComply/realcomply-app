-- ===== RUN THIS ONE. Migration 0030, agency logo, 23 Aug 2026 =====
--
-- Lets an agency put their own mark on the compliance record they hand to Fair
-- Trading. Adam, 23 Aug 2026: "when an office subscription is set up, they're
-- going to have to add their logo. If it's an individual agent, then perhaps
-- what we do is have the office name then the agent's name without a logo."
--
-- Deliberately keyed off WHETHER A LOGO EXISTS rather than off a subscription
-- tier, because the tiers do not exist yet and this does not need them: an
-- office that uploads one gets it, an agent who does not gets a text masthead.
-- When billing lands, the office tier simply makes the upload part of setup.
--
-- The file itself goes in the existing compliance-evidence bucket under
-- <agency_id>/_brand/..., so the storage policies from 0002 apply unchanged —
-- they only ever check the first path segment against the caller's agency.
-- A separate bucket would mean a second set of policies to get right for no
-- benefit.
--
-- Safe to run more than once.

alter table public.agencies
  add column if not exists logo_path text;

comment on column public.agencies.logo_path is
  'Object path in the compliance-evidence bucket for the agency''s own logo, drawn on the finalised compliance record. Null means no logo, which is the individual-agent case and renders a text masthead instead.';

-- Same reasoning as set_agency_website in 0017: agencies carries a SELECT
-- policy only, and opening a general UPDATE policy would expose every column on
-- the table in order to set one field.
--
-- Licensee-only. The logo is what the agency's compliance record is signed with
-- in the eyes of whoever reads it, so an ordinary agent should not be able to
-- change it.
create or replace function public.set_agency_logo(p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency_id uuid := public.current_agency_id();
begin
  if v_agency_id is null then
    raise exception 'no agency for this user';
  end if;

  if not exists (
    select 1 from public.profiles
     where id = auth.uid() and is_licensee_in_charge
  ) then
    raise exception 'only the licensee in charge can change the agency logo';
  end if;

  update public.agencies
     set logo_path = nullif(btrim(p_path), '')
   where id = v_agency_id;
end;
$$;

grant execute on function public.set_agency_logo(text) to authenticated;

-- Expect both to be 1.
select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='agencies' and column_name='logo_path') as column_expect_1,
  (select count(*) from information_schema.routines
     where routine_schema='public' and routine_name='set_agency_logo') as function_expect_1;
