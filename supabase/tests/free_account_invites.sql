-- ===== READ ONLY. "Free account" on personal invites, 27 October 2026 =====
--
-- Proves supabase/migrations/0098_free_account_invites.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up people, invites and offices it
-- creates never exist outside it.
--
-- Pass: the last line says "Free account invites: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o0  uuid := gen_random_uuid();   -- RealComply's own office
  adm uuid := gen_random_uuid();   -- a platform admin
  u1  uuid := gen_random_uuid();   -- signs up with a free invite
  u2  uuid := gen_random_uuid();   -- signs up with a normal invite
  u3  uuid := gen_random_uuid();   -- a free invite with no creator
  t_free text := 'fa-free-' || replace(gen_random_uuid()::text, '-', '');
  t_norm text := 'fa-norm-' || replace(gen_random_uuid()::text, '-', '');
  t_orph text := 'fa-orph-' || replace(gen_random_uuid()::text, '-', '');
  a record;
  p public.profiles;
  n integer;
begin
  insert into auth.users (id, email) values
    (adm, 'fa-adm@example.invalid'), (u1, 'fa-u1@example.invalid'),
    (u2, 'fa-u2@example.invalid'), (u3, 'fa-u3@example.invalid');
  insert into public.agencies (id, name, plan, status) values (o0, 'FA RealComply', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_platform_admin)
    values (adm, o0, 'Ada Admin', 'fa-adm@example.invalid', true, true, true);
  insert into public.founder_invites (token, label, free_account, created_by) values
    (t_free, 'Fran Free (Free Realty)', true, adm),
    (t_norm, 'Nora Normal', false, adm),
    (t_orph, 'Orphan Free', true, null);

  -- 1. The sign-up page can tell a free link, and only a working one.
  set local role anon;
  if not public.founder_invite_is_free(t_free) then raise exception 'FAIL 1: a free link reads as not free'; end if;
  if public.founder_invite_is_free(t_norm) then raise exception 'FAIL 1b: a normal link reads as free'; end if;
  if public.founder_invite_is_free('nothing-like-a-token') then raise exception 'FAIL 1c: a made-up link reads as free'; end if;
  reset role;

  -- 2. A free invite makes a free (comped) office, comped by the admin who made it.
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  p := public.bootstrap_agency_v3('Free Realty (made up)', 'Fran Free', true, t_free);
  reset role;
  select * into a from public.agencies where id = p.agency_id;
  if a.status <> 'comped' then raise exception 'FAIL 2: status is %', a.status; end if;
  if a.comped_by is distinct from adm then raise exception 'FAIL 2b: comped_by is %', a.comped_by; end if;
  if a.comped_until is not null then raise exception 'FAIL 2c: comped_until is %', a.comped_until; end if;
  if a.comped_reason not like 'Free account via personal invite (Fran Free (Free Realty)), __ ___ ____' then
    raise exception 'FAIL 2d: comped_reason is "%"', a.comped_reason;
  end if;
  if a.stripe_customer_id is not null or a.stripe_subscription_id is not null then
    raise exception 'FAIL 2e: Stripe ids on a free office';
  end if;
  select count(*) into n from public.founder_invites where token = t_free and accepted_by = u1 and agency_id = p.agency_id;
  if n <> 1 then raise exception 'FAIL 2f: the invite was not claimed and linked'; end if;

  -- 3. The free office can write (no card), and is protected.
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  if not public.agency_may_write(p.agency_id) then raise exception 'FAIL 3: a free office cannot write'; end if;
  set local role authenticated;
  -- Writing a listing goes through the same check, as the new user.
  insert into public.properties (agency_id, created_by, address) values (p.agency_id, u1, '1 Free Street');
  -- The person who signed up can't turn the comp off.
  begin
    update public.agencies set comped_by = null, status = 'trialing' where id = p.agency_id;
    raise exception 'FAIL 3b: the new user changed the comp';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;
  if not public.agency_is_protected_values(a.id, a.status, a.comped_by) then
    raise exception 'FAIL 3c: a free office is not protected';
  end if;
  if public.founder_invite_is_free(t_free) then raise exception 'FAIL 3d: a used free link still reads as free'; end if;

  -- 4. A normal invite is unchanged: a trial, waiting for the card.
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  p := public.bootstrap_agency_v3('Normal Realty (made up)', 'Nora Normal', true, t_norm);
  reset role;
  select * into a from public.agencies where id = p.agency_id;
  if a.status <> 'trialing' or a.comped_by is not null or a.comped_reason is not null then
    raise exception 'FAIL 4: a normal invite made % / % / %', a.status, a.comped_by, a.comped_reason;
  end if;

  -- 5. A free invite with no creator fails cleanly: nothing made, the link not used.
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    p := public.bootstrap_agency_v3('Orphan Realty (made up)', 'Oscar Orphan', true, t_orph);
    raise exception 'FAIL 5: a free invite with no creator made an office';
  exception when raise_exception then
    if sqlerrm <> 'free invite has no creator' then raise; end if;
  end;
  reset role;
  select count(*) into n from public.profiles where id = u3;
  if n <> 0 then raise exception 'FAIL 5b: a profile was left behind'; end if;
  select count(*) into n from public.agencies where name = 'Orphan Realty (made up)';
  if n <> 0 then raise exception 'FAIL 5c: an office was left behind'; end if;
  select count(*) into n from public.founder_invites where token = t_orph and accepted_at is null and agency_id is null;
  if n <> 1 then raise exception 'FAIL 5d: the link was used up'; end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'Free account invites: all checks passed';
end
$$;

rollback;
