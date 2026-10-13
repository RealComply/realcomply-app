-- ===== RUN THIS ONE. Migration 0070, trading name and licensed entity name, 14 October 2026 =====
--
-- Brief of 14 Oct 2026 (Adam; mockup approved), with Parts 4 to 6 added the
-- same day. Lloyd Property Agents' corporation licence is held by Trent Lloyd
-- Corporation Pty Ltd, so it did not match the office name and the upload was
-- refused. An office now has two names:
--
--   * the trading name: agencies.name, as today. The name clients know them
--     by, on every screen and in every email.
--   * the licensed entity name: the company that holds the corporation
--     licence. New here, and nullable. Given at sign-up, read from the
--     corporation licence ("Yes, use it"), typed in Office profile, or edited
--     on the annexure signing page. The formal documents (the compliance audit
--     file cover and the annexure's Agency line) say "[licensed entity name]
--     trading as [trading name]".
--
-- What this file does:
--
--   1. agencies.licensed_entity_name, and licensed_entity_name_source
--      ('licence' when it was read from the corporation licence, 'typed'
--      otherwise). Both empty, or both set. Also agencies.annexure_download_token,
--      for an agent on their own plan's "Download the annexure for your
--      licensee" link, which now carries their office's names.
--   2. agency_name_changes: every change to either name, who made it, how
--      (Office profile, the corporation licence, sign-up, the signing page) and
--      when. A finished audit file is printed with the names as they stood when
--      it was finished, using this history.
--   3. set_agency_trading_name() and set_agency_licensed_entity_name(): the way
--      to change them from the app. Same rule as the other office details
--      (may_change_agency_details, 0058): the licensee in charge, or an agent
--      on their own plan; anyone at all only while an office has no licensee
--      in charge yet, which is how a sign-up by someone else fills it in.
--   4. The annexure signing page: sg_annexure_link_details() also returns the
--      licensed entity name; adopt_sg_annexure() takes an edited one, saves it
--      to the office (recorded as changed on the signing page, by the name
--      signed), and keeps both names on the adoption, so the signed PDF says
--      what was signed. The 0067 four-argument call still works.
--   5. annexure_download_details(): the names for an agent's download link.
--   6. The 7-year activity record gains who changed which name, how and when
--      (identifiers and dates only, never the names).
--
-- Every new table has the grants block. No office's names are changed by this
-- file. Safe to run more than once.

begin;

-- Order check: 0066 to 0069 first.
do $$
begin
  if to_regclass('public.agent_welcome_emails') is null
     or to_regclass('public.licensee_contact_changes') is null
     or to_regclass('public.sg_annexure_adoptions') is null
     or to_regprocedure('public.adopt_sg_annexure(uuid, text, text, text)') is null then
    raise exception 'Run 0066 to 0069 before this one. Nothing was changed.';
  end if;
  if to_regprocedure('public.build_activity_record_0058(uuid)') is null
     or to_regprocedure('public.may_change_agency_details()') is null then
    raise exception 'The activity record or may_change_agency_details() is missing. Nothing was changed.';
  end if;
end $$;

-- ── 1. The licensed entity name, and the agent's download link ──────────
alter table public.agencies add column if not exists licensed_entity_name text;
alter table public.agencies add column if not exists licensed_entity_name_source text;

alter table public.agencies drop constraint if exists agencies_licensed_entity_name_ok;
alter table public.agencies add constraint agencies_licensed_entity_name_ok check (
  (licensed_entity_name is null and licensed_entity_name_source is null)
  or (licensed_entity_name is not null
      and btrim(licensed_entity_name) <> ''
      and length(licensed_entity_name) <= 200
      -- Said outright: a null source would make the check unknown, which passes.
      and licensed_entity_name_source is not null
      and licensed_entity_name_source in ('licence', 'typed'))
);

comment on column public.agencies.licensed_entity_name is
  'The company that holds the corporation licence (0070). The trading name stays in agencies.name.';
comment on column public.agencies.licensed_entity_name_source is
  '''licence'' when read from the corporation licence, ''typed'' otherwise (0070).';

alter table public.agencies add column if not exists annexure_download_token uuid not null default gen_random_uuid();
create unique index if not exists agencies_annexure_download_token_idx on public.agencies (annexure_download_token);
comment on column public.agencies.annexure_download_token is
  'In an agent on their own plan''s "Download the annexure for your licensee" link (0070). Gives the office''s two names and nothing else.';

-- ── 2. Who changed which name, how, and when ────────────────────────────
create table if not exists public.agency_name_changes (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null references public.agencies(id) on delete cascade,
  name_kind        text not null check (name_kind in ('trading', 'licensed_entity')),
  old_name         text,
  new_name         text,
  via              text not null check (via in ('office_profile', 'corporation_licence', 'sign_up', 'signing_page')),
  -- Null when nobody was signed in (the signing page) or RealComply changed it.
  changed_by       uuid,
  -- The name typed on the signing page, which is signed out.
  changed_by_name  text,
  changed_at       timestamptz not null default now()
);
create index if not exists agency_name_changes_agency_idx on public.agency_name_changes (agency_id, changed_at);

comment on table public.agency_name_changes is
  'Every change to the agency''s trading name or licensed entity name: who, how and when (0070). Agency data; deleted with the agency. Only ids and dates go into the activity record.';

alter table public.agency_name_changes enable row level security;

-- Read: anyone in the office. The names are printed on every audit file in
-- the office, agents' own included, and a finished file is printed with the
-- names as they stood when it was finished, which needs this history.
-- Write: only the trigger below.
drop policy if exists "agency_name_changes: own office can view" on public.agency_name_changes;
create policy "agency_name_changes: own office can view" on public.agency_name_changes
  for select using (agency_id = public.current_agency_id());

-- How a change was made is passed in for the length of the transaction by
-- the functions below; a direct update counts as Office profile.
create or replace function public.log_agency_name_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_via text := nullif(current_setting('realcomply.name_change_via', true), '');
  v_by_name text := nullif(current_setting('realcomply.name_change_by_name', true), '');
begin
  if tg_op = 'INSERT' then
    if new.licensed_entity_name is not null then
      insert into public.agency_name_changes (agency_id, name_kind, old_name, new_name, via, changed_by, changed_by_name)
      values (new.id, 'licensed_entity', null, new.licensed_entity_name, coalesce(v_via, 'sign_up'), auth.uid(), v_by_name);
    end if;
    return new;
  end if;
  if new.name is distinct from old.name then
    insert into public.agency_name_changes (agency_id, name_kind, old_name, new_name, via, changed_by, changed_by_name)
    values (new.id, 'trading', old.name, new.name, coalesce(v_via, 'office_profile'), auth.uid(), v_by_name);
  end if;
  if new.licensed_entity_name is distinct from old.licensed_entity_name then
    insert into public.agency_name_changes (agency_id, name_kind, old_name, new_name, via, changed_by, changed_by_name)
    values (new.id, 'licensed_entity', old.licensed_entity_name, new.licensed_entity_name,
            coalesce(v_via, 'office_profile'), auth.uid(), v_by_name);
  end if;
  return new;
end
$$;
revoke execute on function public.log_agency_name_change() from public, anon, authenticated;

drop trigger if exists agencies_name_change_log on public.agencies;
create trigger agencies_name_change_log
  after insert or update of name, licensed_entity_name on public.agencies
  for each row execute function public.log_agency_name_change();

-- ── 3. Changing them ────────────────────────────────────────────────────
-- Spaces are tidied. The trading name cannot be emptied; the licensed entity
-- name can (empty clears it).
create or replace function public.set_agency_trading_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
begin
  if not public.may_change_agency_details() then
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
$$;
revoke execute on function public.set_agency_trading_name(text) from public, anon;
grant execute on function public.set_agency_trading_name(text) to authenticated;

-- p_via: 'office_profile', 'corporation_licence' ("Yes, use it" on the
-- licence) or 'sign_up'. Read from the licence is shown as such in Office
-- profile; everything else counts as typed.
create or replace function public.set_agency_licensed_entity_name(p_name text, p_via text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
begin
  if not public.may_change_agency_details() then
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
$$;
revoke execute on function public.set_agency_licensed_entity_name(text, text) from public, anon;
grant execute on function public.set_agency_licensed_entity_name(text, text) to authenticated;

-- ── Data API grants: every new table states who may read it ─────────────
revoke all on public.agency_name_changes from anon, authenticated;
grant select on public.agency_name_changes to authenticated;
grant all on public.agency_name_changes to service_role;

-- ── 4. The annexure signing page ────────────────────────────────────────
-- (a) The names on each adoption, as signed. Empty on adoptions before 0070,
--     whose signed copies were made then.
alter table public.sg_annexure_adoptions add column if not exists trading_name text;
alter table public.sg_annexure_adoptions add column if not exists licensed_entity_name text;

-- (b) What the page shows: 0067's function word for word, plus the licensed
--     entity name. Its columns change, so it is dropped and made again, with
--     the same grants.
drop function if exists public.sg_annexure_link_details(uuid, text);
create function public.sg_annexure_link_details(p_token uuid, p_version text)
returns table (
  agency_id uuid,
  agency_name text,
  licence_number text,
  logo_path text,
  sent_to text,
  state text,
  adopted_at timestamptz,
  licensed_entity_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id,
         a.name,
         coalesce(
           nullif(btrim(a.corporation_licence_number), ''),
           (select nullif(btrim(p.licence_number), '')
              from public.profiles p
             where p.agency_id = a.id and p.archived_at is null
               and (p.is_licensee_in_charge or (left(a.plan, 6) = 'agent_' and not p.is_assistant))
             order by p.is_licensee_in_charge desc, p.created_at
             limit 1)),
         a.logo_path,
         l.sent_to,
         case
           when ad.id is not null then 'adopted'
           when a.ended_at is not null then 'ended'
           when l.used_at is not null then 'used'
           when l.expires_at <= now() then 'expired'
           else 'open'
         end,
         ad.signed_at,
         a.licensed_entity_name
    from public.sg_annexure_links l
    join public.agencies a on a.id = l.agency_id
    left join public.sg_annexure_adoptions ad
      on ad.agency_id = l.agency_id and ad.annexure_version = p_version
   where l.token = p_token;
$$;
revoke execute on function public.sg_annexure_link_details(uuid, text) from public;
grant execute on function public.sg_annexure_link_details(uuid, text) to anon, authenticated;

-- (c) Adopting, with the licensed entity name as it stands on the page.
--     p_licensed_entity_name: null leaves the office's as it is; anything else
--     (empty included) is what the licensee left in the box, and is saved to
--     the office if it differs, recorded as changed on the signing page by the
--     name signed. 0067's checks and locking, word for word.
create or replace function public.adopt_sg_annexure(
  p_token uuid,
  p_version text,
  p_signed_name text,
  p_licence_number text,
  p_licensed_entity_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.sg_annexure_links;
  v_name text := btrim(coalesce(p_signed_name, ''));
  v_licence text := btrim(coalesce(p_licence_number, ''));
  v_entity text := nullif(regexp_replace(btrim(coalesce(p_licensed_entity_name, '')), '\s+', ' ', 'g'), '');
  v_agency public.agencies;
  v_id uuid;
begin
  if p_version is null or p_version !~ '^[0-9]+\.[0-9]+$' then
    raise exception 'That version of the annexure is not one RealComply knows.';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Type your full name.';
  end if;
  if length(v_licence) < 1 or length(v_licence) > 40 then
    raise exception 'Type your licence number.';
  end if;
  if length(v_entity) > 200 then
    raise exception 'The licensed entity name is too long.';
  end if;

  select * into v_link from public.sg_annexure_links where token = p_token for update;
  if not found or v_link.used_at is not null or v_link.expires_at <= now() then
    raise exception 'This link is no longer valid.';
  end if;
  if exists (select 1 from public.sg_annexure_adoptions
              where agency_id = v_link.agency_id and annexure_version = p_version) then
    raise exception 'This annexure has already been adopted.';
  end if;

  if p_licensed_entity_name is not null then
    perform set_config('realcomply.name_change_via', 'signing_page', true);
    perform set_config('realcomply.name_change_by_name', v_name, true);
    update public.agencies
       set licensed_entity_name = v_entity,
           licensed_entity_name_source = case when v_entity is null then null else 'typed' end
     where id = v_link.agency_id
       and licensed_entity_name is distinct from v_entity;
    perform set_config('realcomply.name_change_via', '', true);
    perform set_config('realcomply.name_change_by_name', '', true);
  end if;

  select * into v_agency from public.agencies where id = v_link.agency_id;

  insert into public.sg_annexure_adoptions
    (agency_id, annexure_version, signed_name, licence_number, sent_to, trading_name, licensed_entity_name)
  values (v_link.agency_id, p_version, v_name, v_licence, v_link.sent_to, v_agency.name, v_agency.licensed_entity_name)
  returning id into v_id;
  update public.sg_annexure_links set used_at = now() where id = v_link.id;
  return v_id;
end
$$;
revoke execute on function public.adopt_sg_annexure(uuid, text, text, text, text) from public;
grant execute on function public.adopt_sg_annexure(uuid, text, text, text, text) to anon, authenticated;

-- 0067's four-argument call: the same, leaving the licensed entity name as it is.
create or replace function public.adopt_sg_annexure(
  p_token uuid,
  p_version text,
  p_signed_name text,
  p_licence_number text
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.adopt_sg_annexure(p_token, p_version, p_signed_name, p_licence_number, null::text);
$$;
revoke execute on function public.adopt_sg_annexure(uuid, text, text, text) from public;
grant execute on function public.adopt_sg_annexure(uuid, text, text, text) to anon, authenticated;

-- ── 5. An agent on their own plan's download link ───────────────────────
-- The two names for the Agency line, and nothing else. Agent plans only,
-- and not once the subscription has ended.
create or replace function public.annexure_download_details(p_token uuid)
returns table (trading_name text, licensed_entity_name text)
language sql
stable
security definer
set search_path = public
as $$
  select a.name, a.licensed_entity_name
    from public.agencies a
   where a.annexure_download_token = p_token
     and left(coalesce(a.plan, ''), 6) = 'agent_'
     and a.ended_at is null;
$$;
revoke execute on function public.annexure_download_details(uuid) from public;
grant execute on function public.annexure_download_details(uuid) to anon, authenticated;

-- ── 6. The 7-year activity record ───────────────────────────────────────
-- build_activity_record is 0069's, word for word, plus (0070) which name
-- changed, how, who and when. Never the names themselves.
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
      from public.agency_name_changes n where n.agency_id = p_agency_id), '[]'));
$$;
revoke execute on function public.build_activity_record(uuid) from public, anon, authenticated;
grant execute on function public.build_activity_record(uuid) to service_role;

commit;

-- Check: one row, every column true.
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'agencies' and column_name = 'licensed_entity_name') as entity_name_column,
  to_regclass('public.agency_name_changes') is not null as name_history,
  to_regprocedure('public.set_agency_trading_name(text)') is not null
    and to_regprocedure('public.set_agency_licensed_entity_name(text, text)') is not null as setters,
  to_regprocedure('public.adopt_sg_annexure(uuid, text, text, text, text)') is not null
    and exists (select 1 from pg_proc p
                 where p.oid = 'public.sg_annexure_link_details(uuid, text)'::regprocedure
                   and 'licensed_entity_name' = any (p.proargnames)) as signing_page,
  to_regprocedure('public.annexure_download_details(uuid)') is not null as agent_download,
  position('agency_name_changes' in pg_get_functiondef('public.build_activity_record(uuid)'::regprocedure)) > 0
    as in_activity_record;
