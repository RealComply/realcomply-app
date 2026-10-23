-- 0086: Property management follows the plan (Adam, 21 Oct 2026; PM pricing
-- decided 6 Oct).
--
-- WHY. PM was off for every office until someone switched it on by hand
-- (agencies.pm_enabled, 0052). Raine & Horne Queanbeyan signed up on Office 1
-- and could not see it.
--
-- THE RULE.
--   * Office plans (plan starting office_): PM is on. It is included free;
--     nothing changes in billing or Stripe.
--   * Single agent plans (plan starting agent_): PM is never available.
--   * An office that moves to a single agent plan has PM hidden. Nothing is
--     deleted. Back on an office plan, PM and every record in it come back.
--
-- HOW. pm_enabled stays the one switch the app reads (menu, pages, actions,
-- the 3-year reminder job), but nobody sets it any more: the database sets it
-- from the plan on every insert and every write to plan or pm_enabled. So
-- every way a plan changes (sign-up, which starts every office on office_1;
-- the Stripe webhook; the master page; the SQL editor) carries PM with it,
-- and nothing can leave the two out of step. Before this, an office's own
-- licensee (and a single agent, who counts as the licensee on their own plan)
-- could switch pm_enabled on with a direct call; now it always snaps back to
-- the plan.
--
-- THE DATABASE ENFORCES IT TOO. The PM tables only checked the office
-- (0052, 0053); a person could read and write their office's PM records
-- through the database directly whatever the switch said. Each PM table now
-- has a restrictive rule: no PM for the office, no PM rows, for reading or
-- writing. Records are hidden, never deleted. The platform's own jobs (the
-- service key) are not affected: the end-of-subscription export still
-- includes PM records. Naming the office's records system needs PM too.
--
-- EXISTING OFFICES. PM goes on for every office on an office plan (today:
-- Foster Property Consultants, Lloyd Property Agents, Yes Property Agents,
-- One Agency Deborah Low Property, NindraRealty, Sam RE and Adam's test
-- agency; Cass Property, Comply Real Estate and Raine & Horne Queanbeyan
-- already have it). The two single agent plans (Pomona Property Group UAT,
-- Uralla Properties) already have it off.
--
-- No new table, so no new grants beyond the two functions'. Safe to run twice.
-- It ends with a list of every office, its plan and whether it has PM.

-- 1. The switch follows the plan. -----------------------------------------
create or replace function public.agencies_pm_follows_plan()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.pm_enabled := coalesce(starts_with(new.plan, 'office_'), false);
  return new;
end;
$$;
revoke all on function public.agencies_pm_follows_plan() from public;

drop trigger if exists agencies_pm_follows_plan on public.agencies;
create trigger agencies_pm_follows_plan
  before insert or update of plan, pm_enabled on public.agencies
  for each row execute function public.agencies_pm_follows_plan();

comment on column public.agencies.pm_enabled is
  'Property management. Set by the database from the plan (0086): on for office plans, off for single agent plans. Not set by hand.';

-- 2. Existing offices: in line with their plan. ---------------------------
update public.agencies
   set pm_enabled = coalesce(starts_with(plan, 'office_'), false)
 where pm_enabled is distinct from coalesce(starts_with(plan, 'office_'), false);

-- 3. Has this office got PM? For the database's own rules. ----------------
create or replace function public.agency_has_pm(p_agency uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select a.pm_enabled from public.agencies a where a.id = p_agency), false);
$$;
revoke all on function public.agency_has_pm(uuid) from public;
grant execute on function public.agency_has_pm(uuid) to authenticated, service_role;

-- 4. No PM for the office, no PM rows. -------------------------------------
-- Restrictive: added to each table's own rules (same office), never instead
-- of them.
do $$
declare
  t text;
begin
  foreach t in array array['pm_properties', 'pm_tenancies', 'pm_item_states', 'pm_item_events',
                           'pm_group_moves', 'pm_records'] loop
    execute format('drop policy if exists %I on public.%I', t || ': only with property management', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      'using (public.agency_has_pm(agency_id)) with check (public.agency_has_pm(agency_id))',
      t || ': only with property management', t);
  end loop;
end
$$;

-- 5. Naming the records system needs PM too. -------------------------------
-- And the licensee: 0058 made this licensee-only (may_change_agency_details),
-- but on 21 Oct the live function had lost that check (most likely 0052 was
-- run again, which re-creates it without), so any agent could rename it.
-- Both checks are here now.
create or replace function public.set_agency_pm_records_system(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if v_agency is null then
    raise exception 'not authenticated';
  end if;
  if not public.agency_has_pm(v_agency) then
    raise exception 'Property management comes with the office plans. It is not part of a single agent plan.';
  end if;
  if not public.may_change_agency_details() then
    raise exception 'Only the licensee in charge can change the records system.';
  end if;
  if v_name is not null and length(v_name) > 80 then
    raise exception 'Keep the name of the records system under 80 characters.';
  end if;
  update public.agencies set pm_records_system = v_name where id = v_agency;
end;
$$;

-- 6. Check. Stops, changing nothing, if anything above is not in place. ------
do $$
declare
  n integer;
begin
  if not exists (select 1 from pg_trigger where tgname = 'agencies_pm_follows_plan'
                   and tgrelid = 'public.agencies'::regclass) then
    raise exception 'Check failed: the plan rule is not on the offices table.';
  end if;
  select count(*) into n from public.agencies
   where pm_enabled is distinct from coalesce(starts_with(plan, 'office_'), false);
  if n <> 0 then
    raise exception 'Check failed: % offices have PM out of step with their plan.', n;
  end if;
  select count(*) into n from pg_policies
   where schemaname = 'public' and policyname like '%: only with property management' and permissive = 'RESTRICTIVE';
  if n <> 6 then
    raise exception 'Check failed: % PM tables have the PM rule, expected 6.', n;
  end if;
  if position('may_change_agency_details' in pg_get_functiondef('public.set_agency_pm_records_system(text)'::regprocedure)) = 0
     or position('agency_has_pm' in pg_get_functiondef('public.set_agency_pm_records_system(text)'::regprocedure)) = 0 then
    raise exception 'Check failed: naming the records system is missing a check.';
  end if;
end
$$;

-- Every office, its plan, and whether it has PM.
select a.name as office,
       a.plan,
       case when a.pm_enabled then 'PM on' else 'PM off' end as property_management,
       (select count(*) from public.pm_properties p where p.agency_id = a.id) as managed_properties
  from public.agencies a
 order by a.pm_enabled desc, a.plan, a.name;
