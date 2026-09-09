-- ===== RUN THIS ONE. Migration 0045, founder invites, 9 September 2026 =====
--
-- MIGRATION 0045 — an invite that lets somebody create their OWN agency
-- 9 September 2026
--
-- WHY. Adam, 9 Sep 2026: "I want to get this thing started pretty well now so
-- that I can get friends to begin testing on free accounts."
--
-- There was no way to do that. The two existing doors both fail him:
--
--   * The AGENCY INVITE (0006) invites somebody into an agency that already
--     exists. A friend at another office needs their own agency, not a seat in
--     Cass Property, and putting them in Cass would show them Cass's listings
--     and trust records — which is the one thing that must never happen.
--
--   * OPENING SIGNUPS (0033) is a single global switch. Flipping it lets in
--     five friends and also anybody who finds the URL, for as long as it stays
--     on, with the T&Cs not yet cleared by the lawyer.
--
-- So this is the missing third thing: a single-use token that permits creating
-- ONE new agency, and nothing else. Signups stay closed the whole time.
--
-- THE CLAIM IS THE CHECK, and that is the security property worth naming. The
-- token is not "looked up, then used" — it is claimed by an UPDATE whose WHERE
-- clause carries every condition, and only a claim that changed a row is
-- allowed to proceed. Two people opening the same link at the same moment
-- cannot both pass, because the second update matches nothing. A check followed
-- by a separate use is a race; an update that returns what it changed is not.
--
-- If anything after the claim fails, the whole function rolls back and the
-- token is unclaimed again — one transaction, so a half-created agency cannot
-- burn somebody's invite.
--
-- FREE BY DEFAULT, no Stripe involved. agencies.status defaults to 'comped'
-- (0036), so an agency created this way is a genuinely free account from the
-- moment it exists. Nothing here touches billing and no card is ever asked for.
--
-- SAFE TO RUN TWICE. The codes are minted only when the table is empty, so
-- re-running never issues a second batch or invalidates the first.

-- ── 1. The invites ────────────────────────────────────────────────────────

create table if not exists public.founder_invites (
  token       text primary key,
  -- Who it went to. For Adam's own reference when he is looking at a list of
  -- ten strings and trying to remember which one he texted to whom.
  label       text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '60 days'),
  accepted_at timestamptz,
  accepted_by uuid,
  agency_id   uuid references public.agencies(id) on delete set null
);

comment on table public.founder_invites is
  'Single-use tokens permitting the creation of one new agency while public signups are closed. Claimed atomically by bootstrap_agency_v3.';

alter table public.founder_invites enable row level security;

-- Read-only, platform admins only. There is deliberately NO insert, update or
-- delete policy: minting happens here or in the SQL editor, and consuming
-- happens inside a SECURITY DEFINER function which is not subject to RLS. A
-- table whose rows are their own passwords should not be writable from a
-- browser session at all.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'founder_invites'
      and policyname = 'founder_invites: platform admins can view'
  ) then
    create policy "founder_invites: platform admins can view"
      on public.founder_invites for select
      using (public.is_platform_admin());
  end if;
end $$;

-- ── 2. Ten codes ──────────────────────────────────────────────────────────
--
-- gen_random_uuid() with the dashes taken out: 32 hex characters, no extension
-- needed, and not guessable in any practical sense.

insert into public.founder_invites (token, label)
select replace(gen_random_uuid()::text, '-', ''), 'Tester ' || lpad(g::text, 2, '0')
from generate_series(1, 10) as g
where not exists (select 1 from public.founder_invites);

-- ── 3. Is this link any good? ─────────────────────────────────────────────
--
-- Deliberately returns a boolean and NOT the label. The signup page only needs
-- to know whether to draw the form; anything more would hand a name to whoever
-- happened to try the link.

create or replace function public.founder_invite_valid(p_token text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.founder_invites
    where token = trim(p_token)
      and accepted_at is null
      and expires_at > now()
  );
$$;

revoke execute on function public.founder_invite_valid(text) from public;
grant execute on function public.founder_invite_valid(text) to anon, authenticated;

-- ── 4. Creating the agency ────────────────────────────────────────────────
--
-- v3 rather than a change to v2, because v2 has three call sites and a
-- signature change would break every one of them at once. v2 keeps working
-- exactly as it did for the open-signups path.

create or replace function public.bootstrap_agency_v3(
  p_agency_name text,
  p_full_name text,
  p_is_licensee boolean,
  p_founder_token text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke execute on function public.bootstrap_agency_v3(text, text, boolean, text) from public;
grant execute on function public.bootstrap_agency_v3(text, text, boolean, text) to authenticated;

-- ── Verify, and collect the links ─────────────────────────────────────────
--
-- Ten rows, all unused. The `invite_link` column is what you send people —
-- copy it as it is. Each one works exactly once.
--
-- To label them as you hand them out:
--   update public.founder_invites set label = 'Dave - Ray White Hornsby'
--   where token = 'paste-the-token-here';

select
  label,
  'https://www.realcomply.com.au/signup?founder=' || token as invite_link,
  expires_at::date                                          as expires,
  case when accepted_at is null then 'unused' else 'used' end as state
from public.founder_invites
order by label;
