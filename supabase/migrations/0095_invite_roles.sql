-- ===== 0095: Team invites for every role =====
--
-- Mockup approved by Adam, 26 Oct 2026. Inviting someone to the office now
-- offers five roles: Agent, Assistant, Licensee in charge, Office manager and
-- Property manager (Agent and Assistant only, until now).
--
--   Licensee in charge: only where the office's licensee in charge isn't on
--     RealComply, and only to the licensee named in Office profile, at that
--     email, exactly as recorded. The invite can't name anyone else. When
--     they join they're licensee in charge, and the history records it as an
--     invite: not a handover, so no Fair Trading reminder, no new annexure
--     adoption, and billing stays with whoever set the office up. Where the
--     licensee is on RealComply, handing over stays Change licensee in charge
--     in Office profile (Adam, 16 Oct 2026; 0080).
--
--     REVERSAL (Adam, 26 Oct 2026). Was (0093, 26 Oct): an office manager
--     can't invite or appoint a licensee in charge. Now an office manager can
--     invite the licensee in charge named in Office profile, and no one else,
--     while the office has no licensee in charge on RealComply.
--
--   Office manager: only the licensee in charge, with a login, and not on an
--     agent plan. They tick "I authorise [name] to manage [office]'s
--     RealComply account as office manager." on the invite; the database
--     writes those words and the time. When the person joins they're office
--     manager, recorded like an approval in Team. If by then the person who
--     invited them is no longer licensee in charge, they join as an agent.
--
--   Property manager: an agent whose work is property management. Property
--     management comes first in their menu, and their licence category starts
--     as residential property management (it sets their CPD). They can still
--     list sales. Only on plans that include property management.
--
--   The licensee's name and email in Office profile (Adam, 26 Oct 2026, "as
--     decided 9 Oct"): only the licensee can change them, checked here, not
--     only on screen. Until now (0058) the person who set up an office whose
--     licensee isn't on RealComply could change them too, which also meant
--     they could point the office manager approval link at an address of
--     their own. Corrections for those offices go to admin@realcomply.com.au.
--
-- No new tables. agency_invites and profiles are granted to the app's roles
-- table-wide, so the new columns are covered; the check at the end proves it.
-- Safe to run twice.

-- ── 1. New columns ─────────────────────────────────────────────────────

alter table public.agency_invites
  add column if not exists is_office_manager boolean not null default false,
  add column if not exists office_manager_wording text,
  add column if not exists office_manager_authorised_at timestamptz,
  add column if not exists is_property_manager boolean not null default false;

comment on column public.agency_invites.office_manager_wording is
  'The words the licensee in charge ticked on an office manager invite, written by the database (0095).';
comment on column public.agency_invites.office_manager_authorised_at is
  'When the licensee in charge ticked them (0095).';

alter table public.profiles
  add column if not exists is_property_manager boolean not null default false;

comment on column public.profiles.is_property_manager is
  'Works in property management: Property management first in their menu. Still an agent (0095).';

-- ── 2. The licensee joining by invite, in the licensee history ─────────

alter table public.licensee_in_charge_history
  drop constraint if exists licensee_in_charge_history_source_check;
alter table public.licensee_in_charge_history
  add constraint licensee_in_charge_history_source_check
  check (source in ('backfill', 'first', 'change', 'team', 'invite'));

-- As 0080, with one branch added: the named licensee joining by invite.
create or replace function public.log_licensee_in_charge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_was boolean;
  v_is boolean;
  v_ctx jsonb := nullif(current_setting('realcomply.licensee_change', true), '')::jsonb;
  v_today date := public.sydney_today();
  v_source text;
  v_start date;
  v_ft date;
  v_end date;
begin
  select a.plan into v_plan from public.agencies a where a.id = new.agency_id;
  if left(coalesce(v_plan, ''), 6) = 'agent_' then
    return null;
  end if;
  v_was := tg_op = 'UPDATE' and old.is_licensee_in_charge and old.archived_at is null;
  v_is := coalesce(new.is_licensee_in_charge, false) and new.archived_at is null;
  if v_was = v_is then
    return null;
  end if;

  if v_is then
    if exists (select 1 from public.licensee_in_charge_history h
                where h.agency_id = new.agency_id and h.profile_id = new.id and h.ended_at is null) then
      return null;
    end if;
    if v_ctx is not null and v_ctx ->> 'new_profile' = new.id::text then
      v_source := 'change';
      v_start := (v_ctx ->> 'took_effect')::date;
      v_ft := nullif(v_ctx ->> 'fair_trading', '')::date;
    elsif v_ctx is not null and v_ctx ->> 'invite_profile' = new.id::text then
      -- The licensee already named in Office profile, joining by invite
      -- (0095). Not a handover: since when isn't known here, so it's left
      -- blank to fill in, as for an office's first licensee.
      v_source := 'invite';
      v_start := null;
    elsif exists (select 1 from public.licensee_in_charge_history h where h.agency_id = new.agency_id) then
      v_source := 'team';
      v_start := v_today;
    else
      -- An office's first licensee in charge, at sign-up: since when isn't
      -- known here, so it's left blank to fill in, like the backfill.
      v_source := 'first';
      v_start := null;
    end if;
    insert into public.licensee_in_charge_history
      (agency_id, profile_id, licensee_name, licence_type, licence_number, source, started_on, fair_trading_told_on)
    values
      (new.agency_id, new.id, coalesce(nullif(btrim(new.full_name), ''), new.email, 'Licensee in charge'),
       new.licence_type, nullif(btrim(new.licence_number), ''), v_source, v_start, v_ft);
  else
    if v_ctx is not null and v_ctx ->> 'old_profile' = new.id::text then
      v_end := (v_ctx ->> 'took_effect')::date - 1;
    else
      v_end := v_today - 1;
    end if;
    update public.licensee_in_charge_history h
       set ended_on = greatest(v_end, h.started_on)
     where h.agency_id = new.agency_id and h.profile_id = new.id and h.ended_at is null;
  end if;
  return null;
end
$$;

-- ── 3. The licensee's name and email: the licensee only ───────────────

-- The licensee in charge, or the agent on their own plan, who is the
-- licensee for their own account (0058). Not an office manager, and not the
-- person who set the office up (Adam, 26 Oct 2026).
create or replace function public.may_change_licensee_details()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_agency_id() is not null and public.acts_as_licensee();
$$;
revoke execute on function public.may_change_licensee_details() from public, anon;
grant execute on function public.may_change_licensee_details() to authenticated;

create or replace function public.set_agency_licensee(p_name text, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.may_change_licensee_details() then
    raise exception 'Only the licensee in charge can change the licensee''s details.';
  end if;
  update public.agencies
     set licensee_name = nullif(btrim(p_name), ''),
         licensee_email = nullif(btrim(p_email), '')
   where id = public.current_agency_id();
end
$$;

create or replace function public.set_agency_licensee_email(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.may_change_licensee_details() then
    raise exception 'Only the licensee in charge can change the licensee''s email.';
  end if;
  update public.agencies
     set licensee_email = nullif(btrim(p_email), '')
   where id = public.current_agency_id();
end
$$;

-- As 0093, with the licensee's details on the licensee-only check.
create or replace function public.guard_agency_licensee_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') or auth.uid() is null or public.is_platform_admin() then
    return new;
  end if;
  if (new.licensee_name is distinct from old.licensee_name
      or new.licensee_email is distinct from old.licensee_email)
     and not public.may_change_licensee_details() then
    raise exception 'Only the licensee in charge can change the licensee''s details.'
      using errcode = 'check_violation';
  end if;
  if (new.aml_precommencement_enabled is distinct from old.aml_precommencement_enabled
      or new.complaint_resolution_target_days is distinct from old.complaint_resolution_target_days)
     and not public.acts_as_licensee() then
    raise exception 'Only the licensee in charge can change this.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

-- ── 4. Who may invite whom ──────────────────────────────────────────────

-- Runs as the person inviting, so the rules see who they are. The database's
-- own functions (accepting an invite) pass straight through.
create or replace function public.guard_agency_invite_roles()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_agency public.agencies;
  v_roles int;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- An invite says who and as what; to change either, cancel it and send
    -- a new one. Cancelling (status) still works.
    if new.agency_id is distinct from old.agency_id
       or new.email is distinct from old.email
       or new.full_name is distinct from old.full_name
       or new.token is distinct from old.token
       or new.invited_by is distinct from old.invited_by
       or new.is_licensee_in_charge is distinct from old.is_licensee_in_charge
       or new.is_assistant is distinct from old.is_assistant
       or new.is_office_manager is distinct from old.is_office_manager
       or new.is_property_manager is distinct from old.is_property_manager
       or new.office_manager_wording is distinct from old.office_manager_wording
       or new.office_manager_authorised_at is distinct from old.office_manager_authorised_at then
      raise exception 'An invite can''t be changed. Cancel it and send a new one.';
    end if;
    return new;
  end if;

  -- The person inviting is the one signed in, whatever the form said: an
  -- office manager invite is approved by them.
  new.invited_by := auth.uid();

  v_roles := new.is_licensee_in_charge::int + new.is_assistant::int
           + new.is_office_manager::int + new.is_property_manager::int;
  if v_roles > 1 then
    raise exception 'An invite is for one role.';
  end if;

  select * into v_agency from public.agencies where id = new.agency_id;

  if new.is_licensee_in_charge then
    if left(coalesce(v_agency.plan, ''), 6) = 'agent_' then
      raise exception 'On an agent plan, you are the licensee for your own account.';
    end if;
    if public.office_has_active_licensee() then
      raise exception 'Your office''s licensee in charge is already on RealComply. To hand over, use Change licensee in charge in Office profile.';
    end if;
    if nullif(btrim(v_agency.licensee_email), '') is null then
      raise exception 'There''s no licensee email in Office profile. Email admin@realcomply.com.au to add it.';
    end if;
    if public.licensee_email_is_a_member() then
      raise exception 'The licensee email in Office profile is the login of someone in your office. Email admin@realcomply.com.au to correct it.';
    end if;
    if exists (select 1 from public.agency_invites i
                where i.agency_id = new.agency_id and i.is_licensee_in_charge and i.status = 'pending') then
      raise exception 'There''s already an invite waiting for your licensee in charge. Cancel it to send a new one.';
    end if;
    -- Exactly as recorded in Office profile (Adam, 26 Oct 2026).
    new.email := lower(btrim(v_agency.licensee_email));
    new.full_name := nullif(btrim(v_agency.licensee_name), '');
  end if;

  if new.is_office_manager then
    if not public.is_licensee_in_charge() then
      raise exception 'Only the licensee in charge can invite an office manager.' using errcode = '42501';
    end if;
    if left(coalesce(v_agency.plan, ''), 6) = 'agent_' then
      raise exception 'There''s no office manager on an agent plan.';
    end if;
    if nullif(btrim(new.full_name), '') is null then
      raise exception 'Add their full name. It goes in the words you approve.';
    end if;
    new.full_name := btrim(new.full_name);
    new.office_manager_wording := public.office_manager_wording(new.full_name, v_agency.name);
    new.office_manager_authorised_at := now();
  else
    new.office_manager_wording := null;
    new.office_manager_authorised_at := null;
  end if;

  if new.is_property_manager and not coalesce(v_agency.pm_enabled, false) then
    raise exception 'Property management isn''t on your plan.';
  end if;

  return new;
end
$$;

drop trigger if exists agency_invites_guard_roles on public.agency_invites;
create trigger agency_invites_guard_roles
  before insert or update on public.agency_invites
  for each row execute function public.guard_agency_invite_roles();

-- Who may send and cancel invites. As 0093, except that an office manager
-- may now invite (and cancel the invite of) the licensee in charge while the
-- office has none on RealComply. Which licensee, and at what address, the
-- guard above decides. (REVERSAL, Adam, 26 Oct 2026: see the top of this file.)
drop policy if exists "agency_invites: licensee can insert" on public.agency_invites;
create policy "agency_invites: licensee can insert" on public.agency_invites
  for insert with check (
    agency_id = public.current_agency_id()
    and (public.is_licensee_in_charge()
         or (public.is_office_manager()
             and (not is_licensee_in_charge or not public.office_has_active_licensee()))));

drop policy if exists "agency_invites: licensee can update" on public.agency_invites;
create policy "agency_invites: licensee can update" on public.agency_invites
  for update using (
    agency_id = public.current_agency_id()
    and (public.is_licensee_in_charge()
         or (public.is_office_manager()
             and (not is_licensee_in_charge or not public.office_has_active_licensee()))));

-- ── 5. Joining ─────────────────────────────────────────────────────────

create or replace function public.accept_invite(p_token uuid, p_full_name text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.agency_invites;
  v_agency public.agencies;
  v_user_email text;
  v_profile public.profiles;
  v_agent uuid;
  v_as_licensee boolean;
  v_inviter public.profiles;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'profile already exists for this user';
  end if;

  select * into v_invite from public.agency_invites where token = p_token;
  if v_invite is null then
    raise exception 'invite not found';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'this invite has already been used or was revoked';
  end if;

  select email into v_user_email from auth.users where id = auth.uid();
  if lower(v_user_email) <> lower(v_invite.email) then
    raise exception 'this invite was sent to a different email address';
  end if;

  select * into v_agency from public.agencies where id = v_invite.agency_id;

  -- Licensee in charge only while the office still has none on RealComply,
  -- and only for the address still recorded in Office profile (0095).
  -- Otherwise they join as an agent.
  v_as_licensee := v_invite.is_licensee_in_charge
    and left(coalesce(v_agency.plan, ''), 6) <> 'agent_'
    and lower(btrim(coalesce(v_agency.licensee_email, ''))) = lower(btrim(v_user_email))
    and not exists (select 1 from public.profiles p
                     where p.agency_id = v_invite.agency_id
                       and p.is_licensee_in_charge and p.archived_at is null);
  if v_as_licensee then
    perform set_config('realcomply.licensee_change',
                       jsonb_build_object('invite_profile', auth.uid())::text, true);
  end if;

  insert into public.profiles
    (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant,
     is_property_manager, licence_categories)
    values (
      auth.uid(),
      v_invite.agency_id,
      coalesce(nullif(trim(p_full_name), ''), v_invite.full_name),
      v_user_email,
      -- An assistant is not an agent. is_agent drives "whose listings are
      -- these" throughout the app, and an assistant does not have their own.
      not v_invite.is_assistant,
      v_as_licensee,
      v_invite.is_assistant,
      v_invite.is_property_manager,
      -- A property manager's licence category starts as residential property
      -- management, which sets their CPD; they can change it (0095).
      case when v_invite.is_property_manager then array['residential_property_management'] else '{}'::text[] end
    )
    returning * into v_profile;

  if v_as_licensee then
    perform set_config('realcomply.licensee_change', '', true);
  end if;

  if v_invite.is_assistant then
    foreach v_agent in array v_invite.supports_agent_ids loop
      insert into public.assistant_agents (agency_id, assistant_id, agent_id, created_by)
        values (v_invite.agency_id, auth.uid(), v_agent, v_invite.invited_by)
        on conflict (assistant_id, agent_id) do nothing;
    end loop;
  end if;

  -- Office manager, approved on the invite by the licensee in charge (0095),
  -- if they're still the licensee in charge. Recorded as in Team.
  if v_invite.is_office_manager and v_invite.office_manager_wording is not null
     and left(coalesce(v_agency.plan, ''), 6) <> 'agent_' then
    select * into v_inviter from public.profiles
     where id = v_invite.invited_by and agency_id = v_invite.agency_id
       and is_licensee_in_charge and archived_at is null;
    if v_inviter.id is not null then
      insert into public.office_managers
        (agency_id, profile_id, wording, approved_via, approved_by, approved_by_name, approved_at)
      values
        (v_invite.agency_id, auth.uid(), v_invite.office_manager_wording, 'team', v_inviter.id,
         coalesce(nullif(btrim(v_inviter.full_name), ''), v_inviter.email),
         coalesce(v_invite.office_manager_authorised_at, now()));
    end if;
  end if;

  update public.agency_invites
    set status = 'accepted', accepted_at = now()
    where id = v_invite.id;

  return v_profile;
end;
$$;
revoke execute on function public.accept_invite(uuid, text) from public, anon;
grant execute on function public.accept_invite(uuid, text) to authenticated;

-- A licensee in charge invite still waiting is done with once the office has
-- a licensee in charge on RealComply, however they got there.
create or replace function public.revoke_licensee_invites_once_filled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_licensee_in_charge and new.archived_at is null then
    update public.agency_invites
       set status = 'revoked'
     where agency_id = new.agency_id and is_licensee_in_charge and status = 'pending'
       and lower(email) <> lower(coalesce(new.email, ''));
  end if;
  return null;
end
$$;
revoke execute on function public.revoke_licensee_invites_once_filled() from public, anon, authenticated;

drop trigger if exists profiles_revoke_licensee_invites on public.profiles;
create trigger profiles_revoke_licensee_invites
  after insert or update of is_licensee_in_charge, archived_at on public.profiles
  for each row execute function public.revoke_licensee_invites_once_filled();

-- What the sign-up page says they're joining as: agent, assistant,
-- licensee_in_charge, office_manager or property_manager. Nothing for an
-- unknown, used or cancelled invite.
create or replace function public.invite_role(p_token uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when i.is_licensee_in_charge then 'licensee_in_charge'
           when i.is_assistant then 'assistant'
           when i.is_office_manager then 'office_manager'
           when i.is_property_manager then 'property_manager'
           else 'agent'
         end
    from public.agency_invites i
   where i.token = p_token and i.status = 'pending';
$$;
revoke execute on function public.invite_role(uuid) from public;
grant execute on function public.invite_role(uuid) to anon, authenticated;

-- ── 6. Property manager is a role: the same people may change it ───────

-- As 0093, with is_property_manager among the roles.
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_caller_is_licensee boolean;
begin
  -- Only direct calls from the app's users are checked. Database functions
  -- that run with higher rights, and the service role, pass through.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.agency_id is distinct from old.agency_id
     or new.is_platform_admin is distinct from old.is_platform_admin then
    raise exception 'This change is not allowed.';
  end if;

  if new.is_licensee_in_charge is distinct from old.is_licensee_in_charge
     or new.is_assistant is distinct from old.is_assistant
     or new.is_agent is distinct from old.is_agent
     or new.is_property_manager is distinct from old.is_property_manager
     or new.archived_at is distinct from old.archived_at
     or new.archived_by is distinct from old.archived_by then
    select coalesce(bool_or(me.is_licensee_in_charge), false)
      into v_caller_is_licensee
      from public.profiles me
     where me.id = auth.uid()
       and me.agency_id = old.agency_id
       and me.archived_at is null;
    if not v_caller_is_licensee then
      -- 0093: an office manager, for anyone but a licensee in charge, and
      -- never the licensee in charge flag itself.
      if not public.is_office_manager()
         or new.is_licensee_in_charge is distinct from old.is_licensee_in_charge
         or old.is_licensee_in_charge then
        raise exception 'Only the licensee in charge can change roles.';
      end if;
    end if;
  end if;

  return new;
end
$$;

-- ── Check: stops with a message if anything above is missing ───────────
do $$
begin
  if not has_column_privilege('authenticated', 'public.agency_invites', 'is_office_manager', 'INSERT')
     or not has_column_privilege('authenticated', 'public.agency_invites', 'is_property_manager', 'SELECT')
     or not has_column_privilege('authenticated', 'public.profiles', 'is_property_manager', 'SELECT') then
    raise exception 'Check failed: the new columns aren''t granted to signed-in users.';
  end if;
  if position('may_change_licensee_details' in pg_get_functiondef('public.set_agency_licensee(text,text)'::regprocedure)) = 0
     or position('may_change_licensee_details' in pg_get_functiondef('public.set_agency_licensee_email(text)'::regprocedure)) = 0
     or position('may_change_licensee_details' in pg_get_functiondef('public.guard_agency_licensee_columns()'::regprocedure)) = 0 then
    raise exception 'Check failed: a licensee details rule still allows more than the licensee.';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'agency_invites_guard_roles') then
    raise exception 'Check failed: the invite rules aren''t on.';
  end if;
end
$$;

-- What it shows when it has run: true, true, true, true.
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'agency_invites' and column_name = 'is_office_manager')
  and exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_property_manager')
    as roles_ready,
  exists (select 1 from pg_trigger where tgname = 'agency_invites_guard_roles') as invite_rules_on,
  position('may_change_licensee_details' in pg_get_functiondef('public.set_agency_licensee(text,text)'::regprocedure)) > 0
    as licensee_details_licensee_only,
  position('invite_profile' in pg_get_functiondef('public.log_licensee_in_charge()'::regprocedure)) > 0
    as history_knows_invites;
