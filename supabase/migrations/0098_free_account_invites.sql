-- ===== 0098: "Free account" on personal invites (Adam, 27 Oct 2026) =====
--
-- When Adam makes a personal invite (founder_invites) he can tick "Free
-- account (no card)". The office that person signs up is then a free
-- (comped) account from the start: no card step, no Stripe customer or
-- subscription.
--
--   1. founder_invites.free_account, and created_by: the platform admin who
--      made the invite, who becomes the office's comped_by. There are two
--      platform admins, so it is recorded, never guessed.
--   2. bootstrap_agency_v3: as 0093 (the same as live, checked on 27 Oct),
--      except that a free invite inserts the agency as comped. Set AT INSERT,
--      inside this function: guard_agency_billing_columns is BEFORE UPDATE
--      only, and a follow-up UPDATE would be refused (the caller is the new
--      user, not a platform admin). A free invite with no creator is refused
--      outright rather than making a comp with no one behind it; the whole
--      sign-up, the claim of the invite included, is undone.
--   3. founder_invite_is_free(token): for the sign-up page, which otherwise
--      says "14-day free trial, enter card details on Stripe's page".
--
-- No new tables. founder_invites is granted table-wide, so the new columns
-- are covered; the new function has its grants below. Safe to run twice.

-- ── 1. The invite ────────────────────────────────────────────────────────
alter table public.founder_invites add column if not exists free_account boolean not null default false;
alter table public.founder_invites add column if not exists created_by uuid references public.profiles (id) on delete set null;

comment on column public.founder_invites.free_account is
  'The office this invite sets up is a free (comped) account from the start: no card, no Stripe (0098).';
comment on column public.founder_invites.created_by is
  'The platform admin who made the invite. For a free invite, the office''s comped_by (0098).';

-- ── 2. Creating the agency ───────────────────────────────────────────────
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
  v_free boolean := false;
  v_created_by uuid;
  v_label text;
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
    -- the top of 0045 for why this is not written as look-up-then-use.
    update public.founder_invites
       set accepted_at = now(),
           accepted_by = auth.uid()
     where token = trim(p_founder_token)
       and accepted_at is null
       and expires_at > now()
    returning token, free_account, created_by, label
      into v_claimed, v_free, v_created_by, v_label;

    if v_claimed is null then
      raise exception 'that invite link is not valid';
    end if;

    -- Never a comp with no one behind it (0098). Raising here undoes the
    -- claim above with everything else.
    if coalesce(v_free, false) and v_created_by is null then
      raise exception 'free invite has no creator';
    end if;

  elsif not public.signups_open() then
    -- No token and the door is shut. Same refusal as v2.
    raise exception 'new agencies are not being accepted';
  end if;

  if coalesce(v_free, false) then
    -- A free account from the start (0098): comped at insert, so no card
    -- step and no Stripe. Protected, like every comp (comped_by is set).
    insert into public.agencies (name, status, comped_by, comped_reason, comped_until)
      values (
        p_agency_name,
        'comped',
        v_created_by,
        'Free account via personal invite (' || coalesce(v_label, '') || '), '
          || to_char(now() at time zone 'Australia/Sydney', 'DD Mon YYYY'),
        null
      )
      returning id into v_agency_id;
  else
    insert into public.agencies (name) values (p_agency_name)
      returning id into v_agency_id;
  end if;

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

-- ── 3. Is this a free invite? (the sign-up page) ─────────────────────────
-- Like founder_invite_valid: a boolean, never the label, and only for a link
-- that still works.
create or replace function public.founder_invite_is_free(p_token text)
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
      and free_account
  );
$$;

revoke execute on function public.founder_invite_is_free(text) from public;
grant execute on function public.founder_invite_is_free(text) to anon, authenticated;

-- What it shows when it has run: true, true, true.
select exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'founder_invites' and column_name = 'free_account')
       and exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'founder_invites' and column_name = 'created_by')
         as invite_columns_ready,
       position('free invite has no creator' in
                pg_get_functiondef('public.bootstrap_agency_v3(text,text,boolean,text)'::regprocedure)) > 0
         as signup_makes_free_accounts,
       has_function_privilege('anon', 'public.founder_invite_is_free(text)', 'execute') as signup_page_can_ask;
