-- ===== RUN THIS ONE. Migration 0069, the agent welcome and the Supervision Guidelines read-and-tick, 14 October 2026 =====
--
-- Brief of 14 Oct 2026 (Adam). Three things:
--
--   1. agent_welcome_emails: the agent welcome email, sent once to each agent
--      when their account set-up is complete (early access and personally
--      invited agents on their own plan, and agents invited by their office).
--      One row per person, claimed by inserting it before the email goes; a
--      send that fails gives the claim back. Records who, which office, which
--      kind and when it was sent.
--   2. sg_read_confirmations: an agent in an office ticks "I've read the
--      RealComply annexure and my office's Supervision Guidelines". One row per
--      agent per annexure version; a double click saves once. The agent and the
--      licensee in charge can see it. It is in Download all records and the
--      7-year activity record.
--   3. office_annexure_adoption(): what an agent in an office may know about
--      the annexure their licensee adopted (version, the licensee's name, the
--      date), for the read-only annexure page, the Home card and the welcome
--      email. The adoption record itself stays the licensee's (0068).
--
-- Every new table has the grants block. Nothing on live to change: no rows
-- are added by this file. Safe to run more than once.

begin;

-- Order check: 0067, 0068 and the activity record chain first.
do $$
begin
  if to_regclass('public.sg_annexure_adoptions') is null
     or to_regprocedure('public.sg_annexure_links_office_plans_only()') is null then
    raise exception 'Run 0067 and 0068 (the SG annexure) before this one. Nothing was changed.';
  end if;
  if to_regprocedure('public.build_activity_record_0058(uuid)') is null
     or to_regprocedure('public.guard_agency_not_ended()') is null then
    raise exception 'The activity record or the not-ended guard is missing. Nothing was changed.';
  end if;
end $$;

-- ── 1. The agent welcome email ──────────────────────────────────────────
create table if not exists public.agent_welcome_emails (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  kind text not null check (kind in ('own_plan', 'office')),
  sent_at timestamptz not null default now()
);

comment on table public.agent_welcome_emails is
  'The agent welcome email (0069): who, which office, own plan or invited by their office, and when it was sent. One per person.';

alter table public.agent_welcome_emails enable row level security;
-- No policy: written by the server and by the two functions below.

-- An agent invited into an office claims their own welcome, once, after
-- accepting the invite. Not the licensee in charge, not an assistant, and not
-- on an agent plan (an agent on their own plan is welcomed when their trial
-- starts, by the server). True when this call claimed it.
create or replace function public.claim_office_agent_welcome()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
begin
  if v_agency is null then
    return false;
  end if;
  if not exists (
    select 1 from public.profiles p join public.agencies a on a.id = p.agency_id
     where p.id = auth.uid() and p.agency_id = v_agency and p.archived_at is null
       and p.is_agent and not p.is_licensee_in_charge and not p.is_assistant
       and left(coalesce(a.plan, ''), 6) <> 'agent_') then
    return false;
  end if;
  insert into public.agent_welcome_emails (profile_id, agency_id, kind)
  values (auth.uid(), v_agency, 'office')
  on conflict (profile_id) do nothing;
  return found;
end
$$;

-- The email did not go: give the claim back, so it is not recorded as sent.
-- Only a claim made in the last ten minutes, so a welcome that did go stays
-- on the record.
create or replace function public.release_office_agent_welcome()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.agent_welcome_emails
   where profile_id = auth.uid() and kind = 'office' and sent_at > now() - interval '10 minutes';
$$;

revoke execute on function public.claim_office_agent_welcome() from public, anon;
grant execute on function public.claim_office_agent_welcome() to authenticated;
revoke execute on function public.release_office_agent_welcome() from public, anon;
grant execute on function public.release_office_agent_welcome() to authenticated;

-- ── 2. Read the annexure and the Supervision Guidelines ─────────────────
create table if not exists public.sg_read_confirmations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  confirmed_by uuid references public.profiles(id) on delete set null,
  annexure_version text not null check (annexure_version ~ '^[0-9]+\.[0-9]+$'),
  confirmed_at timestamptz not null default now(),
  constraint sg_read_confirmations_once unique (agency_id, confirmed_by, annexure_version)
);

comment on table public.sg_read_confirmations is
  'An agent in an office confirming they have read the RealComply annexure (the version their licensee adopted) and the office''s Supervision Guidelines (0069). Agent, version and when. Nothing else.';

alter table public.sg_read_confirmations enable row level security;

-- The agent sees their own; the licensee in charge sees the office's. Nobody
-- signed in writes them: confirm_sg_read() below does.
drop policy if exists "sg_read_confirmations: own or licensee can view" on public.sg_read_confirmations;
create policy "sg_read_confirmations: own or licensee can view" on public.sg_read_confirmations
  for select using (
    agency_id = public.current_agency_id()
    and (confirmed_by = auth.uid() or public.is_office_licensee())
  );

-- An agent in an office ticks the box. Records the version their office
-- adopted, once: a second call (a double click) returns the same row.
create or replace function public.confirm_sg_read()
returns table (confirmation_id uuid, confirmed_version text, confirmed_when timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_version text;
begin
  if v_agency is null then
    raise exception 'Only an agent in an office confirms this.';
  end if;
  if not exists (
    select 1 from public.profiles p join public.agencies a on a.id = p.agency_id
     where p.id = auth.uid() and p.agency_id = v_agency and p.archived_at is null
       and p.is_agent and not p.is_licensee_in_charge and not p.is_assistant
       and left(coalesce(a.plan, ''), 6) <> 'agent_') then
    raise exception 'Only an agent in an office confirms this.';
  end if;
  select ad.annexure_version into v_version
    from public.sg_annexure_adoptions ad
   where ad.agency_id = v_agency
   order by ad.signed_at desc
   limit 1;
  if v_version is null then
    raise exception 'Your office has not adopted the annexure yet.';
  end if;
  insert into public.sg_read_confirmations (agency_id, confirmed_by, annexure_version)
  values (v_agency, auth.uid(), v_version)
  on conflict on constraint sg_read_confirmations_once do nothing;
  return query
    select c.id, c.annexure_version, c.confirmed_at
      from public.sg_read_confirmations c
     where c.agency_id = v_agency and c.confirmed_by = auth.uid() and c.annexure_version = v_version;
end
$$;
revoke execute on function public.confirm_sg_read() from public, anon;
grant execute on function public.confirm_sg_read() to authenticated;

-- ── 3. What an agent in an office may know of the adoption ──────────────
-- The version, the licensee's name as they signed it, and when. Not the
-- licence number, the email the link went to, or the signed copy.
create or replace function public.office_annexure_adoption()
returns table (annexure_version text, adopted_by_name text, adopted_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select ad.annexure_version, ad.signed_name, ad.signed_at
    from public.sg_annexure_adoptions ad
    join public.agencies a on a.id = ad.agency_id
   where ad.agency_id = public.current_agency_id()
     and left(coalesce(a.plan, ''), 6) <> 'agent_'
   order by ad.signed_at desc
   limit 1;
$$;
revoke execute on function public.office_annexure_adoption() from public, anon;
grant execute on function public.office_annexure_adoption() to authenticated;

-- ── Data API grants: every new table states who may read it ─────────────
revoke all on public.agent_welcome_emails, public.sg_read_confirmations from anon, authenticated;
grant select on public.sg_read_confirmations to authenticated;
grant all on public.agent_welcome_emails, public.sg_read_confirmations to service_role;

-- ── Not once the subscription has ended ─────────────────────────────────
drop trigger if exists agent_welcome_emails_not_ended_guard on public.agent_welcome_emails;
create trigger agent_welcome_emails_not_ended_guard
  before insert or update or delete on public.agent_welcome_emails
  for each row execute function public.guard_agency_not_ended();
drop trigger if exists sg_read_confirmations_not_ended_guard on public.sg_read_confirmations;
create trigger sg_read_confirmations_not_ended_guard
  before insert or update or delete on public.sg_read_confirmations
  for each row execute function public.guard_agency_not_ended();

-- ── 4. The 7-year activity record ───────────────────────────────────────
-- build_activity_record is 0066's, word for word, plus (0069) who confirmed
-- reading the annexure and the Supervision Guidelines, which version, and
-- when. Identifiers and dates only, never names.
create or replace function public.build_activity_record(p_agency_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.build_activity_record_0058(p_agency_id) || jsonb_build_object(
    'send_backs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'listing', s.property_id, 'by', s.sent_back_by,
        'via', case when s.sent_back_by is null then 'link' else 'app' end,
        'at', s.sent_back_at,
        'cards', coalesce((select jsonb_agg(jsonb_build_object(
            'card', i.item_key, 'may_be_breach', i.may_be_breach,
            'cleared_by', i.cleared_by, 'cleared_at', i.cleared_at) order by i.item_key)
          from public.listing_send_back_items i where i.send_back_id = s.id), '[]'))
        order by s.sent_back_at)
      from public.listing_send_backs s where s.agency_id = p_agency_id), '[]'),
    'superseded_agent_signatures', coalesce((select jsonb_agg(jsonb_build_object(
        'listing', g.property_id, 'signer', g.signed_by, 'signed_at', g.signed_at,
        'superseded_at', g.superseded_at, 'send_back', g.send_back_id) order by g.superseded_at)
      from public.superseded_agent_signatures g where g.agency_id = p_agency_id), '[]'),
    'licensee_contact_changes', coalesce((select jsonb_agg(jsonb_build_object(
        'by', c.changed_by, 'at', c.changed_at) order by c.changed_at)
      from public.licensee_contact_changes c where c.agency_id = p_agency_id), '[]'),
    'sg_read_confirmations', coalesce((select jsonb_agg(jsonb_build_object(
        'by', r.confirmed_by, 'version', r.annexure_version, 'at', r.confirmed_at) order by r.confirmed_at)
      from public.sg_read_confirmations r where r.agency_id = p_agency_id), '[]'));
$$;
revoke execute on function public.build_activity_record_core(uuid) from public, anon, authenticated;
revoke execute on function public.build_activity_record(uuid) from public, anon, authenticated;
grant execute on function public.build_activity_record(uuid) to service_role;

commit;

-- Check: one row, every column true.
select
  to_regclass('public.agent_welcome_emails') is not null as welcome_record,
  to_regclass('public.sg_read_confirmations') is not null as read_confirmations,
  to_regprocedure('public.confirm_sg_read()') is not null as confirm_function,
  to_regprocedure('public.office_annexure_adoption()') is not null as adoption_for_agents,
  position('sg_read_confirmations' in pg_get_functiondef('public.build_activity_record(uuid)'::regprocedure)) > 0
    as in_activity_record;
