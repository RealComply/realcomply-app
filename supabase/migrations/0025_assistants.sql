-- 0025 — assistant logins, attached to agents.
--
-- Adam, 20 Aug 2026: "Many agents have assistants... the assistant sets up the
-- file, runs through the process, and leaves it for the agent to have final
-- sign off once they've reviewed."
--
-- Three decisions he made, all of which this migration encodes:
--   1. An assistant can support SEVERAL agents (join table, not a column).
--   2. An assistant sees ONLY their agents' listings — not the whole office.
--   3. They can do everything on a file EXCEPT sign it.
--
-- (3) is enforced in the app (setItemStatus / signItem) rather than here,
-- because it is per-ITEM rather than per-row and RLS has no view of which
-- compliance item a row represents. (1) and (2) are enforced here, in RLS,
-- because visibility must not depend on the app getting a filter right.
--
-- Safe to run more than once.

alter table public.profiles
  add column if not exists is_assistant boolean not null default false;

-- Which agents each assistant supports. Rows are the grant: no row, no access.
create table if not exists public.assistant_agents (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  assistant_id uuid not null references public.profiles(id) on delete cascade,
  agent_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create unique index if not exists assistant_agents_pair_idx
  on public.assistant_agents (assistant_id, agent_id);
create index if not exists assistant_agents_assistant_idx on public.assistant_agents(assistant_id);
create index if not exists assistant_agents_agency_idx on public.assistant_agents(agency_id);

alter table public.assistant_agents enable row level security;

-- ── Helpers ────────────────────────────────────────────────────────────────
-- SECURITY DEFINER and reading profiles directly, for the same reason
-- current_agency_id() does: these are called from inside the policies that
-- govern profiles, so a policy-respecting read would recurse.

create or replace function public.is_assistant()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_assistant from public.profiles where id = auth.uid()), false);
$$;

-- The agents an assistant supports. Only ever consulted when is_assistant()
-- is true — for an agent or a licensee the calling policy short-circuits
-- before this runs, so the ordinary case pays nothing for it.
create or replace function public.visible_agent_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select agent_id from public.assistant_agents where assistant_id = auth.uid()
  union
  -- An assistant can always see anything they created themselves. Without
  -- this, a listing an assistant set up before being attached to its agent
  -- would vanish from their own list.
  select auth.uid();
$$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='assistant_agents' and policyname='assistant_agents: agency members can view') then
    create policy "assistant_agents: agency members can view" on public.assistant_agents for select using (agency_id = public.current_agency_id());
  end if;
  -- Only the licensee decides who supports whom. An assistant granting
  -- themselves another agent would defeat the whole point of the restriction.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='assistant_agents' and policyname='assistant_agents: licensee can insert') then
    create policy "assistant_agents: licensee can insert" on public.assistant_agents for insert
      with check (
        agency_id = public.current_agency_id()
        and exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_licensee_in_charge)
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='assistant_agents' and policyname='assistant_agents: licensee can delete') then
    create policy "assistant_agents: licensee can delete" on public.assistant_agents for delete
      using (
        agency_id = public.current_agency_id()
        and exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_licensee_in_charge)
      );
  end if;
end $$;

-- ── Narrow what an assistant can see ───────────────────────────────────────
-- ALTER POLICY, not CREATE OR REPLACE — Postgres has no CREATE OR REPLACE
-- POLICY, and re-CREATEing would mean removing the existing one first, which
-- puts the word Supabase treats as destructive into the script and hides the
-- whole run behind a confirmation dialog. ALTER just resets the expression and
-- is safe to run twice.
--
-- An agent's behaviour is provably unchanged: is_assistant() is false for
-- them, so the added clause short-circuits to true.
do $$
begin
  if exists (select 1 from pg_policies where schemaname='public' and tablename='properties' and policyname='properties: agency members can view') then
    alter policy "properties: agency members can view" on public.properties
      using (
        agency_id = public.current_agency_id()
        and (not public.is_assistant() or created_by in (select public.visible_agent_ids()))
      );
  end if;

  if exists (select 1 from pg_policies where schemaname='public' and tablename='properties' and policyname='properties: agency members can update') then
    alter policy "properties: agency members can update" on public.properties
      using (
        agency_id = public.current_agency_id()
        and (not public.is_assistant() or created_by in (select public.visible_agent_ids()))
      );
  end if;

  -- Removing a listing destroys a compliance record, and assistants never do
  -- that.
  --
  -- VERIFIED 20 Aug 2026: this branch does not fire, and that is correct. 0008
  -- renamed the policy to "properties: licensee can delete" and narrowed it to
  -- the licensee in charge, so an assistant is already excluded — the guard
  -- below finds nothing and skips, exactly as intended. Kept in place for a
  -- database where the original agency-wide policy still exists.
  if exists (select 1 from pg_policies where schemaname='public' and tablename='properties' and policyname='properties: agency members can delete') then
    alter policy "properties: agency members can delete" on public.properties
      using (agency_id = public.current_agency_id() and not public.is_assistant());
  end if;

  if exists (select 1 from pg_policies where schemaname='public' and tablename='property_items' and policyname='property_items: agency members can view') then
    alter policy "property_items: agency members can view" on public.property_items
      using (
        agency_id = public.current_agency_id()
        and (
          not public.is_assistant()
          or property_id in (select id from public.properties where created_by in (select public.visible_agent_ids()))
        )
      );
  end if;

  if exists (select 1 from pg_policies where schemaname='public' and tablename='property_items' and policyname='property_items: agency members can insert') then
    alter policy "property_items: agency members can insert" on public.property_items
      with check (
        agency_id = public.current_agency_id()
        and (
          not public.is_assistant()
          or property_id in (select id from public.properties where created_by in (select public.visible_agent_ids()))
        )
      );
  end if;

  if exists (select 1 from pg_policies where schemaname='public' and tablename='property_items' and policyname='property_items: agency members can update') then
    alter policy "property_items: agency members can update" on public.property_items
      using (
        agency_id = public.current_agency_id()
        and (
          not public.is_assistant()
          or property_id in (select id from public.properties where created_by in (select public.visible_agent_ids()))
        )
      );
  end if;
end $$;

-- ── The hand-over ──────────────────────────────────────────────────────────
-- Deliberately NOT a sign-off. It records that the assistant finished their
-- part and asked the agent to look. Nothing about it attests that the file is
-- compliant — only the agent's signature does that.
alter table public.properties
  add column if not exists review_requested_at timestamptz,
  add column if not exists review_requested_by uuid references public.profiles(id);

-- ── Invites carry the role ─────────────────────────────────────────────────
alter table public.agency_invites
  add column if not exists is_assistant boolean not null default false,
  -- Which agents the invitee will support, chosen by the licensee at invite
  -- time and applied by accept_invite when they sign up.
  add column if not exists supports_agent_ids uuid[] not null default '{}';

create or replace function public.accept_invite(p_token uuid, p_full_name text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.agency_invites;
  v_user_email text;
  v_profile public.profiles;
  v_agent uuid;
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

  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant)
    values (
      auth.uid(),
      v_invite.agency_id,
      coalesce(nullif(trim(p_full_name), ''), v_invite.full_name),
      v_user_email,
      -- An assistant is not an agent. is_agent drives "whose listings are
      -- these" throughout the app, and an assistant does not have their own.
      not v_invite.is_assistant,
      v_invite.is_licensee_in_charge,
      v_invite.is_assistant
    )
    returning * into v_profile;

  if v_invite.is_assistant then
    foreach v_agent in array v_invite.supports_agent_ids loop
      insert into public.assistant_agents (agency_id, assistant_id, agent_id, created_by)
        values (v_invite.agency_id, auth.uid(), v_agent, v_invite.invited_by)
        on conflict (assistant_id, agent_id) do nothing;
    end loop;
  end if;

  update public.agency_invites
    set status = 'accepted', accepted_at = now()
    where id = v_invite.id;

  return v_profile;
end;
$$;

-- NEW NAME, not a replacement of get_invite_preview.
--
-- The old one returns three columns and this needs four. Postgres will not let
-- CREATE OR REPLACE FUNCTION change a return type, and the alternative is to
-- remove the old function first — which puts the word Supabase treats as
-- destructive into the script and hides the whole migration behind a
-- confirmation dialog (that cost us an evening on 18 Aug). A second function
-- costs nothing; the old one is simply left unused.
create or replace function public.invite_preview(p_token uuid)
returns table(agency_name text, email text, is_licensee_in_charge boolean, is_assistant boolean)
language sql
security definer
set search_path = public
stable
as $$
  select a.name, i.email, i.is_licensee_in_charge, i.is_assistant
  from public.agency_invites i
  join public.agencies a on a.id = i.agency_id
  where i.token = p_token and i.status = 'pending';
$$;

select
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='assistant_agents') as table_expect_1,
  (select count(*) from information_schema.columns where table_schema='public'
     and ((table_name='profiles' and column_name='is_assistant')
       or (table_name='properties' and column_name in ('review_requested_at','review_requested_by'))
       or (table_name='agency_invites' and column_name in ('is_assistant','supports_agent_ids')))) as columns_expect_5;
