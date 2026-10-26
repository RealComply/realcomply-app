-- ===== 0093: Office manager, approved by the licensee in charge =====
--
-- REVERSAL (Adam, 26 Oct 2026, addendum to the office plan job). 0092 let
-- the person who signed up run an office plan the way an agent on their own
-- plan does, whenever they answered "No, someone else" to "Are you the
-- licensee in charge?". Now they do NOT get the office side automatically.
--
--   Was (0092): the person who signed up acted as the licensee, on the
--        strength of their own sign-up answer.
--   Now: an Office manager role, granted only with the licensee's approval.
--        * Same office side as the licensee: Team, Office profile,
--          registers, CPD, training, trust records, the SG Manual, billing.
--        * Stays with the licensee only: price statement approvals, file
--          sign-offs, annexure adoption, changing the licensee in charge,
--          deleting compliance records.
--        * The licensee approves by email link when they have no login
--          ("I authorise [name] to manage [office]'s RealComply account as
--          office manager."), or from Team when they do. Who, when and the
--          wording are recorded. The licensee can withdraw it at any time,
--          by link or in Team.
--
-- Not decided yet, so left with the licensee: every listing in the office
-- (Office overview) and the complaints register. An office manager sees
-- their own listings, like any agent.
--
-- HOW
--   1. 0092 undone: its ten functions go back to exactly how they were
--      before it (taken from a database built with every migration up to
--      0091), and its marker, triggers and test function are removed. The
--      two live offices it marked go back to how they were.
--   2. Two tables: office_managers (the record: who, approved by whom, how,
--      when, the wording, and any withdrawal) and office_manager_requests
--      (the email link to a licensee with no login). Each with its grants.
--   3. is_office_manager() and runs_office(). runs_office() is the office
--      side: the licensee (acts_as_licensee(), unchanged) or an office
--      manager. Everything licensee-only keeps asking acts_as_licensee().
--   4. The office-side rules, one by one, include an office manager (53
--      rules, listed below, generated from the live definitions and read
--      line by line). Every "can delete" rule for a record, the complaints
--      register, the annexure, sign-offs and signatures are NOT on that
--      list. (Taking an assistant off an agent is Team, so it is.)
--   5. Office profile: the trading name, licensed entity name, listings page
--      and logo, for an office manager too. Guards: an office manager can't
--      change the licensee's name or email, the AML setting or the
--      complaints target; can't invite or appoint a licensee in charge; can't
--      change the licensee in charge's own record.
--   6. Leaving the office ends the role.
--   7. DECIDED (Adam, 26 Oct): an office plan's listing lock also lifts on
--      the licensee's signed adoption page, as on an agent plan (Raine &
--      Horne Queanbeyan, whose licensee signed one on 21 Oct).
--   8. Reminders: the licensee or an office manager emails staff who still
--      need to sign the SG Manual or read and tick the Supervision
--      Guidelines (Adam, 26 Oct). A new table records each one.
--
-- Three new tables, each with its grants in this file. Safe to run twice.

-- ── 1. 0092 undone ──────────────────────────────────────────────────────
-- The ten functions, exactly as before 0092.
-- acts_as_licensee
CREATE OR REPLACE FUNCTION public.acts_as_licensee()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select me.is_licensee_in_charge or (left(a.plan, 6) = 'agent_' and not me.is_assistant)
      from public.profiles me
      join public.agencies a on a.id = me.agency_id
     where me.id = auth.uid() and me.archived_at is null), false);
$function$
;
-- annexure_download_details
CREATE OR REPLACE FUNCTION public.annexure_download_details(p_token uuid)
 RETURNS TABLE(trading_name text, licensed_entity_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.name, a.licensed_entity_name
    from public.agencies a
   where a.annexure_download_token = p_token
     and left(coalesce(a.plan, ''), 6) = 'agent_'
     and a.ended_at is null;
$function$
;
-- bootstrap_agency_v3
CREATE OR REPLACE FUNCTION public.bootstrap_agency_v3(p_agency_name text, p_full_name text, p_is_licensee boolean, p_founder_token text DEFAULT NULL::text)
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_agency_id uuid;
  v_profile public.profiles;
  v_claimed text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'profile already exists for this user';
  end if;

  if p_founder_token is not null and length(trim(p_founder_token)) > 0 then
    -- THE CLAIM IS THE CHECK. Every condition lives in the WHERE clause, and
    -- only an update that actually changed a row may continue. See the note at
    -- the top of this file for why this is not written as look-up-then-use.
    update public.founder_invites
       set accepted_at = now(),
           accepted_by = auth.uid()
     where token = trim(p_founder_token)
       and accepted_at is null
       and expires_at > now()
    returning token into v_claimed;

    if v_claimed is null then
      raise exception 'that invite link is not valid';
    end if;

  elsif not public.signups_open() then
    -- No token and the door is shut. Same refusal as v2.
    raise exception 'new agencies are not being accepted';
  end if;

  insert into public.agencies (name) values (p_agency_name)
    returning id into v_agency_id;

  -- Identical to v2: is_agent stays true either way, and the licensee answer is
  -- taken from what they actually said rather than assumed (see 0029).
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge)
    values (
      auth.uid(),
      v_agency_id,
      p_full_name,
      (select email from auth.users where id = auth.uid()),
      true,
      coalesce(p_is_licensee, false)
    )
    returning * into v_profile;

  -- Which agency the invite produced, so a tester's account can be found later
  -- from the code that let them in.
  if v_claimed is not null then
    update public.founder_invites
       set agency_id = v_agency_id
     where token = v_claimed;
  end if;

  return v_profile;
end;
$function$
;
-- claim_office_agent_welcome
CREATE OR REPLACE FUNCTION public.claim_office_agent_welcome()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
-- confirm_sg_read
CREATE OR REPLACE FUNCTION public.confirm_sg_read()
 RETURNS TABLE(confirmation_id uuid, confirmed_version text, confirmed_when timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
-- listing_gate_reason
CREATE OR REPLACE FUNCTION public.listing_gate_reason(p_agency_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when a.id is null or not a.annexure_gate then null
    -- CHANGE (Adam, 23 Oct 2026): the first listing is free of the lock.
    -- Counts listings that still exist (archived too) and ones deleted.
    when not exists (select 1 from public.properties p where p.agency_id = a.id)
     and not exists (select 1 from public.deletion_log d
                      where d.agency_id = a.id and d.what = 'properties')
      then null
    when left(coalesce(a.plan, ''), 6) = 'agent_' then
      case when exists (select 1 from public.signoff_documents d
                         where d.agency_id = a.id and d.category = 'sg_annexure_licensee_signed')
           then null else 'signed_annexure' end
    else
      case when exists (select 1 from public.sg_annexure_adoptions ad
                         where ad.agency_id = a.id and ad.signed_at is not null)
           then null else 'annexure' end
  end
  from (select 1) one
  left join public.agencies a on a.id = p_agency_id;
$function$
;
-- office_annexure_adoption
CREATE OR REPLACE FUNCTION public.office_annexure_adoption()
 RETURNS TABLE(annexure_version text, adopted_by_name text, adopted_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ad.annexure_version, ad.signed_name, ad.signed_at
    from public.sg_annexure_adoptions ad
    join public.agencies a on a.id = ad.agency_id
   where ad.agency_id = public.current_agency_id()
     and left(coalesce(a.plan, ''), 6) <> 'agent_'
   order by ad.signed_at desc
   limit 1;
$function$
;
-- record_agent_acknowledgement
CREATE OR REPLACE FUNCTION public.record_agent_acknowledgement(p_agent_licence_number text, p_agency_name text, p_licensee_name text, p_licensee_licence_number text, p_typed_name text, p_wording_version text, p_wording jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me public.profiles;
  v_plan text;
  v_id uuid;
begin
  select * into v_me from public.profiles where id = auth.uid() and archived_at is null;
  if v_me.id is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select plan into v_plan from public.agencies where id = v_me.agency_id;
  -- The agent on their own plan; not someone assisting them.
  if left(coalesce(v_plan, ''), 6) <> 'agent_' or coalesce(v_me.is_assistant, false) then
    raise exception 'Only the agent on their own plan confirms this.' using errcode = '42501';
  end if;
  if nullif(btrim(p_agent_licence_number), '') is null
     or nullif(btrim(p_agency_name), '') is null
     or nullif(btrim(p_licensee_name), '') is null
     or nullif(btrim(p_licensee_licence_number), '') is null
     or nullif(btrim(p_typed_name), '') is null
     or nullif(btrim(p_wording_version), '') is null then
    raise exception 'Fill in every field.' using errcode = 'check_violation';
  end if;
  if p_wording is null or jsonb_typeof(p_wording) <> 'array' or jsonb_array_length(p_wording) <> 5 then
    raise exception 'Tick every box.' using errcode = 'check_violation';
  end if;

  insert into public.agent_acknowledgements (
    agency_id, profile_id, agent_licence_number, agency_name, licensee_name,
    licensee_licence_number, wording_version, wording, typed_name)
  values (
    v_me.agency_id, v_me.id, btrim(p_agent_licence_number), btrim(p_agency_name), btrim(p_licensee_name),
    btrim(p_licensee_licence_number), btrim(p_wording_version), p_wording, btrim(p_typed_name))
  on conflict on constraint agent_acknowledgements_once do nothing
  returning id into v_id;

  -- A second press (or a second tab) gets the first one back.
  if v_id is null then
    select id into v_id from public.agent_acknowledgements
     where agency_id = v_me.agency_id and profile_id = v_me.id;
  end if;
  return v_id;
end
$function$
;
-- record_signed_annexure_upload
CREATE OR REPLACE FUNCTION public.record_signed_annexure_upload(p_path text, p_file_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_agency uuid := public.current_agency_id();
  v_plan text;
  v_meta jsonb;
  v_id uuid;
begin
  if v_agency is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select plan into v_plan from public.agencies where id = v_agency;
  if left(coalesce(v_plan, ''), 6) <> 'agent_' or not public.acts_as_licensee() then
    raise exception 'Only the agent on their own plan uploads the signed annexure.' using errcode = '42501';
  end if;
  if p_path is null or split_part(p_path, '/', 1) <> v_agency::text or split_part(p_path, '/', 2) <> '_signoffs' then
    raise exception 'That file is not in your office''s folder.' using errcode = 'check_violation';
  end if;
  if nullif(btrim(p_file_name), '') is null or length(p_file_name) > 255 then
    raise exception 'The file needs a name.' using errcode = 'check_violation';
  end if;

  select o.metadata into v_meta
    from storage.objects o
   where o.bucket_id = 'compliance-evidence' and o.name = p_path;
  if v_meta is null then
    raise exception 'The file did not arrive. Try uploading it again.' using errcode = 'check_violation';
  end if;
  if coalesce(v_meta->>'mimetype', '') not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'Upload a PDF, JPG or PNG.' using errcode = 'check_violation';
  end if;
  if coalesce((v_meta->>'size')::bigint, 0) > 157286400 then
    raise exception 'The file is over 150 MB.' using errcode = 'check_violation';
  end if;

  insert into public.signoff_documents (
    agency_id, category, title, file_path, file_name, signed_file_path, signed_file_name, signer_scope, uploaded_by)
  values (
    v_agency, 'sg_annexure_licensee_signed', 'Signed SG annexure (licensee adoption)',
    p_path, btrim(p_file_name), p_path, btrim(p_file_name), 'licensee_only', auth.uid())
  returning id into v_id;
  return v_id;
end
$function$
;
-- sg_annexure_links_office_plans_only
CREATE OR REPLACE FUNCTION public.sg_annexure_links_office_plans_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (select 1 from public.agencies a
              where a.id = new.agency_id and left(coalesce(a.plan, ''), 6) = 'agent_') then
    raise exception 'The annexure is not sent for an agent on their own plan.';
  end if;
  return new;
end
$function$
;

-- 0092's marker, and what set, cleared and guarded it.
drop trigger if exists profiles_clear_licensee_not_on_realcomply on public.profiles;
drop trigger if exists agencies_guard_licensee_not_on_realcomply on public.agencies;
drop function if exists public.clear_licensee_not_on_realcomply();
drop function if exists public.guard_agency_licensee_not_on_realcomply();
drop function if exists public.works_as_agent_plan(text, boolean);
alter table public.agencies drop column if exists licensee_not_on_realcomply;

-- ── 2. The record and the email link ────────────────────────────────────
-- New tables, so the grants block (from 30 Oct 2026 Supabase stops granting
-- new tables to the API roles by default).

create table if not exists public.office_managers (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null references public.agencies (id) on delete cascade,
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  -- The exact words the licensee approved.
  wording           text not null,
  approved_via      text not null check (approved_via in ('team', 'email_link')),
  -- The licensee's login when approved in Team; null by email link.
  approved_by       uuid references public.profiles (id) on delete set null,
  -- The licensee's name: their profile name in Team, the name they typed by link.
  approved_by_name  text not null,
  approved_at       timestamptz not null default now(),
  request_id        uuid,
  -- Goes only in the confirmation email to a licensee who approved by link.
  -- Never readable by anyone signed in (see the grants).
  withdraw_token    uuid not null default gen_random_uuid() unique,
  withdrawn_at      timestamptz,
  withdrawn_via     text check (withdrawn_via in ('team', 'email_link', 'left_office')),
  withdrawn_by      uuid references public.profiles (id) on delete set null,
  withdrawn_by_name text,
  created_at        timestamptz not null default now()
);
comment on table public.office_managers is
  'Office managers and the licensee''s approval of each: who, approved by whom, how, when, the wording, and any withdrawal (0093, Adam 26 Oct 2026). A current office manager has withdrawn_at null.';
create unique index if not exists office_managers_one_current
  on public.office_managers (agency_id, profile_id) where withdrawn_at is null;
create index if not exists office_managers_agency_idx
  on public.office_managers (agency_id, approved_at);

alter table public.office_managers enable row level security;
-- Who the office manager is isn't private within the office. Written only
-- by the functions below.
drop policy if exists "office_managers: members can view" on public.office_managers;
create policy "office_managers: members can view" on public.office_managers
  for select to authenticated
  using (agency_id = public.current_agency_id());

revoke all on table public.office_managers from public, anon, authenticated;
grant select (id, agency_id, profile_id, wording, approved_via, approved_by, approved_by_name, approved_at,
              request_id, withdrawn_at, withdrawn_via, withdrawn_by, withdrawn_by_name, created_at)
  on public.office_managers to authenticated;
grant select, insert, update, delete on public.office_managers to service_role;

create table if not exists public.office_manager_requests (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies (id) on delete cascade,
  -- The person asking to be office manager.
  profile_id     uuid not null references public.profiles (id) on delete cascade,
  -- The licensee's credential. Never readable by anyone signed in, the
  -- person asking included: whoever holds it can approve.
  token          uuid not null default gen_random_uuid() unique,
  sent_to        text not null,
  licensee_name  text,
  wording        text not null,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default (now() + interval '30 days'),
  email_sent_at  timestamptz,
  email_attempts integer not null default 0,
  email_error    text,
  approved_at    timestamptz,
  approved_name  text,
  cancelled_at   timestamptz
);
comment on table public.office_manager_requests is
  'Requests to a licensee in charge with no login to approve someone as office manager, by email link (0093). Open while approved_at and cancelled_at are null and expires_at is ahead.';
create unique index if not exists office_manager_requests_one_open
  on public.office_manager_requests (agency_id, profile_id) where approved_at is null and cancelled_at is null;

alter table public.office_manager_requests enable row level security;
-- Its read rule asks runs_office(), so it is added in section 3.

revoke all on table public.office_manager_requests from public, anon, authenticated;
grant select (id, agency_id, profile_id, sent_to, licensee_name, wording, created_by, created_at, expires_at,
              email_sent_at, email_attempts, email_error, approved_at, approved_name, cancelled_at)
  on public.office_manager_requests to authenticated;
grant select, insert, update, delete on public.office_manager_requests to service_role;

-- ── 3. Who runs the office ─────────────────────────────────────────────

-- The words the licensee approves, built one way everywhere.
create or replace function public.office_manager_wording(p_person text, p_office text)
returns text
language sql
immutable
set search_path = public
as $$
  select 'I authorise ' || btrim(coalesce(p_person, '')) || ' to manage '
      || btrim(coalesce(p_office, '')) || '''s RealComply account as office manager.';
$$;

-- An office manager now: approved, not withdrawn, still in the office, and
-- an office plan (an agent on their own plan already runs their account).
create or replace function public.is_office_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.office_managers m
      join public.profiles me on me.id = m.profile_id and me.agency_id = m.agency_id
      join public.agencies a on a.id = m.agency_id
     where m.profile_id = auth.uid()
       and m.withdrawn_at is null
       and me.archived_at is null
       and left(coalesce(a.plan, ''), 6) <> 'agent_');
$$;

-- The office side: the licensee (or the agent on their own plan), or an
-- office manager. Licensee-only rules keep asking acts_as_licensee().
create or replace function public.runs_office()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.acts_as_licensee() or public.is_office_manager();
$$;

revoke execute on function public.office_manager_wording(text, text) from public, anon;
revoke execute on function public.is_office_manager() from public, anon;
revoke execute on function public.runs_office() from public, anon;
grant execute on function public.office_manager_wording(text, text) to authenticated, service_role;
grant execute on function public.is_office_manager() to authenticated, service_role;
grant execute on function public.runs_office() to authenticated, service_role;

drop policy if exists "office_manager_requests: own or office side can view" on public.office_manager_requests;
create policy "office_manager_requests: own or office side can view" on public.office_manager_requests
  for select to authenticated
  using (agency_id = public.current_agency_id() and (profile_id = auth.uid() or public.runs_office()));

-- Asking a licensee with no login, by email link. The person asking asks for
-- themselves. Refused when the office has a licensee in charge on RealComply
-- (they use Team), when there is no licensee email, or when that email is the
-- login of someone in the office (the same rule as price statement links:
-- nobody points the link at an inbox of their own). An open request still in
-- date is returned as it is, so pressing again resends the same link.
-- Returns the request id. The app reads the token with the service key to
-- send it; the person asking never sees it.
create or replace function public.request_office_manager()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me public.profiles;
  v_agency public.agencies;
  v_email text;
  v_id uuid;
begin
  select * into v_me from public.profiles where id = auth.uid() and archived_at is null;
  if v_me.id is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select * into v_agency from public.agencies where id = v_me.agency_id;
  if v_agency.ended_at is not null then
    raise exception 'This office''s subscription has ended.';
  end if;
  if left(coalesce(v_agency.plan, ''), 6) = 'agent_' then
    raise exception 'On your own plan, you already run your account.';
  end if;
  if v_me.is_licensee_in_charge then
    raise exception 'You''re the licensee in charge.';
  end if;
  if public.is_office_manager() then
    raise exception 'You''re already office manager.';
  end if;
  if public.office_has_active_licensee() then
    raise exception 'Your licensee in charge is on RealComply. Ask them to make you office manager in Team.';
  end if;
  v_email := lower(nullif(btrim(v_agency.licensee_email), ''));
  if v_email is null then
    raise exception 'There''s no email for your licensee in charge. Email admin@realcomply.com.au and we''ll add it.';
  end if;
  if public.licensee_email_is_a_member() then
    raise exception 'The licensee''s email on file is the login of someone in your office. It needs to be your licensee''s own email. Email admin@realcomply.com.au and we''ll correct it.';
  end if;

  -- An old request, out of date or to an address since changed, is closed.
  update public.office_manager_requests
     set cancelled_at = now()
   where agency_id = v_agency.id and profile_id = v_me.id
     and approved_at is null and cancelled_at is null
     and (expires_at <= now() or sent_to <> v_email);

  select id into v_id from public.office_manager_requests
   where agency_id = v_agency.id and profile_id = v_me.id
     and approved_at is null and cancelled_at is null;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.office_manager_requests (agency_id, profile_id, sent_to, licensee_name, wording, created_by)
  values (v_agency.id, v_me.id, v_email, nullif(btrim(v_agency.licensee_name), ''),
          public.office_manager_wording(coalesce(nullif(btrim(v_me.full_name), ''), v_me.email), v_agency.name),
          v_me.id)
  returning id into v_id;
  return v_id;
end
$$;

-- The person asking takes their request back.
create or replace function public.cancel_office_manager_request()
returns void
language sql
security definer
set search_path = public
as $$
  update public.office_manager_requests
     set cancelled_at = now()
   where profile_id = auth.uid() and agency_id = public.current_agency_id()
     and approved_at is null and cancelled_at is null;
$$;

-- Whether the email went, recorded honestly (as 0047 does for sign-off links).
create or replace function public.record_office_manager_request_email(p_request_id uuid, p_sent boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.office_manager_requests
     set email_attempts = email_attempts + 1,
         email_sent_at = case when p_sent then now() else email_sent_at end,
         email_error = case when p_sent then null else 'The email could not be sent. Try sending it again.' end
   where id = p_request_id and profile_id = auth.uid() and agency_id = public.current_agency_id();
$$;

revoke execute on function public.request_office_manager() from public, anon;
revoke execute on function public.cancel_office_manager_request() from public, anon;
revoke execute on function public.record_office_manager_request_email(uuid, boolean) from public, anon;
grant execute on function public.request_office_manager() to authenticated;
grant execute on function public.cancel_office_manager_request() to authenticated;
grant execute on function public.record_office_manager_request_email(uuid, boolean) to authenticated;

-- What the licensee's page shows. Nothing for a link that is used, taken
-- back, out of date, or whose person has left the office.
create or replace function public.office_manager_request_details(p_token uuid)
returns table (office_name text, person_name text, person_email text, licensee_name text, wording text, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select btrim(a.name), coalesce(nullif(btrim(p.full_name), ''), p.email), p.email, r.licensee_name, r.wording, r.expires_at
    from public.office_manager_requests r
    join public.agencies a on a.id = r.agency_id
    join public.profiles p on p.id = r.profile_id and p.agency_id = r.agency_id
   where r.token = p_token
     and r.approved_at is null and r.cancelled_at is null and r.expires_at > now()
     and p.archived_at is null and a.ended_at is null
     and left(coalesce(a.plan, ''), 6) <> 'agent_';
$$;

-- The licensee approves by link: their typed name, the wording as sent.
create or replace function public.approve_office_manager(p_token uuid, p_typed_name text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.office_manager_requests;
  v_name text := btrim(coalesce(p_typed_name, ''));
begin
  if v_name = '' or length(v_name) > 120 then
    return false;
  end if;
  select r.* into v_req
    from public.office_manager_requests r
    join public.agencies a on a.id = r.agency_id
    join public.profiles p on p.id = r.profile_id and p.agency_id = r.agency_id
   where r.token = p_token
     and r.approved_at is null and r.cancelled_at is null and r.expires_at > now()
     and p.archived_at is null and a.ended_at is null
     and left(coalesce(a.plan, ''), 6) <> 'agent_'
   for update of r;
  if v_req.id is null then
    return false;
  end if;
  update public.office_manager_requests
     set approved_at = now(), approved_name = v_name
   where id = v_req.id;
  insert into public.office_managers (agency_id, profile_id, wording, approved_via, approved_by_name, request_id)
  values (v_req.agency_id, v_req.profile_id, v_req.wording, 'email_link', v_name, v_req.id)
  on conflict (agency_id, profile_id) where withdrawn_at is null do nothing;
  return true;
end
$$;

-- The licensee in charge, in Team.
create or replace function public.grant_office_manager(p_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me public.profiles;
  v_them public.profiles;
  v_agency public.agencies;
  v_id uuid;
begin
  select * into v_me from public.profiles where id = auth.uid() and archived_at is null;
  if v_me.id is null or not v_me.is_licensee_in_charge then
    raise exception 'Only the licensee in charge can make someone office manager.' using errcode = '42501';
  end if;
  select * into v_agency from public.agencies where id = v_me.agency_id;
  if left(coalesce(v_agency.plan, ''), 6) = 'agent_' then
    raise exception 'Office managers are for office plans.';
  end if;
  select * into v_them from public.profiles
   where id = p_profile_id and agency_id = v_me.agency_id and archived_at is null;
  if v_them.id is null then
    raise exception 'That person isn''t in your office.';
  end if;
  if v_them.id = v_me.id or v_them.is_licensee_in_charge then
    raise exception 'A licensee in charge already runs the office.';
  end if;
  if exists (select 1 from public.office_managers
              where agency_id = v_me.agency_id and profile_id = v_them.id and withdrawn_at is null) then
    raise exception 'They''re already office manager.';
  end if;
  insert into public.office_managers (agency_id, profile_id, wording, approved_via, approved_by, approved_by_name)
  values (v_me.agency_id, v_them.id,
          public.office_manager_wording(coalesce(nullif(btrim(v_them.full_name), ''), v_them.email), v_agency.name),
          'team', v_me.id, coalesce(nullif(btrim(v_me.full_name), ''), v_me.email))
  returning id into v_id;
  -- Any link they asked for is no longer needed.
  update public.office_manager_requests
     set cancelled_at = now()
   where agency_id = v_me.agency_id and profile_id = v_them.id
     and approved_at is null and cancelled_at is null;
  return v_id;
end
$$;

-- The licensee in charge withdraws it, in Team.
create or replace function public.withdraw_office_manager(p_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me public.profiles;
begin
  select * into v_me from public.profiles where id = auth.uid() and archived_at is null;
  if v_me.id is null or not v_me.is_licensee_in_charge then
    raise exception 'Only the licensee in charge can withdraw it.' using errcode = '42501';
  end if;
  update public.office_managers
     set withdrawn_at = now(), withdrawn_via = 'team', withdrawn_by = v_me.id,
         withdrawn_by_name = coalesce(nullif(btrim(v_me.full_name), ''), v_me.email)
   where agency_id = v_me.agency_id and profile_id = p_profile_id and withdrawn_at is null;
  return found;
end
$$;

-- What the licensee's withdraw page shows.
create or replace function public.office_manager_withdraw_details(p_token uuid)
returns table (office_name text, person_name text, approved_by_name text, approved_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select btrim(a.name), coalesce(nullif(btrim(p.full_name), ''), p.email), m.approved_by_name, m.approved_at
    from public.office_managers m
    join public.agencies a on a.id = m.agency_id
    join public.profiles p on p.id = m.profile_id
   where m.withdraw_token = p_token and m.withdrawn_at is null;
$$;

-- The licensee withdraws it by the link in their confirmation email. Only
-- the button on the page calls this: opening the page changes nothing.
create or replace function public.withdraw_office_manager_by_token(p_token uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with done as (
    update public.office_managers
       set withdrawn_at = now(), withdrawn_via = 'email_link', withdrawn_by_name = approved_by_name
     where withdraw_token = p_token and withdrawn_at is null
    returning 1)
  select exists (select 1 from done);
$$;

revoke execute on function public.office_manager_request_details(uuid) from public;
revoke execute on function public.approve_office_manager(uuid, text) from public;
revoke execute on function public.grant_office_manager(uuid) from public, anon;
revoke execute on function public.withdraw_office_manager(uuid) from public, anon;
revoke execute on function public.office_manager_withdraw_details(uuid) from public;
revoke execute on function public.withdraw_office_manager_by_token(uuid) from public;
-- The two link pages are opened without a login, so anon as well.
grant execute on function public.office_manager_request_details(uuid) to anon, authenticated;
grant execute on function public.approve_office_manager(uuid, text) to anon, authenticated;
grant execute on function public.grant_office_manager(uuid) to authenticated;
grant execute on function public.withdraw_office_manager(uuid) to authenticated;
grant execute on function public.office_manager_withdraw_details(uuid) to anon, authenticated;
grant execute on function public.withdraw_office_manager_by_token(uuid) to anon, authenticated;

-- ── 4. The office side asks runs_office() ──────────────────────────────
-- Generated from the live definitions (checked identical, 26 Oct 2026):
-- each rule below is exactly as it was, with acts_as_licensee() replaced by
-- runs_office(), or "the caller is the licensee in charge" by "the licensee
-- in charge or an office manager". Listing files stay with can_see_property.
alter policy "agencies: licensee can update own agency" on public.agencies
  using (((id = current_agency_id()) AND runs_office()));
alter policy "agency_invites: licensee can view" on public.agency_invites
  using (((agency_id = current_agency_id()) AND runs_office()));
alter policy "assistant_agents: licensee or either person can view" on public.assistant_agents
  using (((agency_id = current_agency_id()) AND (runs_office() OR (assistant_id = auth.uid()) OR (agent_id = auth.uid()))));
alter policy "breaches: anyone can log their own" on public.breaches
  with check (((agency_id = current_agency_id()) AND (created_by = auth.uid()) AND (runs_office() OR (agent_id IS NULL) OR (agent_id = auth.uid()))));
alter policy "breaches: licensee or whoever logged it can view" on public.breaches
  using (((agency_id = current_agency_id()) AND (runs_office() OR (created_by = auth.uid()))));
alter policy "breaches: licensee or whoever logged it can update" on public.breaches
  using (((agency_id = current_agency_id()) AND (runs_office() OR (created_by = auth.uid())))) with check (((agency_id = current_agency_id()) AND (runs_office() OR (created_by = auth.uid()))));
alter policy "cpd_records: own or licensee can add" on public.cpd_records
  with check (((agency_id = current_agency_id()) AND (runs_office() OR (profile_id = auth.uid()))));
alter policy "cpd_records: own or licensee can view" on public.cpd_records
  using (((agency_id = current_agency_id()) AND (runs_office() OR (profile_id = auth.uid()))));
alter policy "cpd_records: own or licensee can update" on public.cpd_records
  using (((agency_id = current_agency_id()) AND (runs_office() OR (profile_id = auth.uid())))) with check (((agency_id = current_agency_id()) AND (runs_office() OR (profile_id = auth.uid()))));
alter policy "cpd_reminders: own or licensee can view" on public.cpd_reminders
  using (((agency_id = current_agency_id()) AND (runs_office() OR (profile_id = auth.uid()))));
alter policy "cpd_year_signoffs: own or licensee can add" on public.cpd_year_signoffs
  with check (((agency_id = current_agency_id()) AND (runs_office() OR (profile_id = auth.uid()))));
alter policy "cpd_year_signoffs: own or licensee can view" on public.cpd_year_signoffs
  using (((agency_id = current_agency_id()) AND (runs_office() OR (profile_id = auth.uid()))));
alter policy "gifts: anyone can log their own" on public.gifts
  with check (((agency_id = current_agency_id()) AND (created_by = auth.uid()) AND (runs_office() OR (profile_id = auth.uid()))));
alter policy "gifts: licensee or whoever logged it can view" on public.gifts
  using (((agency_id = current_agency_id()) AND (runs_office() OR (created_by = auth.uid()))));
alter policy "gifts: licensee can update" on public.gifts
  using (((agency_id = current_agency_id()) AND runs_office()));
alter policy "insurance history: licensee can view" on public.insurance_history
  using (((agency_id = current_agency_id()) AND runs_office()));
alter policy "insurance policies: licensee can add" on public.insurance_policies
  with check (((agency_id = current_agency_id()) AND runs_office()));
alter policy "insurance policies: licensee can view" on public.insurance_policies
  using (((agency_id = current_agency_id()) AND runs_office()));
alter policy "insurance policies: licensee can update" on public.insurance_policies
  using (((agency_id = current_agency_id()) AND runs_office())) with check (((agency_id = current_agency_id()) AND runs_office()));
alter policy "licence history: own or licensee can add" on public.licence_history
  with check (((agency_id = current_agency_id()) AND (runs_office() OR (profile_id = auth.uid()))));
alter policy "licence history: own or licensee can view" on public.licence_history
  using (((agency_id = current_agency_id()) AND (runs_office() OR (profile_id = auth.uid()))));
alter policy "licence_reminders: own or licensee can view" on public.licence_reminders
  using (((agency_id = current_agency_id()) AND (runs_office() OR (profile_id = auth.uid()))));
alter policy "compliance-evidence: whoever may file it can update" on storage.objects
  using (((bucket_id = 'compliance-evidence'::text) AND evidence_path_writable(name) AND (runs_office() OR (((storage.foldername(name))[2] = '_pending'::text) AND (COALESCE(owner_id, (owner)::text) = (auth.uid())::text))))) with check (((bucket_id = 'compliance-evidence'::text) AND evidence_path_writable(name)));
alter policy "profiles: self, licensee, or assistant pair can view" on public.profiles
  using (((agency_id = current_agency_id()) AND ((id = auth.uid()) OR runs_office() OR (is_assistant() AND (id IN ( SELECT visible_agent_ids() AS visible_agent_ids))) OR (id IN ( SELECT my_assistant_ids() AS my_assistant_ids)))));
alter policy "sg_manual_versions: licensee can add" on public.sg_manual_versions
  with check (((agency_id = current_agency_id()) AND runs_office()));
alter policy "signoff_documents: licensee can add" on public.signoff_documents
  with check (((agency_id = current_agency_id()) AND runs_office()));
alter policy "signoff_documents: licensee, uploader or signer can view" on public.signoff_documents
  using (((agency_id = current_agency_id()) AND (runs_office() OR (uploaded_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM signoff_signatures s
  WHERE ((s.document_id = signoff_documents.id) AND (s.signer_id = auth.uid())))))));
alter policy "signoff_signature_voids: licensee can view" on public.signoff_signature_voids
  using (((agency_id = current_agency_id()) AND runs_office()));
alter policy "signoff_signatures: licensee lists signers, signer signs own" on public.signoff_signatures
  with check (((agency_id = current_agency_id()) AND ((runs_office() AND (signed_at IS NULL) AND may_sign_signoff_document(document_id)) OR ((signer_id = auth.uid()) AND may_sign_signoff_document(document_id)))));
alter policy "signoff_signatures: licensee or signer can view" on public.signoff_signatures
  using (((agency_id = current_agency_id()) AND (runs_office() OR (signer_id = auth.uid()))));
alter policy "training_attendance: licensee can add" on public.training_attendance
  with check (((agency_id = current_agency_id()) AND runs_office()));
alter policy "training_attendance: own or licensee can view" on public.training_attendance
  using (((agency_id = current_agency_id()) AND (runs_office() OR (profile_id = auth.uid()))));
alter policy "training_plan_items: own plan or licensee can add" on public.training_plan_items
  with check (((agency_id = current_agency_id()) AND (EXISTS ( SELECT 1
   FROM training_plans tp
  WHERE ((tp.id = training_plan_items.plan_id) AND (runs_office() OR (tp.profile_id = auth.uid())))))));
alter policy "training_plan_items: own plan or licensee can view" on public.training_plan_items
  using (((agency_id = current_agency_id()) AND (EXISTS ( SELECT 1
   FROM training_plans tp
  WHERE ((tp.id = training_plan_items.plan_id) AND (runs_office() OR (tp.profile_id = auth.uid())))))));
alter policy "training_plan_items: own plan or licensee can update" on public.training_plan_items
  using (((agency_id = current_agency_id()) AND (EXISTS ( SELECT 1
   FROM training_plans tp
  WHERE ((tp.id = training_plan_items.plan_id) AND (runs_office() OR (tp.profile_id = auth.uid())))))));
alter policy "training_plans: own or licensee can add" on public.training_plans
  with check (((agency_id = current_agency_id()) AND (runs_office() OR (profile_id = auth.uid()))));
alter policy "training_plans: own or licensee can view" on public.training_plans
  using (((agency_id = current_agency_id()) AND (runs_office() OR (profile_id = auth.uid()))));
alter policy "training_plans: own or licensee can update" on public.training_plans
  using (((agency_id = current_agency_id()) AND (runs_office() OR (profile_id = auth.uid())))) with check (((agency_id = current_agency_id()) AND (runs_office() OR (profile_id = auth.uid()))));
alter policy "training_sessions: licensee can add" on public.training_sessions
  with check (((agency_id = current_agency_id()) AND runs_office()));
alter policy "training_sessions: licensee or attendee can view" on public.training_sessions
  using (((agency_id = current_agency_id()) AND (runs_office() OR (EXISTS ( SELECT 1
   FROM training_attendance t
  WHERE ((t.session_id = training_sessions.id) AND (t.profile_id = auth.uid())))))));
alter policy "training_sessions: licensee can update" on public.training_sessions
  using (((agency_id = current_agency_id()) AND runs_office()));
alter policy "trust_accounts: licensee can view" on public.trust_accounts
  using (((agency_id = current_agency_id()) AND runs_office()));
alter policy "trust_audits: licensee can view" on public.trust_audits
  using (((agency_id = current_agency_id()) AND runs_office()));
alter policy "trust_reminders: licensee can view" on public.trust_reminders
  using (((agency_id = current_agency_id()) AND runs_office()));
alter policy "assistant_agents: licensee can insert" on public.assistant_agents
  with check (((agency_id = current_agency_id()) AND (is_licensee_in_charge() OR is_office_manager())));
alter policy "assistant_agents: licensee can delete" on public.assistant_agents
  using (((agency_id = current_agency_id()) AND (is_licensee_in_charge() OR is_office_manager())));
alter policy "trust_accounts: licensee can insert" on public.trust_accounts
  with check (((agency_id = current_agency_id()) AND (is_licensee_in_charge() OR is_office_manager())));
alter policy "trust_accounts: licensee can update" on public.trust_accounts
  using (((agency_id = current_agency_id()) AND (is_licensee_in_charge() OR is_office_manager())));
alter policy "trust_audits: licensee can insert" on public.trust_audits
  with check (((agency_id = current_agency_id()) AND (is_licensee_in_charge() OR is_office_manager())));
alter policy "trust_audits: licensee can update" on public.trust_audits
  using (((agency_id = current_agency_id()) AND (is_licensee_in_charge() OR is_office_manager())));

-- Invites: an office manager invites agents and assistants, never a
-- licensee in charge, and can't change an invite that would make one.
alter policy "agency_invites: licensee can insert" on public.agency_invites
  with check (((agency_id = current_agency_id()) AND (is_licensee_in_charge() OR (is_office_manager() AND (NOT is_licensee_in_charge)))));
alter policy "agency_invites: licensee can update" on public.agency_invites
  using (((agency_id = current_agency_id()) AND (is_licensee_in_charge() OR (is_office_manager() AND (NOT is_licensee_in_charge)))));

-- People in the office: an office manager updates anyone but a licensee in
-- charge. Role changes are guarded below.
alter policy "profiles: licensee can update agency members" on public.profiles
  using (((agency_id = current_agency_id()) AND (is_licensee_in_charge() OR (is_office_manager() AND (NOT is_licensee_in_charge)))));

-- Files: an office manager reads and files the office's records, but a
-- listing's files only where they can see the listing (their own), as now
-- for any agent.
create or replace function public.evidence_path_readable(p_name text)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_seg text[] := storage.foldername(p_name);
begin
  if public.current_agency_id() is null or v_seg[1] is distinct from public.current_agency_id()::text then
    return false;
  end if;
  if public.acts_as_licensee() then
    return true;
  end if;
  if v_seg[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return public.can_see_property(v_seg[2]::uuid);
  end if;
  -- 0093: the office's own records, for an office manager.
  if public.is_office_manager() then
    return true;
  end if;
  if v_seg[2] in ('_licences', '_cpd') then
    return v_seg[3] = auth.uid()::text;
  end if;
  if v_seg[2] in ('_brand', '_sg-manual', '_pending') then
    return true;
  end if;
  if v_seg[2] = '_signoffs' then
    return exists (
      select 1 from public.signoff_documents d
       where d.agency_id = public.current_agency_id()
         and (d.file_path = p_name or d.signed_file_path = p_name)
         and (d.uploaded_by = auth.uid()
              or exists (select 1 from public.signoff_signatures s
                          where s.document_id = d.id and s.signer_id = auth.uid())));
  end if;
  return false;
end
$function$;

create or replace function public.evidence_path_writable(p_name text)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_seg text[] := storage.foldername(p_name);
begin
  if public.current_agency_id() is null or v_seg[1] is distinct from public.current_agency_id()::text then
    return false;
  end if;
  if public.acts_as_licensee() then
    return true;
  end if;
  if v_seg[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return public.can_see_property(v_seg[2]::uuid);
  end if;
  -- 0093: the office's own records, for an office manager.
  if public.is_office_manager() then
    return true;
  end if;
  if v_seg[2] in ('_licences', '_cpd') then
    return v_seg[3] = auth.uid()::text;
  end if;
  -- A new listing's files are staged here before the listing exists; a
  -- signer's stamped copy of a document they signed goes in _signoffs/signed.
  if v_seg[2] = '_pending' then
    return true;
  end if;
  if v_seg[2] = '_signoffs' and v_seg[3] = 'signed' then
    return true;
  end if;
  return false;
end
$function$;

-- Billing: an office manager too.
create or replace function public.set_agency_stripe_customer(p_customer_id text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_agency uuid := public.current_agency_id();
  v_existing text;
  v_subscription text;
begin
  if auth.uid() is null or v_agency is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  -- 0093: or an office manager.
  if not (public.runs_office() or public.is_account_holder()) then
    raise exception 'Only the licensee in charge or the account holder can set up billing for the agency.'
      using errcode = '42501';
  end if;

  if p_customer_id is null or p_customer_id !~ '^cus_[A-Za-z0-9]+$' then
    raise exception 'That is not a Stripe customer id.' using errcode = '22023';
  end if;

  -- Locked, so two people starting checkout at once write one after the other.
  select stripe_customer_id, stripe_subscription_id into v_existing, v_subscription
    from public.agencies
   where id = v_agency
   for update;

  -- One customer, one agency (10 Oct 2026): see above.
  if exists (select 1 from public.agencies other
              where other.stripe_customer_id = p_customer_id and other.id <> v_agency) then
    raise exception 'That Stripe customer belongs to another agency.' using errcode = '23505';
  end if;

  -- Once there is a subscription, its customer stays.
  if v_existing is not null and v_subscription is not null then
    return v_existing;
  end if;

  if v_existing is not distinct from p_customer_id then
    return v_existing;
  end if;

  perform set_config('realcomply.set_stripe_customer', 'on', true);
  update public.agencies set stripe_customer_id = p_customer_id where id = v_agency;
  perform set_config('realcomply.set_stripe_customer', 'off', true);

  return p_customer_id;
end
$function$;

-- Office profile: the trading name, the licensed entity name, the listings
-- page and the logo, for an office manager too. The licensee's own name and
-- email stay with may_change_agency_details() (the licensee, or the account
-- holder of an office with no licensee in charge, as since 0066).
create or replace function public.may_change_office_details()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.may_change_agency_details() or public.is_office_manager();
$$;
revoke execute on function public.may_change_office_details() from public, anon;
grant execute on function public.may_change_office_details() to authenticated, service_role;

-- The four setters, exactly as live apart from that check.
CREATE OR REPLACE FUNCTION public.set_agency_licensed_entity_name(p_name text, p_via text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
begin
  if not public.may_change_office_details() then
    raise exception 'Only the licensee in charge can change the licensed entity name.';
  end if;
  if p_via is null or p_via not in ('office_profile', 'corporation_licence', 'sign_up') then
    raise exception 'Say where the licensed entity name came from.';
  end if;
  if length(v_name) > 200 then
    raise exception 'That name is too long.';
  end if;
  perform set_config('realcomply.name_change_via', p_via, true);
  update public.agencies
     set licensed_entity_name = v_name,
         licensed_entity_name_source = case when v_name is null then null
                                            when p_via = 'corporation_licence' then 'licence'
                                            else 'typed' end
   where id = public.current_agency_id()
     and (licensed_entity_name is distinct from v_name
          or licensed_entity_name_source is distinct from
             (case when v_name is null then null when p_via = 'corporation_licence' then 'licence' else 'typed' end));
  perform set_config('realcomply.name_change_via', '', true);
end
$function$
;
CREATE OR REPLACE FUNCTION public.set_agency_logo(p_path text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_agency_id uuid := public.current_agency_id();
begin
  if v_agency_id is null then
    raise exception 'no agency for this user';
  end if;

  -- 0093: the licensee in charge, or an office manager.
  if not exists (
    select 1 from public.profiles
     where id = auth.uid() and is_licensee_in_charge
  ) and not public.is_office_manager() then
    raise exception 'only the licensee in charge can change the agency logo';
  end if;

  update public.agencies
     set logo_path = nullif(btrim(p_path), '')
   where id = v_agency_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_agency_trading_name(p_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
begin
  if not public.may_change_office_details() then
    raise exception 'Only the licensee in charge can change the trading name.';
  end if;
  if v_name is null then
    raise exception 'Type your trading name.';
  end if;
  if length(v_name) > 200 then
    raise exception 'That name is too long.';
  end if;
  perform set_config('realcomply.name_change_via', 'office_profile', true);
  update public.agencies set name = v_name where id = public.current_agency_id();
  perform set_config('realcomply.name_change_via', '', true);
end
$function$
;
CREATE OR REPLACE FUNCTION public.set_agency_website(p_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.may_change_office_details() then
    raise exception 'Only the licensee in charge can change the listings page.';
  end if;
  update public.agencies
     set website_url = nullif(btrim(p_url), '')
   where id = public.current_agency_id();
end
$function$
;

-- ── 5. Guards ───────────────────────────────────────────────────────────

-- Roles: making or unmaking a licensee in charge stays with the licensee in
-- charge. An office manager may change the other roles (agent, assistant)
-- and remove or restore people, but never on a licensee in charge's record.
create or replace function public.guard_profile_privileged_columns()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
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
$function$;

-- The office's licensee details, the AML setting and the complaints target
-- stay with the licensee (and, for the licensee's details, the account
-- holder of an office with no licensee in charge, as since 0066).
-- Checks direct changes only, as guard_profile_privileged_columns does: a
-- RealComply function (set_agency_licensee, change_licensee_in_charge,
-- set_agency_aml_precommencement) runs as its owner and carries its own
-- check. So this one is not SECURITY DEFINER: current_user is the caller.
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
     and not public.may_change_agency_details() then
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
revoke execute on function public.guard_agency_licensee_columns() from public, anon, authenticated;

drop trigger if exists agencies_guard_licensee_columns on public.agencies;
create trigger agencies_guard_licensee_columns
  before update of licensee_name, licensee_email, aml_precommencement_enabled, complaint_resolution_target_days
  on public.agencies
  for each row execute function public.guard_agency_licensee_columns();

-- ── 6. Leaving the office ends the role ────────────────────────────────
create or replace function public.end_office_manager_on_leaving()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    update public.office_managers
       set withdrawn_at = now(), withdrawn_via = 'left_office'
     where profile_id = new.id and withdrawn_at is null;
    update public.office_manager_requests
       set cancelled_at = now()
     where profile_id = new.id and approved_at is null and cancelled_at is null;
  end if;
  return null;
end
$$;
revoke execute on function public.end_office_manager_on_leaving() from public, anon, authenticated;

drop trigger if exists profiles_end_office_manager_on_leaving on public.profiles;
create trigger profiles_end_office_manager_on_leaving
  after update of archived_at on public.profiles
  for each row execute function public.end_office_manager_on_leaving();

-- ── 7. A licensee's signed adoption page counts for an office too ───────
-- DECIDED (Adam, 26 Oct 2026). An office plan's listing lock lifts when the
-- licensee in charge adopts the annexure in RealComply (0067), and now also
-- when the licensee's signed adoption page is on file, as on an agent plan
-- (0071). Raine & Horne Queanbeyan: Vic signed the page and it was uploaded
-- on 21 Oct, so Igor isn't held at his second listing while a licensee with
-- no login has no way to adopt in RealComply. Checked on live, 26 Oct: that
-- is the only office plan with such a page.
create or replace function public.listing_gate_reason(p_agency_id uuid)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when a.id is null or not a.annexure_gate then null
    -- CHANGE (Adam, 23 Oct 2026): the first listing is free of the lock.
    -- Counts listings that still exist (archived too) and ones deleted.
    when not exists (select 1 from public.properties p where p.agency_id = a.id)
     and not exists (select 1 from public.deletion_log d
                      where d.agency_id = a.id and d.what = 'properties')
      then null
    when left(coalesce(a.plan, ''), 6) = 'agent_' then
      case when exists (select 1 from public.signoff_documents d
                         where d.agency_id = a.id and d.category = 'sg_annexure_licensee_signed')
           then null else 'signed_annexure' end
    else
      -- 0093: or the licensee's signed adoption page, as on an agent plan.
      case when exists (select 1 from public.sg_annexure_adoptions ad
                         where ad.agency_id = a.id and ad.signed_at is not null)
             or exists (select 1 from public.signoff_documents d
                         where d.agency_id = a.id and d.category = 'sg_annexure_licensee_signed')
           then null else 'annexure' end
  end
  from (select 1) one
  left join public.agencies a on a.id = p_agency_id;
$function$;

-- ── 8. Reminding staff to sign and read the Supervision Guidelines ──────
-- Adam, 26 Oct 2026: "an office manager should be able to email staff to
-- make sure they sign this and read the supervision guidelines." The
-- licensee or an office manager emails the staff who still need to sign the
-- current SG Manual, or read and tick the annexure and the Supervision
-- Guidelines. Each send is recorded, and one person gets at most one
-- reminder a day.

-- An office manager sees who has read and ticked, as the licensee does.
alter policy "sg_read_confirmations: own or licensee can view" on public.sg_read_confirmations
  using (((agency_id = current_agency_id()) AND ((confirmed_by = auth.uid()) OR is_office_licensee() OR is_office_manager())));

-- New table, so the grants block.
create table if not exists public.staff_reminders (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies (id) on delete cascade,
  -- Who was reminded.
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  -- What they were reminded to do.
  kinds         text[] not null check (cardinality(kinds) > 0 and kinds <@ array['sg_manual_sign', 'sg_read']::text[]),
  sent_by       uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  -- Null when the email didn't go.
  email_sent_at timestamptz
);
comment on table public.staff_reminders is
  'Reminder emails to staff to sign the SG Manual or read and tick the annexure and Supervision Guidelines, sent by the licensee or an office manager (0093, Adam 26 Oct 2026). At most one a day per person.';
create index if not exists staff_reminders_person_idx on public.staff_reminders (agency_id, profile_id, created_at desc);

alter table public.staff_reminders enable row level security;
drop policy if exists "staff_reminders: office side can view" on public.staff_reminders;
create policy "staff_reminders: office side can view" on public.staff_reminders
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.runs_office());

revoke all on table public.staff_reminders from public, anon, authenticated;
grant select on public.staff_reminders to authenticated;
grant select, insert, update, delete on public.staff_reminders to service_role;

-- Records a reminder before it is sent, so two presses send one. Null when
-- this person was already reminded in the last 20 hours.
create or replace function public.claim_staff_reminder(p_profile_id uuid, p_kinds text[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_id uuid;
begin
  if v_agency is null or not public.runs_office() then
    raise exception 'Only the licensee in charge or an office manager can send reminders.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles
                  where id = p_profile_id and agency_id = v_agency and archived_at is null)
     or p_profile_id = auth.uid() then
    raise exception 'That person isn''t in your office.';
  end if;
  -- One at a time per person, so two presses can't both pass the check below.
  perform pg_advisory_xact_lock(hashtext('staff_reminders:' || p_profile_id::text));
  if exists (select 1 from public.staff_reminders
              where profile_id = p_profile_id and created_at > now() - interval '20 hours') then
    return null;
  end if;
  insert into public.staff_reminders (agency_id, profile_id, kinds, sent_by)
  values (v_agency, p_profile_id, p_kinds, auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.record_staff_reminder_email(p_id uuid, p_sent boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.staff_reminders
     set email_sent_at = case when p_sent then now() else null end
   where id = p_id and sent_by = auth.uid();
$$;

revoke execute on function public.claim_staff_reminder(uuid, text[]) from public, anon;
revoke execute on function public.record_staff_reminder_email(uuid, boolean) from public, anon;
grant execute on function public.claim_staff_reminder(uuid, text[]) to authenticated;
grant execute on function public.record_staff_reminder_email(uuid, boolean) to authenticated;

-- Check: stops with a message if anything above is missing.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'agencies'
                and column_name = 'licensee_not_on_realcomply') then
    raise exception 'Check failed: 0092''s marker is still there.';
  end if;
  if position('works_as_agent_plan' in pg_get_functiondef('public.acts_as_licensee()'::regprocedure)) > 0
     or position('works_as_agent_plan' in pg_get_functiondef('public.listing_gate_reason(uuid)'::regprocedure)) > 0 then
    raise exception 'Check failed: a rule still uses 0092''s test.';
  end if;
  if (select count(*) from pg_policies
       where coalesce(qual, '') || coalesce(with_check, '') like '%runs_office()%') < 45
     or (select count(*) from pg_policies
          where coalesce(qual, '') || coalesce(with_check, '') like '%is_office_manager()%') < 9 then
    raise exception 'Check failed: the office-side rules don''t all include an office manager.';
  end if;
  if exists (select 1 from pg_policies
              where cmd = 'DELETE' and coalesce(qual, '') ~ 'runs_office\(\)|is_office_manager\(\)'
                and tablename <> 'assistant_agents') then
    raise exception 'Check failed: an office manager could delete records.';
  end if;
  if has_table_privilege('anon', 'public.office_managers', 'select')
     or has_column_privilege('authenticated', 'public.office_manager_requests', 'token', 'select')
     or has_column_privilege('authenticated', 'public.office_managers', 'withdraw_token', 'select') then
    raise exception 'Check failed: a link token is readable.';
  end if;
end
$$;

-- What you should see: one row. undone_0092 true, office_side_rules 56,
-- delete_rules_for_office_manager 0, tables_ready true, office_managers 0,
-- signed_page_offices "Raine & Horne Queanbeyan: open".
select not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'agencies'
                      and column_name = 'licensee_not_on_realcomply') as undone_0092,
       (select count(*) from pg_policies
         where coalesce(qual, '') || coalesce(with_check, '') ~ 'runs_office\(\)|is_office_manager\(\)') as office_side_rules,
       (select count(*) from pg_policies
         where cmd = 'DELETE' and coalesce(qual, '') ~ 'runs_office\(\)|is_office_manager\(\)'
           and tablename <> 'assistant_agents') as delete_rules_for_office_manager,
       (to_regclass('public.office_managers') is not null
        and to_regclass('public.office_manager_requests') is not null) as tables_ready,
       (select count(*) from public.office_managers) as office_managers,
       -- Offices whose lock the licensee's signed page lifts: on live,
       -- Raine & Horne Queanbeyan, which should read "open".
       (select string_agg(btrim(a.name) || ': ' || coalesce(public.listing_gate_reason(a.id), 'open'), '; ')
          from public.agencies a
         where left(coalesce(a.plan, ''), 6) <> 'agent_'
           and exists (select 1 from public.signoff_documents d
                        where d.agency_id = a.id and d.category = 'sg_annexure_licensee_signed')) as signed_page_offices;
