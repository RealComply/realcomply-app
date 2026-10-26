-- ===== READ ONLY. An office plan run by someone who isn't the licensee in charge, 26 October 2026 =====
--
-- Proves supabase/migrations/0092_licensee_not_on_realcomply.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up offices, people and listings it
-- creates never exist outside it.
--
-- Pass: the last line says "Licensee not on RealComply: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  no_office uuid;                        -- office plan, founder answered "No, someone else"
  yes_office uuid;                       -- office plan, founder answered "Yes, that's me"
  other uuid := gen_random_uuid();       -- an unrelated office
  nf uuid := gen_random_uuid();          -- the founder of no_office
  yf uuid := gen_random_uuid();          -- the founder (licensee) of yes_office
  ya uuid := gen_random_uuid();          -- an agent at yes_office
  five jsonb := '["one","two","three","four","five"]';
  n integer;
  b boolean;
  tok uuid;
  path text;
begin
  insert into auth.users (id, email) values
    (nf, 'lnr-no@example.invalid'), (yf, 'lnr-yes@example.invalid'), (ya, 'lnr-agent@example.invalid');
  insert into public.founder_invites (token, label) values ('lnr-no-token', 'LNR no'), ('lnr-yes-token', 'LNR yes');
  insert into public.agencies (id, name, plan, status) values (other, 'LNR Other', 'office_1', 'active');

  -- 1. Sign-up, through the sign-up function, one answer each.
  perform set_config('request.jwt.claims', json_build_object('sub', nf, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.bootstrap_agency_v3('LNR No Office', 'LNR Founder', false, 'lnr-no-token');
  perform set_config('request.jwt.claims', json_build_object('sub', yf, 'role', 'authenticated')::text, true);
  perform public.bootstrap_agency_v3('LNR Yes Office', 'LNR Licensee', true, 'lnr-yes-token');
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select agency_id into no_office from public.profiles where id = nf;
  select agency_id into yes_office from public.profiles where id = yf;
  select licensee_not_on_realcomply into b from public.agencies where id = no_office;
  if b is distinct from true then raise exception 'FAIL 1: a "No" at sign-up did not mark the office'; end if;
  select licensee_not_on_realcomply into b from public.agencies where id = yes_office;
  if b is distinct from false then raise exception 'FAIL 1b: a "Yes" office was marked'; end if;
  -- The plan chosen after sign-up (an office plan), the trial started, and the
  -- licensee's details from the form, as RealComply and the app write them.
  update public.agencies set plan = 'office_1', status = 'active', annexure_gate = true where id in (no_office, yes_office);
  update public.agencies set licensee_name = 'Vic Made-Up', licensee_email = 'lnr-vic@example.invalid' where id = no_office;
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent)
  values (ya, yes_office, 'LNR Agent', 'lnr-agent@example.invalid', false, false, true);

  -- 2. The founder of the "No" office acts as the licensee, as an agent on
  --    their own plan does. In the "Yes" office, only the licensee does.
  perform set_config('request.jwt.claims', json_build_object('sub', nf, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.acts_as_licensee() then raise exception 'FAIL 2: the founder does not act as the licensee'; end if;
  if public.is_office_licensee() then raise exception 'FAIL 2b: the founder counts as an office''s licensee in charge'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ya, 'role', 'authenticated')::text, true);
  if public.acts_as_licensee() then raise exception 'FAIL 2c: an agent in a "Yes" office acts as the licensee'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', yf, 'role', 'authenticated')::text, true);
  if not public.acts_as_licensee() then raise exception 'FAIL 2d: the licensee of a "Yes" office does not act as the licensee'; end if;

  -- 3. Nobody signed in sets the marker by hand, either way.
  perform set_config('request.jwt.claims', json_build_object('sub', nf, 'role', 'authenticated')::text, true);
  begin
    update public.agencies set licensee_not_on_realcomply = false where id = no_office;
    raise exception 'FAIL 3: the founder turned the marker off';
  exception when check_violation then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', yf, 'role', 'authenticated')::text, true);
  begin
    update public.agencies set licensee_not_on_realcomply = true where id = yes_office;
    raise exception 'FAIL 3b: a licensee turned the marker on';
  exception when check_violation then null;
  end;

  -- 4. The annexure, the single agent way. The first listing is free; the
  --    second waits for the licensee's signed page, not an office adoption.
  perform set_config('request.jwt.claims', json_build_object('sub', nf, 'role', 'authenticated')::text, true);
  if public.my_listing_gate() is not null then raise exception 'FAIL 4: waiting on the annexure with no listings'; end if;
  insert into public.properties (agency_id, created_by, address) values (no_office, nf, '1 LNR Street');
  if public.my_listing_gate() is distinct from 'signed_annexure' then
    raise exception 'FAIL 4b: after the first listing, not waiting on the signed annexure (got %)', public.my_listing_gate();
  end if;
  -- The acknowledgement, as on an agent plan.
  if public.record_agent_acknowledgement('20111111', 'LNR No Office', 'Vic Made-Up', '20222222', 'LNR Founder', 'v1', five) is null then
    raise exception 'FAIL 4c: the founder could not record the acknowledgement';
  end if;
  -- The signed adoption page, as on an agent plan; the lock lifts.
  reset role;
  path := no_office::text || '/_signoffs/licensee-signed/1-signed.pdf';
  insert into storage.objects (bucket_id, name, metadata)
  values ('compliance-evidence', path, '{"mimetype":"application/pdf","size":120000}');
  set local role authenticated;
  perform public.record_signed_annexure_upload(path, 'signed.pdf');
  if public.my_listing_gate() is not null then raise exception 'FAIL 4d: still locked after the signed annexure'; end if;
  insert into public.properties (agency_id, created_by, address) values (no_office, nf, '2 LNR Street');

  -- 5. No annexure email to a licensee, as on an agent plan; the download
  --    link works instead.
  reset role;
  begin
    insert into public.sg_annexure_links (agency_id, sent_to, created_by) values (no_office, 'lnr-vic@example.invalid', nf);
    raise exception 'FAIL 5: an annexure email link was made for the office';
  exception when raise_exception then null;
  end;
  select annexure_download_token into tok from public.agencies where id = no_office;
  select count(*) into n from public.annexure_download_details(tok);
  if n <> 1 then raise exception 'FAIL 5b: the annexure download link does not work for the office'; end if;

  -- 6. Not an "office agent": no office welcome, no read-and-tick.
  perform set_config('request.jwt.claims', json_build_object('sub', nf, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.claim_office_agent_welcome() then raise exception 'FAIL 6: the founder was sent the office agent welcome'; end if;
  begin
    perform public.confirm_sg_read();
    raise exception 'FAIL 6b: the founder was asked to read and tick an office annexure';
  exception when raise_exception then null;
  end;

  -- 7. Their licensee's details are untouched.
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.agencies
   where id = no_office and licensee_name = 'Vic Made-Up' and licensee_email = 'lnr-vic@example.invalid';
  if n <> 1 then raise exception 'FAIL 7: the licensee''s name or email changed'; end if;

  -- 8. The moment someone is an active licensee in charge, the office works
  --    as an office plan again.
  update public.profiles set is_licensee_in_charge = true, licence_type = 'class_1', licence_number = '20333333'
   where id = nf;
  select licensee_not_on_realcomply into b from public.agencies where id = no_office;
  if b is distinct from false then raise exception 'FAIL 8: a licensee in charge did not clear the marker'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', nf, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.is_office_licensee() then raise exception 'FAIL 8b: the new licensee in charge is not the office''s licensee'; end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- 9. RealComply (the SQL editor) can set it, as 0092 does for the offices in this state.
  update public.agencies set licensee_not_on_realcomply = true where id = other;
  select licensee_not_on_realcomply into b from public.agencies where id = other;
  if b is distinct from true then raise exception 'FAIL 9: the SQL editor could not set the marker'; end if;

  raise notice 'Licensee not on RealComply: all checks passed';
end
$$;

rollback;
