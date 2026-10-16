-- ===== RUN THIS ONE. Migration 0071, agent acknowledgement and the annexure lock, 14 October 2026 =====
--
-- Job 7 brief of 14 Oct 2026 (Adam; mockup approved). Four things:
--
--   1. agencies.annexure_gate: whether this office goes through the new
--      process below. OFF for every office that exists when this runs (Adam,
--      14 Oct 2026: "locks off for live offices"), and off for new offices
--      too until 0072 runs after the app change is live. 0072 turns it on for
--      every office made from then on. (Run in this order so that nobody who
--      signs up before the new screens are live is locked out of adding a
--      listing with no way to upload the signed annexure.) Only RealComply
--      switches it (the SQL editor, or a platform admin); an office cannot
--      switch its own. To switch one office on:
--        update public.agencies set annexure_gate = true where id = '...';
--   2. agent_acknowledgements: what an agent on their own plan confirmed on
--      the "Before you start" screen. Their licence or certificate number, the
--      agency, the licensee in charge and their licence number, the wording
--      version and the full text of the five boxes as shown, the name typed,
--      and when. Nothing else: no IP address, no device details. Saved once
--      per person (a double click saves one). record_agent_acknowledgement()
--      is the only way in.
--   3. record_signed_annexure_upload(): an agent on their own plan files the
--      annexure their licensee in charge signed (PDF, JPG or PNG, up to
--      150 MB) in Document sign-offs, as "Signed SG annexure (licensee
--      adoption)", with who uploaded it and when.
--   4. The lock, in the database as well as the app: while an office's
--      annexure_gate is on, no new listing can be created until
--        - on an agent's own plan: the signed annexure has been uploaded;
--        - on an office plan: the licensee in charge has adopted the annexure
--          through the signing page (0067).
--      Existing listings are not touched. Nothing else is locked.
--
-- The 7-year activity record gains who confirmed the acknowledgement, which
-- wording version and when (identifiers and dates only). Every new table has
-- the grants block. No office's data is changed except annexure_gate set to
-- off on every office that exists now. Safe to run more than once.

begin;

-- Order check: 0070 first.
do $$
begin
  if to_regclass('public.agency_name_changes') is null
     or to_regclass('public.sg_annexure_adoptions') is null
     or to_regprocedure('public.build_activity_record_0058(uuid)') is null
     or to_regprocedure('public.guard_agency_not_ended()') is null then
    raise exception 'Run 0070 before this one. Nothing was changed.';
  end if;
end $$;

-- ── 1. The switch ───────────────────────────────────────────────────────
-- Added empty, every existing office set to off, and off for new ones until
-- 0072. A second run finds the column there and changes nothing.
alter table public.agencies add column if not exists annexure_gate boolean;
update public.agencies set annexure_gate = false where annexure_gate is null;
alter table public.agencies alter column annexure_gate set default false;
alter table public.agencies alter column annexure_gate set not null;

comment on column public.agencies.annexure_gate is
  'Agent acknowledgement and the annexure lock (0071). Off for every office that existed before 0072 ran; on for every office made after it. Only RealComply changes it.';

create or replace function public.guard_agency_annexure_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() is null in the SQL editor and for the service key.
  if new.annexure_gate is distinct from old.annexure_gate
     and auth.uid() is not null
     and not public.is_platform_admin() then
    raise exception 'Only RealComply can switch the annexure lock on or off.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke execute on function public.guard_agency_annexure_gate() from public, anon, authenticated;

drop trigger if exists agencies_guard_annexure_gate on public.agencies;
create trigger agencies_guard_annexure_gate
  before update of annexure_gate on public.agencies
  for each row execute function public.guard_agency_annexure_gate();

-- ── 2. The acknowledgement ──────────────────────────────────────────────
create table if not exists public.agent_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  -- Kept if the person is later removed: the record is the agency's.
  profile_id uuid references public.profiles(id) on delete set null,
  agent_licence_number text not null check (length(btrim(agent_licence_number)) between 1 and 40),
  agency_name text not null check (length(btrim(agency_name)) between 1 and 300),
  licensee_name text not null check (length(btrim(licensee_name)) between 1 and 200),
  licensee_licence_number text not null check (length(btrim(licensee_licence_number)) between 1 and 40),
  wording_version text not null check (length(btrim(wording_version)) between 1 and 20),
  -- The five boxes, in order, exactly as shown.
  wording jsonb not null check (jsonb_typeof(wording) = 'array' and jsonb_array_length(wording) = 5),
  typed_name text not null check (length(btrim(typed_name)) between 2 and 120),
  confirmed_at timestamptz not null default now(),
  -- Its PDF in Document sign-offs, once filed.
  signoff_document_id uuid references public.signoff_documents(id) on delete set null,
  constraint agent_acknowledgements_once unique (agency_id, profile_id)
);
create index if not exists agent_acknowledgements_agency_idx on public.agent_acknowledgements (agency_id, confirmed_at);

comment on table public.agent_acknowledgements is
  'What an agent on their own plan confirmed on the "Before you start" screen (0071). Agency data; deleted with the agency. Only ids, version and dates go into the activity record.';

alter table public.agent_acknowledgements enable row level security;

-- Read: the agent who confirmed it, and whoever acts as the licensee (on an
-- agent's own plan, the agent). Write: only record_agent_acknowledgement(),
-- and the PDF link by the app's service key.
drop policy if exists "agent_acknowledgements: own or licensee can view" on public.agent_acknowledgements;
create policy "agent_acknowledgements: own or licensee can view" on public.agent_acknowledgements
  for select using (
    agency_id = public.current_agency_id()
    and (profile_id = auth.uid() or public.acts_as_licensee()));

create or replace function public.record_agent_acknowledgement(
  p_agent_licence_number text,
  p_agency_name text,
  p_licensee_name text,
  p_licensee_licence_number text,
  p_typed_name text,
  p_wording_version text,
  p_wording jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
$$;
revoke execute on function public.record_agent_acknowledgement(text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.record_agent_acknowledgement(text, text, text, text, text, text, jsonb) to authenticated;

-- ── 3. The signed annexure, uploaded ────────────────────────────────────
-- The file is put in the office's _signoffs folder from the browser first
-- (an agent on their own plan may write there, 0058), then filed here. The
-- file must be there, in this office's folder, and a PDF, JPG or PNG of no
-- more than 150 MB (the bucket's own limit).
create or replace function public.record_signed_annexure_upload(p_path text, p_file_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
$$;
revoke execute on function public.record_signed_annexure_upload(text, text) from public, anon;
grant execute on function public.record_signed_annexure_upload(text, text) to authenticated;

-- ── 4. The lock ─────────────────────────────────────────────────────────
-- Why an office may not add a listing yet, or null when it may:
--   'signed_annexure': an agent's own plan with no signed annexure uploaded;
--   'annexure': an office plan whose licensee in charge has not adopted it.
create or replace function public.listing_gate_reason(p_agency_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when a.id is null or not a.annexure_gate then null
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
$$;
revoke execute on function public.listing_gate_reason(uuid) from public, anon, authenticated;
grant execute on function public.listing_gate_reason(uuid) to service_role;

-- The same, for the signed-in person's own office.
create or replace function public.my_listing_gate()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.listing_gate_reason(public.current_agency_id());
$$;
revoke execute on function public.my_listing_gate() from public, anon;
grant execute on function public.my_listing_gate() to authenticated;

create or replace function public.guard_listing_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Empty for the SQL editor, 'service_role' for the service key.
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_reason text;
begin
  -- REVERSAL (Adam, 14 Oct 2026): was 22 Sep design, annexure given to licensee within 14 days, no gate. Now: licensee signs the annexure's adoption section and the agent uploads it before their first listing. Add listing is blocked until then; nothing else is.
  -- REVERSAL (Adam, 14 Oct 2026): was (#42 brief, Part 4): Home reminder until adopted, nothing locked. Now: office plans can't add new listings until the licensee adopts the annexure; existing listings carry on.
  if v_role in ('', 'service_role') then
    return new;
  end if;
  v_reason := public.listing_gate_reason(new.agency_id);
  if v_reason = 'signed_annexure' then
    raise exception 'Upload the annexure signed by your licensee in charge before adding your first listing.'
      using errcode = 'check_violation';
  elsif v_reason = 'annexure' then
    raise exception 'New listings can be added once your licensee in charge has adopted RealComply''s annexure.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke execute on function public.guard_listing_gate() from public, anon, authenticated;

drop trigger if exists properties_listing_gate on public.properties;
create trigger properties_listing_gate
  before insert on public.properties
  for each row execute function public.guard_listing_gate();

-- ── Data API grants: every new table states who may read it ─────────────
revoke all on public.agent_acknowledgements from anon, authenticated;
grant select on public.agent_acknowledgements to authenticated;
grant all on public.agent_acknowledgements to service_role;

-- ── Not once the subscription has ended ─────────────────────────────────
drop trigger if exists agent_acknowledgements_not_ended_guard on public.agent_acknowledgements;
create trigger agent_acknowledgements_not_ended_guard
  before insert or update or delete on public.agent_acknowledgements
  for each row execute function public.guard_agency_not_ended();

-- ── 5. The 7-year activity record ───────────────────────────────────────
-- build_activity_record is 0070's, word for word, plus (0071) who confirmed
-- the agent acknowledgement, which wording version, and when. Identifiers
-- and dates only, never the names or numbers.
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
      from public.sg_read_confirmations r where r.agency_id = p_agency_id), '[]'),
    'agency_name_changes', coalesce((select jsonb_agg(jsonb_build_object(
        'name', n.name_kind, 'via', n.via, 'by', n.changed_by, 'at', n.changed_at) order by n.changed_at)
      from public.agency_name_changes n where n.agency_id = p_agency_id), '[]'),
    'agent_acknowledgements', coalesce((select jsonb_agg(jsonb_build_object(
        'by', k.profile_id, 'version', k.wording_version, 'at', k.confirmed_at,
        'document', k.signoff_document_id) order by k.confirmed_at)
      from public.agent_acknowledgements k where k.agency_id = p_agency_id), '[]'));
$$;
revoke execute on function public.build_activity_record(uuid) from public, anon, authenticated;
grant execute on function public.build_activity_record(uuid) to service_role;

commit;

-- Check: one row, every column true. existing_offices_off counts the offices
-- that existed before this ran and are still off (all of them, the first time).
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'agencies' and column_name = 'annexure_gate') as switch_column,
  not exists (select 1 from public.agencies where annexure_gate) as existing_offices_off,
  to_regclass('public.agent_acknowledgements') is not null as acknowledgements,
  to_regprocedure('public.record_agent_acknowledgement(text, text, text, text, text, text, jsonb)') is not null as record_acknowledgement,
  to_regprocedure('public.record_signed_annexure_upload(text, text)') is not null as signed_upload,
  exists (select 1 from pg_trigger where tgname = 'properties_listing_gate') as listing_lock,
  position('agent_acknowledgements' in pg_get_functiondef('public.build_activity_record(uuid)'::regprocedure)) > 0
    as in_activity_record;
