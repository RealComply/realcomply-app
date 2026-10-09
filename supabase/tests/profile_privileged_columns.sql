-- ===== READ ONLY. Profile role guard test, 9 October 2026 =====
--
-- Proves nobody can change their own role or agency through the app's login,
-- and that the licensee in charge still can manage roles (migration 0057).
-- Safe on the live database: everything happens inside one transaction that is
-- rolled back at the end, so the two made-up agencies and people it creates
-- never exist outside it.
--
-- Pass: the last line says "Profile guard: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  a_agency uuid := gen_random_uuid();
  b_agency uuid := gen_random_uuid();
  lic uuid := gen_random_uuid();   -- licensee in charge of A
  agent uuid := gen_random_uuid(); -- ordinary agent in A
  gone uuid := gen_random_uuid();  -- archived person in A
  blocked boolean;
  r public.profiles%rowtype;
begin
  insert into auth.users (id, email) values
    (lic, 'guard-test-lic@example.invalid'),
    (agent, 'guard-test-agent@example.invalid'),
    (gone, 'guard-test-gone@example.invalid');
  insert into public.agencies (id, name) values
    (a_agency, 'Profile guard test A'),
    (b_agency, 'Profile guard test B');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge) values
    (lic, a_agency, 'Test Licensee', 'guard-test-lic@example.invalid', true),
    (agent, a_agency, 'Test Agent', 'guard-test-agent@example.invalid', false),
    (gone, a_agency, 'Test Gone', 'guard-test-gone@example.invalid', false);
  update public.profiles set archived_at = now() where id = gone;

  -- ── Act as the agent, signed in, through the role the app uses. ──
  perform set_config('request.jwt.claims', json_build_object('sub', agent, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. The agent cannot make themselves platform admin.
  blocked := false;
  begin
    update public.profiles set is_platform_admin = true where id = agent;
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 1: agent made themselves platform admin'; end if;

  -- 2. The agent cannot move themselves into another agency.
  blocked := false;
  begin
    update public.profiles set agency_id = b_agency where id = agent;
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 2: agent moved themselves into another agency'; end if;

  -- 3. The agent cannot make themselves licensee in charge.
  blocked := false;
  begin
    update public.profiles set is_licensee_in_charge = true where id = agent;
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 3: agent made themselves licensee in charge'; end if;

  -- 4. The agent cannot change their own assistant or agent flag, or archive state.
  blocked := false;
  begin
    update public.profiles set is_assistant = true where id = agent;
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 4: agent changed their own assistant flag'; end if;

  blocked := false;
  begin
    update public.profiles set is_agent = false where id = agent;
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 4: agent changed their own agent flag'; end if;

  blocked := false;
  begin
    update public.profiles set archived_at = now(), archived_by = agent where id = agent;
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 4: agent changed their own archive state'; end if;

  -- 5. The agent can still change their own name.
  update public.profiles set full_name = 'Test Agent Renamed' where id = agent;
  select * into r from public.profiles where id = agent;
  if r.full_name is distinct from 'Test Agent Renamed' then
    raise exception 'FAIL 5: agent could not change their own name';
  end if;
  if r.is_platform_admin or r.is_licensee_in_charge or r.is_assistant or not r.is_agent
     or r.archived_at is not null or r.agency_id <> a_agency then
    raise exception 'FAIL 5: a blocked change was saved anyway';
  end if;

  -- ── Act as the archived person. ──
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', gone, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 6. An archived person cannot un-archive themselves.
  blocked := false;
  begin
    update public.profiles set archived_at = null where id = gone;
  exception when others then blocked := true;
  end;
  reset role;
  select * into r from public.profiles where id = gone;
  if not blocked and r.archived_at is null then
    raise exception 'FAIL 6: archived person un-archived themselves';
  end if;

  -- ── Act as the licensee in charge. ──
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 7. The licensee can still manage roles in their own agency.
  update public.profiles set is_assistant = true where id = agent;
  update public.profiles set is_assistant = false, archived_at = now(), archived_by = lic where id = agent;
  select * into r from public.profiles where id = agent;
  if r.archived_at is null or r.archived_by is distinct from lic then
    raise exception 'FAIL 7: licensee could not archive an agent';
  end if;
  update public.profiles set archived_at = null, archived_by = null where id = agent;

  -- 8. Not even the licensee can grant platform admin or move someone's agency.
  blocked := false;
  begin
    update public.profiles set is_platform_admin = true where id = lic;
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 8: licensee made themselves platform admin'; end if;

  blocked := false;
  begin
    update public.profiles set agency_id = b_agency where id = agent;
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'FAIL 8: licensee moved an agent into another agency'; end if;

  -- ── Database functions and the service role are not affected. ──
  reset role;

  -- 9. A change made outside the app's login roles still goes through.
  update public.profiles set is_platform_admin = true where id = agent;
  select * into r from public.profiles where id = agent;
  if not r.is_platform_admin then
    raise exception 'FAIL 9: a database-level change was blocked';
  end if;

  raise notice 'Profile guard: all checks passed';
end
$$;

rollback;
