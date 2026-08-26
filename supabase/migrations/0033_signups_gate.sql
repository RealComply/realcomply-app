-- MIGRATION 0033 — agency creation is gated in the database, not only in the app
-- 26 August 2026
--
-- WHAT THIS CLOSES
--
-- Until now, "RealComply is invite-only" was enforced entirely in application
-- code: openSignupsAllowed() in src/lib/signups.ts, checked on the signup page
-- and again inside the signup Server Action. That stops every ordinary visitor,
-- and it stopped nobody who skipped the app.
--
-- The anon key is public by design — it ships in every browser bundle, as it is
-- meant to. Supabase's "Allow new users to sign up" is on, and it has to stay on
-- because invite signups go through the same signUp call. Postgres default
-- privileges had granted EXECUTE on every function in public to anon and
-- authenticated, bootstrap_agency and bootstrap_agency_v2 included. So the whole
-- sequence — create an account against the auth API, confirm your own address,
-- call bootstrap_agency_v2 yourself — ran without ever touching a line of our
-- code, and landed the caller inside the product with an agency of their own.
--
-- Nobody else's data was ever reachable: every table is scoped by
-- current_agency_id(), so a self-made agency sees its own empty records and
-- nothing more. What was reachable was the product itself.
--
-- HOW IT IS CLOSED
--
-- The rule moves to where it cannot be walked around. Creating an agency now
-- requires signups to be open, and whether they are open is a row in the
-- database rather than an environment variable — so the app and the database
-- read the same switch and cannot disagree about it. A stranger who creates an
-- auth account still gets no profile, no agency, and therefore no way into
-- anything; requireProfile sends them to /signup, which refuses them.
--
-- INVITES ARE UNTOUCHED, which is the point. accept_invite already checks that
-- the invite is pending and that the signed-up email matches the invited one
-- (0006), so a token cannot be used to join as somebody else. That path is a
-- human vouching for a person, and it stays open with signups closed — exactly
-- the arrangement that made running with confirmation off acceptable in August.
--
-- TO OPEN SIGNUPS LATER, one statement, and it takes effect everywhere at once:
--   update public.app_settings set signups_open = true, updated_at = now();
--
-- Safe to run more than once.

-- ─────────────────────────────────────────────────────────────────────────
-- The switch
-- ─────────────────────────────────────────────────────────────────────────

-- A single-row table. The check constraint on a boolean primary key defaulting
-- to true is the standard way of saying "there is exactly one of these": a
-- second row would have to use id = false, which the constraint forbids.
create table if not exists public.app_settings (
  id boolean primary key default true,
  signups_open boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id)
);

insert into public.app_settings (id, signups_open)
values (true, false)
on conflict (id) do nothing;

alter table public.app_settings enable row level security;

-- Deliberately no policies. With RLS on and no policy to satisfy, a read from
-- an anon or authenticated key returns nothing at all.
--
-- The table privileges are taken back as well, and for the same reason the
-- PUBLIC grant on the functions had to be: Supabase hands anon and
-- authenticated full table privileges on everything created in public, so the
-- grant exists whether or not anyone asked for it. RLS is what actually stops
-- the read today — but a permissive policy added carelessly in some later
-- migration would quietly turn that grant back into access. Two independent
-- reasons this table cannot be read is the right number for the row that
-- decides who may create an agency.
revoke all on table public.app_settings from anon, authenticated;

-- The one SECURITY DEFINER function below is the only way in, and it exposes
-- a single boolean rather than the table.

create or replace function public.signups_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.signups_open from public.app_settings s where s.id), false);
$$;

-- Readable by anyone, including a visitor with no account: the signup page has
-- to know whether to render its form before anybody has signed in. Whether
-- RealComply is currently accepting new agencies is not a secret — the page
-- says so in plain English either way.
grant execute on function public.signups_open() to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- The gate itself
-- ─────────────────────────────────────────────────────────────────────────
-- Both functions are replaced in place. Same signatures, same behaviour once
-- past the new check, so nothing that legitimately calls them changes.

create or replace function public.bootstrap_agency_v2(
  p_agency_name text,
  p_full_name text,
  p_is_licensee boolean
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency_id uuid;
  v_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- The check that makes the app's rule real. Added 0033.
  if not public.signups_open() then
    raise exception 'new agencies are not being accepted';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'profile already exists for this user';
  end if;

  insert into public.agencies (name) values (p_agency_name)
    returning id into v_agency_id;

  -- is_agent stays true either way. A licensee in charge who runs listings is
  -- both, and the two flags were always independent (see 0001).
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

  return v_profile;
end;
$$;

-- The v1 function is still reachable from requireProfile's self-heal path
-- (src/lib/data/current-profile.ts), so it gets the same gate rather than being
-- left as the way around the new one.
create or replace function public.bootstrap_agency(p_agency_name text, p_full_name text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency_id uuid;
  v_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not public.signups_open() then
    raise exception 'new agencies are not being accepted';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'profile already exists for this user';
  end if;

  insert into public.agencies (name) values (p_agency_name)
    returning id into v_agency_id;

  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge)
    values (
      auth.uid(),
      v_agency_id,
      p_full_name,
      (select email from auth.users where id = auth.uid()),
      true,
      true
    )
    returning * into v_profile;

  return v_profile;
end;
$$;

-- Belt and braces. Neither function can do anything without auth.uid(), so an
-- anon caller was already going to be refused — but a privilege that serves no
-- purpose is a privilege worth taking back.
--
-- REVOKING FROM anon ALONE DOES NOTHING, which is worth writing down because the
-- first run of this migration proved it. Postgres grants EXECUTE on every new
-- function to PUBLIC by default — that is the leading "=X/postgres" in a
-- function's ACL — and PUBLIC means every role, anon included. Taking the
-- privilege back from anon while PUBLIC still holds it changes nothing at all:
-- has_function_privilege('anon', ...) still answered true.
--
-- So PUBLIC is revoked first, and authenticated is then granted explicitly,
-- because it was relying on that same PUBLIC grant for bootstrap_agency (0001
-- never granted it directly). Revoke the blanket, then hand back the one role
-- that has a reason to hold it.
revoke execute on function public.bootstrap_agency_v2(text, text, boolean) from public;
revoke execute on function public.bootstrap_agency(text, text) from public;
revoke execute on function public.bootstrap_agency_v2(text, text, boolean) from anon;
revoke execute on function public.bootstrap_agency(text, text) from anon;
grant execute on function public.bootstrap_agency_v2(text, text, boolean) to authenticated;
grant execute on function public.bootstrap_agency(text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Verify (read only — run this after the statements above)
-- ─────────────────────────────────────────────────────────────────────────
-- Expect: signups_open = false, anon_can_bootstrap = false,
-- authed_can_bootstrap = true (the gate inside the function is what stops them,
-- not the privilege), settings_rows = 1, agencies unchanged at 3.
select
  public.signups_open()                                            as signups_open,
  has_function_privilege('anon', 'public.bootstrap_agency_v2(text, text, boolean)', 'execute')
                                                                   as anon_can_bootstrap,
  has_function_privilege('authenticated', 'public.bootstrap_agency_v2(text, text, boolean)', 'execute')
                                                                   as authed_can_bootstrap,
  (select count(*) from public.app_settings)                       as settings_rows,
  (select count(*) from public.agencies)                           as agencies;
