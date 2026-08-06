-- Agency invites — lets the licensee in charge add real agents to the
-- office profile instead of every person independently signing up and
-- bootstrapping their own separate agency (which is what happened before
-- this migration: bootstrap_agency() always creates a brand-new agency,
-- with no path for a second person to join an existing one).
--
-- Flow: licensee creates an invite (email + name + role) from the new Team
-- page → gets a shareable signup link containing the invite token (there's
-- no outbound email sending yet — see tech-stack-notes.md — so Adam copies
-- and sends the link himself, same manual-relay pattern as everywhere else
-- until Workspace email is wired up) → the invited person opens the link,
-- signs up, and joins the EXISTING agency via accept_invite() instead of
-- bootstrap_agency() creating a new one.

create table public.agency_invites (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  email text not null,
  full_name text,
  is_licensee_in_charge boolean not null default false,
  token uuid not null default gen_random_uuid(),
  status text not null default 'pending', -- 'pending' | 'accepted' | 'revoked'
  invited_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create index agency_invites_agency_id_idx on public.agency_invites(agency_id);
create unique index agency_invites_token_idx on public.agency_invites(token);

alter table public.agency_invites enable row level security;

-- Every agency member can see the invite list (Team page shows "who's
-- pending" to anyone, same as the staff list itself being agency-wide
-- visible) — only the licensee can create/revoke, same pattern as the
-- agencies/profiles licensee-only update policies in 0004_registers.sql.
create policy "agency_invites: agency members can view"
  on public.agency_invites for select
  using (agency_id = public.current_agency_id());

create policy "agency_invites: licensee can insert"
  on public.agency_invites for insert
  with check (
    agency_id = public.current_agency_id()
    and exists (
      select 1 from public.profiles me
      where me.id = auth.uid() and me.is_licensee_in_charge
    )
  );

create policy "agency_invites: licensee can update"
  on public.agency_invites for update
  using (
    agency_id = public.current_agency_id()
    and exists (
      select 1 from public.profiles me
      where me.id = auth.uid() and me.is_licensee_in_charge
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- accept_invite — the join-existing-agency counterpart to bootstrap_agency.
-- SECURITY DEFINER for the same reason as bootstrap_agency: RLS would
-- otherwise block a brand-new user's very first insert. Checks the invite
-- is still pending and that the signed-up email actually matches the
-- invited email (case-insensitive) so a token leak can't be used to join
-- under a different identity than the one it was issued to.
-- ─────────────────────────────────────────────────────────────────────────
create function public.accept_invite(p_token uuid, p_full_name text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.agency_invites;
  v_user_email text;
  v_profile public.profiles;
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

  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge)
    values (
      auth.uid(),
      v_invite.agency_id,
      coalesce(nullif(trim(p_full_name), ''), v_invite.full_name),
      v_user_email,
      true,
      v_invite.is_licensee_in_charge
    )
    returning * into v_profile;

  update public.agency_invites
    set status = 'accepted', accepted_at = now()
    where id = v_invite.id;

  return v_profile;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- get_invite_preview — lets the (unauthenticated) signup page show "you're
-- joining <agency> as an agent" and lock the email field, without exposing
-- agency_invites to anon reads generally. Returns nothing for an unknown,
-- already-accepted, or revoked token so the signup page can fall back to
-- "this invite link isn't valid" rather than leaking which state it's in.
-- ─────────────────────────────────────────────────────────────────────────
create function public.get_invite_preview(p_token uuid)
returns table(agency_name text, email text, is_licensee_in_charge boolean)
language sql
security definer
set search_path = public
stable
as $$
  select a.name, i.email, i.is_licensee_in_charge
  from public.agency_invites i
  join public.agencies a on a.id = i.agency_id
  where i.token = p_token and i.status = 'pending';
$$;
