-- ===== READ ONLY. Subscription end test, 8 October 2026 =====
--
-- Proves, in the database itself (migration 0054):
--
--   * an agency gets an end date when its status moves to canceled;
--   * Cass Property, Comply Real Estate, a comped agency and the platform
--     owner's agency never do, whatever the status says;
--   * once ended, a signed-in user can create, change or delete nothing:
--     listings, registers, team, the agency row, uploaded files;
--   * the licensee sign-off link (anon) is blocked too;
--   * reactivating lifts all of it straight away.
--
-- Run it after 0054. It is safe on the live database: everything happens
-- inside one transaction that is rolled back at the end, so the made-up
-- agency and people never exist outside it, and the status changes it makes
-- to Cass Property and Comply Real Estate are undone.
--
-- Pass: the last line says "Subscription end: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  cass   uuid := 'b4763dfb-b33e-43bb-94ca-702a7e989a27';
  comply uuid := '2972edd0-7995-4946-803b-064d2a50baee';
  t_agency uuid := gen_random_uuid();   -- the throwaway agency
  c_agency uuid := gen_random_uuid();   -- a comped one
  p_agency uuid := gen_random_uuid();   -- one with a platform admin in it
  lic  uuid := gen_random_uuid();
  adm  uuid := gen_random_uuid();
  prop uuid := gen_random_uuid();
  gift uuid := gen_random_uuid();
  ended timestamptz;
  blocked boolean;
  n integer;
begin
  perform set_config('request.jwt.claims', '', true);

  insert into auth.users (id, email) values
    (lic, 'end-test-lic@example.invalid'),
    (adm, 'end-test-admin@example.invalid');
  insert into public.agencies (id, name, status) values
    (t_agency, 'Subscription end test', 'active'),
    (c_agency, 'Subscription end test comped', 'comped'),
    (p_agency, 'Subscription end test owner', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge) values
    (lic, t_agency, 'Test Licensee', 'end-test-lic@example.invalid', true, true),
    (adm, p_agency, 'Test Owner', 'end-test-admin@example.invalid', true, true);
  update public.profiles set is_platform_admin = true where id = adm;
  insert into public.properties (id, agency_id, created_by, address) values
    (prop, t_agency, lic, '1 Test Street, Testville');
  insert into public.gifts (id, agency_id, profile_id, gift_date, description, value, direction, created_by)
    values (gift, t_agency, lic, current_date, 'Test', 10, 'received', lic);

  -- ── Ending ──────────────────────────────────────────────────────────────
  update public.agencies set status = 'canceled' where id = t_agency;
  select ended_at into ended from public.agencies where id = t_agency;
  if ended is null then raise exception 'FAIL 1: a cancelled agency got no end date'; end if;

  -- ── Never for the protected ones ───────────────────────────────────────
  update public.agencies set status = 'canceled' where id in (cass, comply, c_agency, p_agency);
  if exists (select 1 from public.agencies where id = cass and ended_at is not null) then
    raise exception 'FAIL 2: Cass Property got an end date';
  end if;
  if exists (select 1 from public.agencies where id = comply and ended_at is not null) then
    raise exception 'FAIL 3: Comply Real Estate got an end date';
  end if;
  if exists (select 1 from public.agencies where id = c_agency and ended_at is not null) then
    raise exception 'FAIL 4: a comped agency got an end date';
  end if;
  if exists (select 1 from public.agencies where id = p_agency and ended_at is not null) then
    raise exception 'FAIL 5: the platform owner''s agency got an end date';
  end if;
  -- Even written directly.
  update public.agencies set ended_at = now() where id in (cass, comply);
  if exists (select 1 from public.agencies where id in (cass, comply) and ended_at is not null) then
    raise exception 'FAIL 6: an end date could be written straight onto a protected office';
  end if;

  -- ── As the licensee of the ended agency ─────────────────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);

  begin update public.properties set address = 'Changed' where id = prop; get diagnostics n = row_count;
  exception when others then n := 0; end;
  if n > 0 then raise exception 'FAIL 7: a listing could be changed after the end'; end if;

  begin delete from public.properties where id = prop; get diagnostics n = row_count;
  exception when others then n := 0; end;
  if n > 0 then raise exception 'FAIL 8: a listing could be deleted after the end'; end if;

  begin update public.gifts set value = 20 where id = gift; get diagnostics n = row_count;
  exception when others then n := 0; end;
  if n > 0 then raise exception 'FAIL 9: a register entry could be changed after the end'; end if;

  begin
    insert into public.complaints (agency_id, received_date, complainant, nature, created_by)
      values (t_agency, current_date, 'Test', 'Test', lic);
    get diagnostics n = row_count;
  exception when others then n := 0; end;
  if n > 0 then raise exception 'FAIL 10: a register entry could be added after the end'; end if;

  begin update public.profiles set full_name = 'Changed' where id = lic; get diagnostics n = row_count;
  exception when others then n := 0; end;
  if n > 0 then raise exception 'FAIL 11: the team could be changed after the end'; end if;

  blocked := false;
  begin
    insert into storage.objects (bucket_id, name, owner)
      values ('compliance-evidence', t_agency::text || '/test/after-end.pdf', lic);
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL 12: a file could be uploaded after the end'; end if;

  blocked := false;
  begin update public.agencies set ended_at = null where id = t_agency;
  exception when others then blocked := true; end;
  if not blocked and exists (select 1 from public.agencies where id = t_agency and ended_at is null) then
    raise exception 'FAIL 13: the agency could clear its own end date';
  end if;

  -- ── As the anonymous sign-off link ─────────────────────────────────────
  -- The sign-off link writes through security-definer functions, which run
  -- as their owner with the caller's 'anon' token. Same here.
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin update public.properties set address = 'Changed by link' where id = prop; get diagnostics n = row_count;
  exception when others then n := 0; end;
  if n > 0 then raise exception 'FAIL 14: the anonymous sign-off route could write after the end'; end if;

  -- ── Reactivation lifts it ───────────────────────────────────────────────
  perform set_config('request.jwt.claims', '', true);
  update public.agencies set status = 'active' where id = t_agency;
  if exists (select 1 from public.agencies where id = t_agency and ended_at is not null) then
    raise exception 'FAIL 15: reactivating did not clear the end date';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  begin update public.properties set address = 'Changed after reactivation' where id = prop;
    get diagnostics n = row_count;
  exception when others then raise exception 'FAIL 16: still blocked after reactivating: %', sqlerrm; end;
  if n <> 1 then raise exception 'FAIL 16: the listing could not be changed after reactivating'; end if;
  reset role;
end
$$;

rollback;

select 'Subscription end: all checks passed' as result;
