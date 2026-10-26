-- ===== 0092: an office plan run by someone who isn't the licensee in charge =====
--
-- DECIDED (Adam, 26 Oct 2026). Found live at Raine & Horne Queanbeyan: Igor
-- Srbinovski signed up, answered "No, someone else" to "Are you the licensee
-- in charge?" and named the licensee, Ivica (Vic) Srbinovski. The plan is
-- chosen afterwards, on the trial screen, which suggests Office 1, and he took
-- it. An office plan gives the licensee's powers only to a licensee in charge
-- with a login, so nobody in the office had them, and nobody could make
-- anyone licensee in charge (only the current one can). Dotcom Property Sales
-- (23 Oct) is in the same state.
--
-- NOW: an office plan behaves exactly like a single agent plan when the
-- person signing up isn't the licensee in charge.
--   * The licensee needs no login. Price statement approvals, file sign-offs
--     and other licensee sign-offs already go to them by email link: the app
--     sends by link whenever the office has no licensee in charge on
--     RealComply (office_has_active_licensee, 0066). Unchanged.
--   * The person who signed up runs the account the way an agent on their own
--     plan does (Team, Office profile, registers, trust, billing).
--   * The annexure goes the single agent way: they tick the acknowledgement
--     and upload the licensee's signed adoption page, which the listing lock
--     asks for from the second listing (0071, 0087).
--   * If the licensee later wants their own login, the change-licensee
--     process handles it (not part of this change). The moment anyone in the
--     office is an active licensee in charge, the office goes back to
--     working as an office plan (section 3).
--
-- HOW, reusing the single agent rules rather than copying them:
--   1. agencies.licensee_not_on_realcomply: true when the office's licensee
--      in charge isn't on RealComply and the person who signed up runs it.
--   2. public.works_as_agent_plan(plan, licensee_not_on_realcomply): the one
--      test, "an agent plan, or an office run that way". Every rule below
--      that asked "is this an agent plan?" now asks this instead.
--   3. Set at sign-up by a "No, someone else" answer (in bootstrap_agency_v3,
--      the sign-up function). Cleared when anyone becomes an active licensee
--      in charge.
--   4. Nobody signed in can set it by hand.
--   5. Sign-up sets it, and the nine rules that asked "is this an agent
--      plan?" ask the new test:
--      who acts as the licensee, the listing lock, the acknowledgement, the
--      signed annexure upload, the annexure download link, no annexure email
--      to a licensee, and the office agent welcome and read-and-tick. Each is
--      exactly as it is live today apart from that one test (checked against
--      live, 26 Oct 2026). The licensee history and change-licensee rules are
--      left as they are: they are about a licensee in charge with a login.
--   6. Raine & Horne Queanbeyan and any other office in the same state are
--      put on this footing. Their licensee's name and email, and every
--      sign-off link already sent (Vic's price statement link of 21 Oct
--      included), are not touched.
--
-- No new table, so no grants block for a table. The new function gets its
-- grants below. Safe to run twice. Run it before the app change is merged:
-- the app works with or without it, but the offices only get the licensee's
-- powers once both are in.

-- ── 1. The marker ───────────────────────────────────────────────────────
alter table public.agencies
  add column if not exists licensee_not_on_realcomply boolean not null default false;

comment on column public.agencies.licensee_not_on_realcomply is
  'True when the office''s licensee in charge is not on RealComply and the person who signed up runs the account the way an agent on their own plan does (0092, Adam 26 Oct 2026). Set at sign-up by a "No, someone else" answer; cleared when anyone becomes an active licensee in charge.';

-- ── 2. The one test ─────────────────────────────────────────────────────
create or replace function public.works_as_agent_plan(p_plan text, p_licensee_not_on_realcomply boolean)
returns boolean
language sql
immutable
set search_path = public
as $$
  select left(coalesce(p_plan, ''), 6) = 'agent_' or coalesce(p_licensee_not_on_realcomply, false);
$$;
revoke execute on function public.works_as_agent_plan(text, boolean) from public, anon;
grant execute on function public.works_as_agent_plan(text, boolean) to authenticated, service_role;

-- ── 3. Cleared when there is a licensee in charge ──────────────────────
-- Set at sign-up, in bootstrap_agency_v3 (section 5), from the answer given.
-- Cleared here when anyone in the office becomes an active licensee in charge,
-- by whatever route: the office then works as an office plan again.
create or replace function public.clear_licensee_not_on_realcomply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.is_licensee_in_charge, false) and new.archived_at is null then
    perform set_config('realcomply.licensee_footing', 'on', true);
    update public.agencies set licensee_not_on_realcomply = false
     where id = new.agency_id and licensee_not_on_realcomply;
    perform set_config('realcomply.licensee_footing', '', true);
  end if;
  return null;
end
$$;
revoke execute on function public.clear_licensee_not_on_realcomply() from public, anon, authenticated;

drop trigger if exists profiles_clear_licensee_not_on_realcomply on public.profiles;
create trigger profiles_clear_licensee_not_on_realcomply
  after insert or update of is_licensee_in_charge, archived_at on public.profiles
  for each row execute function public.clear_licensee_not_on_realcomply();

-- ── 4. Nobody signed in sets it by hand ─────────────────────────────────
-- Like the annexure lock (guard_agency_annexure_gate). It decides who has
-- the licensee's powers, so only RealComply (the SQL editor, the service key,
-- a platform admin), sign-up or the rule in section 3 changes it.
create or replace function public.guard_agency_licensee_not_on_realcomply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.licensee_not_on_realcomply is distinct from
       (case when tg_op = 'INSERT' then false else old.licensee_not_on_realcomply end)
     and auth.uid() is not null
     and not public.is_platform_admin()
     and coalesce(current_setting('realcomply.licensee_footing', true), '') <> 'on' then
    raise exception 'Only RealComply can change whether an office''s licensee in charge is on RealComply.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke execute on function public.guard_agency_licensee_not_on_realcomply() from public, anon, authenticated;

drop trigger if exists agencies_guard_licensee_not_on_realcomply on public.agencies;
create trigger agencies_guard_licensee_not_on_realcomply
  before insert or update of licensee_not_on_realcomply on public.agencies
  for each row execute function public.guard_agency_licensee_not_on_realcomply();

-- ── 5. Sign-up, and the rules that asked "is this an agent plan?" ──────
-- bootstrap_agency_v3 first: exactly as live, plus the marker on "No".
-- bootstrap_agency_v3
create or replace function public.bootstrap_agency_v3(p_agency_name text, p_full_name text, p_is_licensee boolean, p_founder_token text DEFAULT NULL::text)
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

  -- 0092 (Adam, 26 Oct 2026): "No, someone else" means the office's licensee
  -- in charge is not on RealComply, and the person signing up runs the
  -- account the way an agent on their own plan does, whatever plan they then
  -- choose. On an agent plan it changes nothing.
  if not coalesce(p_is_licensee, false) then
    perform set_config('realcomply.licensee_footing', 'on', true);
    update public.agencies set licensee_not_on_realcomply = true where id = v_agency_id;
    perform set_config('realcomply.licensee_footing', '', true);
  end if;

  -- Which agency the invite produced, so a tester's account can be found later
  -- from the code that let them in.
  if v_claimed is not null then
    update public.founder_invites
       set agency_id = v_agency_id
     where token = v_claimed;
  end if;

  return v_profile;
end;
$function$;

-- acts_as_licensee
create or replace function public.acts_as_licensee()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select me.is_licensee_in_charge or (public.works_as_agent_plan(a.plan, a.licensee_not_on_realcomply) and not me.is_assistant)
      from public.profiles me
      join public.agencies a on a.id = me.agency_id
     where me.id = auth.uid() and me.archived_at is null), false);
$function$;

-- listing_gate_reason
create or replace function public.listing_gate_reason(p_agency_id uuid)
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
    when public.works_as_agent_plan(a.plan, a.licensee_not_on_realcomply) then
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
$function$;

-- record_agent_acknowledgement
create or replace function public.record_agent_acknowledgement(p_agent_licence_number text, p_agency_name text, p_licensee_name text, p_licensee_licence_number text, p_typed_name text, p_wording_version text, p_wording jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me public.profiles;
  v_plan text;
  v_not_on boolean;
  v_id uuid;
begin
  select * into v_me from public.profiles where id = auth.uid() and archived_at is null;
  if v_me.id is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select plan, licensee_not_on_realcomply into v_plan, v_not_on from public.agencies where id = v_me.agency_id;
  -- The agent on their own plan; not someone assisting them.
  if not public.works_as_agent_plan(v_plan, v_not_on) or coalesce(v_me.is_assistant, false) then
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
$function$;

-- record_signed_annexure_upload
create or replace function public.record_signed_annexure_upload(p_path text, p_file_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_agency uuid := public.current_agency_id();
  v_plan text;
  v_not_on boolean;
  v_meta jsonb;
  v_id uuid;
begin
  if v_agency is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select plan, licensee_not_on_realcomply into v_plan, v_not_on from public.agencies where id = v_agency;
  if not public.works_as_agent_plan(v_plan, v_not_on) or not public.acts_as_licensee() then
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
$function$;

-- annexure_download_details
create or replace function public.annexure_download_details(p_token uuid)
 RETURNS TABLE(trading_name text, licensed_entity_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.name, a.licensed_entity_name
    from public.agencies a
   where a.annexure_download_token = p_token
     and public.works_as_agent_plan(a.plan, a.licensee_not_on_realcomply)
     and a.ended_at is null;
$function$;

-- sg_annexure_links_office_plans_only
create or replace function public.sg_annexure_links_office_plans_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (select 1 from public.agencies a
              where a.id = new.agency_id and public.works_as_agent_plan(a.plan, a.licensee_not_on_realcomply)) then
    raise exception 'The annexure is not sent for an agent on their own plan.';
  end if;
  return new;
end
$function$;

-- claim_office_agent_welcome
create or replace function public.claim_office_agent_welcome()
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
       and not public.works_as_agent_plan(a.plan, a.licensee_not_on_realcomply)) then
    return false;
  end if;
  insert into public.agent_welcome_emails (profile_id, agency_id, kind)
  values (auth.uid(), v_agency, 'office')
  on conflict (profile_id) do nothing;
  return found;
end
$function$;

-- confirm_sg_read
create or replace function public.confirm_sg_read()
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
       and not public.works_as_agent_plan(a.plan, a.licensee_not_on_realcomply)) then
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
$function$;

-- office_annexure_adoption
create or replace function public.office_annexure_adoption()
 RETURNS TABLE(annexure_version text, adopted_by_name text, adopted_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ad.annexure_version, ad.signed_name, ad.signed_at
    from public.sg_annexure_adoptions ad
    join public.agencies a on a.id = ad.agency_id
   where ad.agency_id = public.current_agency_id()
     and not public.works_as_agent_plan(a.plan, a.licensee_not_on_realcomply)
   order by ad.signed_at desc
   limit 1;
$function$;

-- ── 6. The offices in this state today ──────────────────────────────────
-- An office plan (not already an agent plan), not ended, with nobody active
-- as licensee in charge and at least one active agent. RealComply's own
-- made-up test offices are left out. Their licensee's name and email and
-- every sign-off link already sent stay exactly as they are.
update public.agencies a
   set licensee_not_on_realcomply = true
 where not public.works_as_agent_plan(a.plan, a.licensee_not_on_realcomply)
   and a.ended_at is null
   and a.name not ilike '%(made up)%'
   and not exists (select 1 from public.profiles p
                    where p.agency_id = a.id and p.archived_at is null and p.is_licensee_in_charge)
   and exists (select 1 from public.profiles p
                where p.agency_id = a.id and p.archived_at is null and not p.is_assistant);

-- Check: stops with a message if anything above is missing.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'agencies'
                    and column_name = 'licensee_not_on_realcomply') then
    raise exception 'Check failed: the new column is missing.';
  end if;
  if position('works_as_agent_plan' in pg_get_functiondef('public.acts_as_licensee()'::regprocedure)) = 0
     or position('works_as_agent_plan' in pg_get_functiondef('public.listing_gate_reason(uuid)'::regprocedure)) = 0 then
    raise exception 'Check failed: the rules do not use the new test.';
  end if;
end
$$;

-- What it did: every office now run like an agent plan because its licensee
-- in charge isn't on RealComply, with its licensee's details and the
-- sign-off links still waiting on them, as they were.
select a.name as office,
       a.plan,
       a.licensee_name,
       a.licensee_email,
       (select count(*) from public.property_signoff_requests r
         where r.agency_id = a.id and r.signed_at is null and r.revoked_at is null) as sign_off_links_waiting,
       coalesce(public.listing_gate_reason(a.id), 'open') as listing_lock
  from public.agencies a
 where a.licensee_not_on_realcomply
 order by a.name;

-- TO UNDO FOR ONE OFFICE (only if needed): it goes back to working as an
-- office plan, exactly as before this change.
-- update public.agencies set licensee_not_on_realcomply = false where name = 'Office name here';
