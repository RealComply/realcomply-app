-- ===== READ ONLY. The licensee's details at sign-up, 26 October 2026 =====
--
-- Proves supabase/migrations/0097_signup_licensee_details.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up offices and people it creates
-- never exist outside it.
--
-- Pass: the last line says "Sign-up licensee details: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  -- Office 1: just set up by s, who answered "No, someone else".
  o1 uuid := gen_random_uuid();
  s  uuid := gen_random_uuid();
  u  uuid := gen_random_uuid();   -- joined office 1 after s
  -- Office 2: set up two hours ago, details never filled in.
  o2 uuid := gen_random_uuid();
  t  uuid := gen_random_uuid();
  r record;
begin
  insert into auth.users (id, email) values
    (s, 'sl-s@example.invalid'), (u, 'sl-u@example.invalid'), (t, 'sl-t@example.invalid');
  insert into public.agencies (id, name, plan, status, created_at) values
    (o1, 'SL Office One', 'office_1', 'active', now()),
    (o2, 'SL Office Two', 'office_1', 'active', now() - interval '2 hours');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant, created_at) values
    (s, o1, 'Sam Setup', 'sl-s@example.invalid', true, false, false, now() - interval '1 minute'),
    (u, o1, 'Uma Later', 'sl-u@example.invalid', true, false, false, now()),
    (t, o2, 'Tia Setup', 'sl-t@example.invalid', true, false, false, now() - interval '2 hours');

  -- 1. Someone who joined later can't fill them in, even on a new office.
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_agency_licensee('Uma''s Pick', 'uma@example.invalid');
    raise exception 'FAIL 1: someone other than the person who set it up filled them in';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 2. The person who set the office up fills them in at sign-up.
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_agency_licensee('Cara Licensee', 'cara@example.invalid');
  reset role;
  select licensee_name, licensee_email into r from public.agencies where id = o1;
  if r.licensee_name is distinct from 'Cara Licensee' or r.licensee_email is distinct from 'cara@example.invalid' then
    raise exception 'FAIL 2: the details given at sign-up weren''t saved (%)', r;
  end if;

  -- 3. Once only: after that, changing them is the licensee's alone.
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_agency_licensee('Someone Else', 'else@example.invalid');
    raise exception 'FAIL 3: changed the details after sign-up';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.set_agency_licensee_email('else@example.invalid');
    raise exception 'FAIL 3b: changed the email after sign-up';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 4. Not on an office set up earlier, even with the details still blank.
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_agency_licensee('Late Fill', 'late@example.invalid');
    raise exception 'FAIL 4: filled them in two hours after the office was set up';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 5. Never without signing in.
  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform public.may_fill_licensee_details_at_signup();
    raise exception 'FAIL 5: checked without signing in';
  exception when insufficient_privilege then null;
  end;
  reset role;

  raise notice 'Sign-up licensee details: all checks passed';
end
$$;

rollback;
