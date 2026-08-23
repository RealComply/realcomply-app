-- ===== RUN THIS ONE. Migration 0029, licensee-in-charge answer, 23 Aug 2026 =====
--
-- THE BUG THIS FIXES.
--
-- bootstrap_agency() has always written is_licensee_in_charge = true for
-- whoever creates the agency, unconditionally. Meanwhile the signup form asks
-- for a licensee's name and email separately and says "leave blank if that is
-- you". So an agent who correctly names their principal is ALSO recorded as
-- the principal, and nothing in the app can answer "is this person the
-- licensee in charge" with a straight face.
--
-- That question now has to be answerable, because the Settled stage depends on
-- it: an agent who is their own licensee should not be asked to send the file
-- to themselves, and an agent who is not the licensee should not be shown a
-- signature that is not theirs to give (Adam, 23 Aug 2026).
--
-- WHAT THIS DOES.
--
-- Adds bootstrap_agency_v2, which takes the answer as an argument. A NEW
-- FUNCTION rather than a change to the old one: Postgres will not let
-- CREATE OR REPLACE FUNCTION change a signature, and removing the old one puts
-- the word Supabase treats as destructive into the script, which hides the
-- whole run behind a confirmation dialog. Same approach as invite_preview in
-- 0025 and set_agency_licensee in 0027. The old function stays and falls out
-- of use.
--
-- Also adds set_licensee_in_charge, so the answer can be corrected later. Adam,
-- 23 Aug 2026: "I can't see a scenario where you have to change the answer
-- later unless there was a change of licensee midway through the sale
-- campaign." That is the scenario it exists for, and it is deliberately a
-- named action rather than an editable field.
--
-- NOTE ON EXISTING DATA. Nothing is backfilled and nothing needs to be. The
-- only agency in production is Cass Property, where Adam IS the licensee in
-- charge, so the flag is already correct. Any agency created from here answers
-- the question for itself.
--
-- Safe to run more than once.

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

grant execute on function public.bootstrap_agency_v2(text, text, boolean) to authenticated;

-- Changing the answer afterwards. Restricted to someone who is already the
-- licensee in charge, or to the case where the agency currently has none —
-- otherwise any agent could promote themselves to the person who signs off
-- their own compliance files, which is the whole control this product rests on.
create or replace function public.set_licensee_in_charge(p_is_me boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency_id uuid := public.current_agency_id();
  v_caller_is_licensee boolean;
  v_agency_has_licensee boolean;
begin
  if v_agency_id is null then
    raise exception 'no agency for this user';
  end if;

  select is_licensee_in_charge into v_caller_is_licensee
    from public.profiles where id = auth.uid();

  select exists (
    select 1 from public.profiles
     where agency_id = v_agency_id and is_licensee_in_charge
  ) into v_agency_has_licensee;

  if not coalesce(v_caller_is_licensee, false) and v_agency_has_licensee then
    raise exception 'only the licensee in charge can change who the licensee in charge is';
  end if;

  update public.profiles
     set is_licensee_in_charge = coalesce(p_is_me, false)
   where id = auth.uid();
end;
$$;

grant execute on function public.set_licensee_in_charge(boolean) to authenticated;

-- Expect both to be 1.
select
  (select count(*) from information_schema.routines
     where routine_schema='public' and routine_name='bootstrap_agency_v2') as fn_bootstrap_v2_expect_1,
  (select count(*) from information_schema.routines
     where routine_schema='public' and routine_name='set_licensee_in_charge') as fn_set_licensee_expect_1;
