-- ===== RUN THIS ONE. Migration 0068, the SG annexure is for office plans only, 14 October 2026 =====
--
-- CORRECTION (Adam, 14 Oct 2026), restoring the 22 Sep 2026 rule. On an
-- individual agent plan RealComply never emails or contacts the agent's
-- licensee, and an agent on their own plan is not the licensee for the
-- annexure. Was (0067): create_sg_annexure_link() and the adoptions record
-- used acts_as_licensee(), which counts an agent on their own plan as the
-- licensee, so such an agent could make a signing link for themselves. Now:
--
--   1. create_sg_annexure_link() is for the licensee in charge of an office
--      only (is_office_licensee(), 0058). An agent on their own plan, and
--      everyone else, is refused.
--   2. No annexure link can exist for an office on an agent plan, whoever
--      makes it, the server included: a trigger refuses it. That closes every
--      path that could send a signing link to an agent's licensee.
--   3. The adoptions record is read by the licensee in charge of an office
--      only.
--
-- Office plans are unchanged: the licensee in charge is the subscriber, and
-- the welcome box, the signing page and the Home reminder are theirs.
--
-- Nothing on live to change: no annexure links or adoptions exist (13 Oct
-- 2026, after the clean-up). Safe to run more than once.

begin;

-- Order check: 0067 and 0058 first.
do $$
begin
  if to_regprocedure('public.create_sg_annexure_link()') is null
     or to_regclass('public.sg_annexure_links') is null then
    raise exception 'Run 0067 (the SG annexure) before this one. Nothing was changed.';
  end if;
  if to_regprocedure('public.is_office_licensee()') is null then
    raise exception 'is_office_licensee() is missing (0058). Nothing was changed.';
  end if;
end $$;

-- 1. A fresh link: the licensee in charge of an office only.
create or replace function public.create_sg_annexure_link()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_email text;
  v_token uuid;
begin
  if v_agency is null or not public.is_office_licensee() then
    raise exception 'Only the licensee in charge can adopt the annexure.';
  end if;
  select nullif(lower(btrim(email)), '') into v_email from public.profiles where id = auth.uid();
  if v_email is null then
    raise exception 'Your login has no email address.';
  end if;
  insert into public.sg_annexure_links (agency_id, sent_to, created_by)
  values (v_agency, v_email, auth.uid())
  returning token into v_token;
  return v_token;
end
$$;
revoke execute on function public.create_sg_annexure_link() from public, anon;
grant execute on function public.create_sg_annexure_link() to authenticated;

-- 2. Never a link for an agent plan, whoever makes it.
create or replace function public.sg_annexure_links_office_plans_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.agencies a
              where a.id = new.agency_id and left(coalesce(a.plan, ''), 6) = 'agent_') then
    raise exception 'The annexure is not sent for an agent on their own plan.';
  end if;
  return new;
end
$$;
revoke execute on function public.sg_annexure_links_office_plans_only() from public, anon, authenticated;

drop trigger if exists sg_annexure_links_office_plans_only on public.sg_annexure_links;
create trigger sg_annexure_links_office_plans_only
  before insert or update of agency_id on public.sg_annexure_links
  for each row execute function public.sg_annexure_links_office_plans_only();

-- 3. The adoptions record: the licensee in charge of an office.
drop policy if exists "sg_annexure_adoptions: licensee can view" on public.sg_annexure_adoptions;
create policy "sg_annexure_adoptions: licensee can view" on public.sg_annexure_adoptions
  for select using (agency_id = public.current_agency_id() and public.is_office_licensee());

commit;

-- Check: one row, every column true.
select
  position('is_office_licensee' in pg_get_functiondef('public.create_sg_annexure_link()'::regprocedure)) > 0
    as fresh_link_office_only,
  exists (select 1 from pg_trigger where tgname = 'sg_annexure_links_office_plans_only'
            and tgrelid = 'public.sg_annexure_links'::regclass) as no_links_for_agent_plans,
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sg_annexure_adoptions'
            and policyname = 'sg_annexure_adoptions: licensee can view'
            and qual like '%is_office_licensee%') as adoptions_office_licensee_only;
