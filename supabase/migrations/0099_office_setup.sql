-- ===== 0099: "Set up your office" on Home (Adam, 27 Oct 2026) =====
--
-- Home shows a new office what to set up next. Every step ticks itself from
-- what is already in RealComply; nobody ticks a step by hand. This adds the
-- two things that were not recorded anywhere:
--
--   1. "Doesn't apply", with who and when, on the steps that may not apply
--      to an office: workers compensation (iCare), a trust account, a
--      corporation licence (a sole trader has none) and inviting a team (an
--      office of one). On an agent's own plan also the SG Manual (they may
--      work under their agency's), with the trust account reading "My
--      deposits go into the agency's trust account" (addendum, Adam 27 Oct
--      2026). It counts as done.
--   2. The moment an office first had every step done ('all_done'). After
--      that Home shows one small line instead of the card, even if someone
--      joins later (they get their own card) or a policy lapses (the expiry
--      reminders handle that).
--
-- Written only by the two functions below, for the caller's own office, by
-- its licensee in charge, an office manager, or the agent on their own plan.
-- Everyone in the office can read their office's rows.
--
-- One new table, with its grants in this file (from 30 Oct 2026 Supabase
-- stops granting new tables to the API roles by default). Safe to run twice.

create table if not exists public.office_setup_marks (
  agency_id  uuid not null references public.agencies (id) on delete cascade,
  step       text not null check (step in ('icare', 'trust_account', 'corporation_licence', 'team_invited', 'sg_manual', 'all_done')),
  marked_by  uuid references public.profiles (id) on delete set null,
  marked_at  timestamptz not null default now(),
  primary key (agency_id, step)
);
-- The step list again, so a second run brings an older list up to date.
alter table public.office_setup_marks drop constraint if exists office_setup_marks_step_check;
alter table public.office_setup_marks add constraint office_setup_marks_step_check
  check (step in ('icare', 'trust_account', 'corporation_licence', 'team_invited', 'sg_manual', 'all_done'));
comment on table public.office_setup_marks is
  'Set up your office (0099, Adam 27 Oct 2026): a step marked "Doesn''t apply" (who and when), or all_done, the moment every step was first done. Written only by set_office_setup_not_applicable() and note_office_setup_done().';

alter table public.office_setup_marks enable row level security;
drop policy if exists "office_setup_marks: own office" on public.office_setup_marks;
create policy "office_setup_marks: own office" on public.office_setup_marks
  for select to authenticated
  using (agency_id = public.current_agency_id());

revoke all on table public.office_setup_marks from public, anon, authenticated;
grant select on public.office_setup_marks to authenticated;
grant select, insert, update, delete on public.office_setup_marks to service_role;

-- "Doesn't apply" on (p_not_applicable true) or off again (false), for the
-- caller's office. Only the steps above (the SG Manual only on an agent's own
-- plan), and only by the licensee in charge, an office manager or the agent
-- on their own plan (acts_as_licensee() covers the licensee and that agent).
-- The first marking is kept: marking it again changes nothing.
create or replace function public.set_office_setup_not_applicable(p_step text, p_not_applicable boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if p_step is null or p_step not in ('icare', 'trust_account', 'corporation_licence', 'team_invited', 'sg_manual') then
    raise exception 'That step can''t be marked as not applying.';
  end if;
  if not (public.acts_as_licensee() or public.is_office_manager()) then
    raise exception 'Only the licensee in charge or an office manager can do that.' using errcode = '42501';
  end if;
  if p_step = 'sg_manual' and not exists (
       select 1 from public.agencies
        where id = public.current_agency_id() and left(coalesce(plan, ''), 6) = 'agent_') then
    raise exception 'An office keeps its own SG Manual.';
  end if;

  if coalesce(p_not_applicable, false) then
    insert into public.office_setup_marks (agency_id, step, marked_by)
    values (public.current_agency_id(), p_step, auth.uid())
    on conflict (agency_id, step) do nothing;
  else
    delete from public.office_setup_marks
     where agency_id = public.current_agency_id() and step = p_step;
  end if;
  return true;
end
$$;

revoke execute on function public.set_office_setup_not_applicable(text, boolean) from public, anon;
grant execute on function public.set_office_setup_not_applicable(text, boolean) to authenticated;

-- Records that the caller's office has every step done. Home calls it the
-- first time it finds them all done; the first time is kept. It only ever
-- hides the caller's own office's set-up card, so the app's count is
-- trusted here rather than repeated in SQL.
create or replace function public.note_office_setup_done()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if not (public.acts_as_licensee() or public.is_office_manager()) then
    raise exception 'Only the licensee in charge or an office manager can do that.' using errcode = '42501';
  end if;
  insert into public.office_setup_marks (agency_id, step, marked_by)
  values (public.current_agency_id(), 'all_done', auth.uid())
  on conflict (agency_id, step) do nothing;
  return true;
end
$$;

revoke execute on function public.note_office_setup_done() from public, anon;
grant execute on function public.note_office_setup_done() to authenticated;

-- How many listings the caller's office has, for "First listing added". An
-- office manager sees only their own listings (can_see_agent, 0058), so the
-- office's count comes from here. Only for whoever runs the office
-- (runs_office(): the licensee in charge, an office manager, or the agent on
-- their own plan); anyone else gets null. Archived listings count.
create or replace function public.office_setup_listing_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when public.runs_office()
              then (select count(*)::integer from public.properties where agency_id = public.current_agency_id())
         end;
$$;

revoke execute on function public.office_setup_listing_count() from public, anon;
grant execute on function public.office_setup_listing_count() to authenticated;

-- What it shows when it has run: true, true, true.
select to_regclass('public.office_setup_marks') is not null as setup_marks_ready,
       has_table_privilege('authenticated', 'public.office_setup_marks', 'select')
         and not has_table_privilege('authenticated', 'public.office_setup_marks', 'insert') as read_only_to_the_app,
       has_function_privilege('authenticated', 'public.set_office_setup_not_applicable(text, boolean)', 'execute')
         and not has_function_privilege('anon', 'public.set_office_setup_not_applicable(text, boolean)', 'execute') as only_signed_in;
