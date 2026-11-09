-- ===== READ ONLY. Statements of information and their link, 9 November 2026 =====
--
-- Proves supabase/migrations/0121_statements_of_information.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up offices, people and listings it
-- creates never exist outside it.
--
-- It checks the 8 February 2027 switch is off first, then switches it on
-- inside the transaction (made-up offices only) to check the rest.
--
-- Pass: the last line says "Statements of information: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1  uuid := gen_random_uuid();  -- the office
  o2  uuid := gen_random_uuid();  -- another office
  a   uuid := gen_random_uuid();  -- o1's agent
  b   uuid := gen_random_uuid();  -- o2's agent
  p1  uuid;
  p2  uuid;
  p3  uuid;  -- agreement signed 7 February 2027: never gets it
  n   integer;
  r   record;
  t   text;
  folder text;
begin
  insert into auth.users (id, email) values (a, 'soi-a@example.invalid'), (b, 'soi-b@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'SOI Office (made up)', 'office_1', 'active', 'Lou Licensee', 'soi-lou@example.invalid'),
    (o2, 'Other Office (made up)', 'office_1', 'active', 'Oli Licensee', 'soi-oli@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (a, o1, 'Ana Agent', 'soi-a@example.invalid', true, false, false),
    (b, o2, 'Ben Agent', 'soi-b@example.invalid', true, false, false);
  insert into public.properties (agency_id, created_by, address) values (o1, a, '12 Harbour Street (made up)') returning id into p1;
  insert into public.properties (agency_id, created_by, address) values (o1, a, '3 Quiet Lane (made up)') returning id into p2;
  insert into public.properties (agency_id, created_by, address) values (o1, a, '5 Early Road (made up)') returning id into p3;
  insert into public.property_items (agency_id, property_id, item_key, status, event_date) values
    (o1, p1, 'a3', 'done', date '2027-02-10'),
    (o1, p2, 'a3', 'done', date '2027-02-10'),
    (o1, p3, 'a3', 'done', date '2027-02-07');
  folder := o1::text || '/' || p1::text || '/soi/';

  -- 0. Switched off until midnight Sydney on 8 February 2027: nothing can be added.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.statements_of_information (agency_id, property_id, source, pdf_path, content)
    values (o1, p1, 'realcomply', folder || '0.pdf', '{}');
    raise exception 'FAIL 0a: a version was added before 8 February 2027';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%starts on 8 February 2027%' then raise exception 'FAIL 0a: refused with %', sqlerrm; end if;
  end;
  begin
    insert into public.statement_of_information_links (property_id, agency_id) values (p1, o1);
    raise exception 'FAIL 0b: a link was switched on before 8 February 2027';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%starts on 8 February 2027%' then raise exception 'FAIL 0b: refused with %', sqlerrm; end if;
  end;
  reset role;

  -- The switch on, for the rest of this rolled-back test.
  execute $q$create or replace function public.soi_starts_at() returns timestamptz language plpgsql stable
    set search_path = public as $f$ begin return now() - interval '1 day'; end $f$ $q$;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. The agent adds one RealComply made: numbered 1, stamped with who.
  insert into public.statements_of_information (agency_id, property_id, version_no, source, pdf_path, content, esp_revision_no, prepared_by, prepared_by_name)
  values (o1, p1, 99, 'realcomply', folder || '1-soi.pdf', '{"address": "12 Harbour Street (made up)"}', 0, b, 'Someone Else');
  select * into r from public.statements_of_information where property_id = p1;
  if r.version_no <> 1 or r.prepared_by <> a or r.prepared_by_name <> 'Ana Agent'
     or r.prepared_on <> (now() at time zone 'Australia/Sydney')::date then
    raise exception 'FAIL 1: kept as %', row_to_json(r); end if;

  -- 2. One uploaded, with the date it was prepared: numbered 2.
  insert into public.statements_of_information (agency_id, property_id, source, pdf_path, file_name, esp_revision_no, prepared_on)
  values (o1, p1, 'uploaded', folder || '2-theirs.pdf', 'Their SOI.pdf', 0, current_date - 3);
  select max(version_no) into n from public.statements_of_information where property_id = p1;
  if n <> 2 then raise exception 'FAIL 2: numbered %', n; end if;

  -- 3. Refused: a file outside the listing's soi folder, one made with nothing
  --    in it, a date in the future.
  begin
    insert into public.statements_of_information (agency_id, property_id, source, pdf_path) values (o1, p1, 'uploaded', o1::text || '/' || p1::text || '/a3/x.pdf');
    raise exception 'FAIL 3a: a file outside the folder was taken';
  exception when check_violation then null;
  end;
  begin
    insert into public.statements_of_information (agency_id, property_id, source, pdf_path) values (o1, p1, 'realcomply', folder || 'x.pdf');
    raise exception 'FAIL 3b: one made with nothing in it was taken';
  exception when check_violation then null;
  end;
  begin
    insert into public.statements_of_information (agency_id, property_id, source, pdf_path, prepared_on) values (o1, p1, 'uploaded', folder || 'x.pdf', current_date + 5);
    raise exception 'FAIL 3c: a date in the future was taken';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%future%' then raise exception 'FAIL 3c: refused with %', sqlerrm; end if;
  end;

  -- 3d. A listing whose agreement was signed before 8 February 2027 never gets it.
  begin
    insert into public.statements_of_information (agency_id, property_id, source, pdf_path)
    values (o1, p3, 'uploaded', o1::text || '/' || p3::text || '/soi/x.pdf');
    raise exception 'FAIL 3d: a listing signed before 8 February 2027 took one';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%starts on 8 February 2027%' then raise exception 'FAIL 3d: refused with %', sqlerrm; end if;
  end;

  -- 4. Never changed or deleted.
  begin
    update public.statements_of_information set file_name = 'changed' where property_id = p1;
    raise exception 'FAIL 4a: a version was changed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.statements_of_information where property_id = p1;
    raise exception 'FAIL 4b: a version was deleted';
  exception when insufficient_privilege then null;
  end;

  -- 5. The link: the database makes it, whatever the agent sends, and stamps who.
  insert into public.statement_of_information_links (property_id, agency_id, token)
  values (p1, o1, repeat('a', 64));
  select * into r from public.statement_of_information_links where property_id = p1;
  if r.token = repeat('a', 64) or r.token !~ '^[0-9a-f]{64}$' or not r.enabled or r.changed_by <> a or r.changed_by_name <> 'Ana Agent' then
    raise exception 'FAIL 5: link kept as %', row_to_json(r); end if;
  t := r.token;
  begin
    update public.statement_of_information_links set token = repeat('b', 64) where property_id = p1;
    raise exception 'FAIL 5b: the link was changed';
  exception when insufficient_privilege then null;
  end;

  -- 6. Not switched on before there's a statement.
  begin
    insert into public.statement_of_information_links (property_id, agency_id) values (p2, o1);
    raise exception 'FAIL 6: switched on with no statement';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'Make or upload%' then raise exception 'FAIL 6: refused with %', sqlerrm; end if;
  end;
  insert into public.statement_of_information_links (property_id, agency_id, enabled) values (p2, o1, false);
  reset role;

  -- 7. Anyone with the link sees the current version's file, and nothing else.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  select count(*) into n from public.statement_of_information_public(t);
  select pdf_path into r from public.statement_of_information_public(t);
  if n <> 1 or r.pdf_path <> folder || '2-theirs.pdf' then raise exception 'FAIL 7: the link gave %', row_to_json(r); end if;
  select count(*) into n from public.statement_of_information_public(repeat('c', 64));
  if n <> 0 then raise exception 'FAIL 7b: a made-up link gave a file'; end if;
  select count(*) into n from public.statement_of_information_public('x'' or 1=1');
  if n <> 0 then raise exception 'FAIL 7c: a malformed link gave a file'; end if;
  begin
    perform 1 from public.statements_of_information;
    raise exception 'FAIL 7d: anonymous read the versions';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.statement_of_information_links;
    raise exception 'FAIL 7e: anonymous read the links';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 8. Switched off: nothing. Back on: the same link works again.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.statement_of_information_links set enabled = false where property_id = p1;
  reset role;
  select count(*) into n from public.statement_of_information_public(t);
  if n <> 0 then raise exception 'FAIL 8a: a switched-off link gave a file'; end if;
  set local role authenticated;
  update public.statement_of_information_links set enabled = true where property_id = p1;
  reset role;
  select count(*) into n from public.statement_of_information_public(t);
  if n <> 1 then raise exception 'FAIL 8b: switched back on, the link gave nothing'; end if;

  -- 9. Another office sees neither.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.statements_of_information where property_id = p1;
  if n <> 0 then raise exception 'FAIL 9a: another office saw % versions', n; end if;
  select count(*) into n from public.statement_of_information_links where property_id = p1;
  if n <> 0 then raise exception 'FAIL 9b: another office saw the link'; end if;
  update public.statement_of_information_links set enabled = false where property_id = p1;
  reset role;
  select count(*) into n from public.statement_of_information_links where property_id = p1 and enabled;
  if n <> 1 then raise exception 'FAIL 9c: another office switched the link off'; end if;

  -- 10. Withdrawn from sale: the link stops, and can't be switched on; put back, it works again.
  insert into public.listing_withdrawals (agency_id, property_id, withdrawn_on, reason, withdrawn_by)
  values (o1, p1, current_date, 'seller_changed_mind', a);
  select count(*) into n from public.statement_of_information_public(t);
  if n <> 0 then raise exception 'FAIL 10a: a withdrawn listing''s link gave a file'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.statement_of_information_links set enabled = false where property_id = p1;  -- switching off is always allowed
  begin
    update public.statement_of_information_links set enabled = true where property_id = p1;
    raise exception 'FAIL 10b: switched on while withdrawn';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    insert into public.statements_of_information (agency_id, property_id, source, pdf_path) values (o1, p1, 'uploaded', folder || '3.pdf');
    raise exception 'FAIL 10c: a version was added while withdrawn';
  exception when sqlstate 'P0001' then null;
  end;
  reset role;
  update public.listing_withdrawals set put_back_at = now(), put_back_by = a where property_id = p1;
  update public.statement_of_information_links set enabled = true where property_id = p1;
  select count(*) into n from public.statement_of_information_public(t);
  if n <> 1 then raise exception 'FAIL 10d: put back, the link gave nothing'; end if;

  -- 11. Settled: the link stops.
  update public.properties set stage = 5 where id = p1;
  select count(*) into n from public.statement_of_information_public(t);
  if n <> 0 then raise exception 'FAIL 11: a Settled listing''s link gave a file'; end if;
  update public.properties set stage = 0 where id = p1;

  -- 12. Signed off: the link stops, and no new version.
  insert into public.property_items (agency_id, property_id, item_key, status, data) values (o1, p1, 'sign_licensee', 'done', '{}');
  select count(*) into n from public.statement_of_information_public(t);
  if n <> 0 then raise exception 'FAIL 12a: a signed-off listing''s link gave a file'; end if;
  set local role authenticated;
  begin
    insert into public.statements_of_information (agency_id, property_id, source, pdf_path) values (o1, p1, 'uploaded', folder || '3.pdf');
    raise exception 'FAIL 12b: a version was added to a signed-off file';
  exception when sqlstate 'P0001' then null;
  end;
  reset role;
  delete from public.property_items where property_id = p1 and item_key = 'sign_licensee';

  -- 12b. Switched off again: the link shows nothing; back on, it works.
  execute $q$create or replace function public.soi_starts_at() returns timestamptz language plpgsql stable
    set search_path = public as $f$ begin return timestamptz '2027-02-08 00:00:00+11'; end $f$ $q$;
  select count(*) into n from public.statement_of_information_public(t);
  if n <> 0 then raise exception 'FAIL 12b: the link gave a file before 8 February 2027'; end if;
  execute $q$create or replace function public.soi_starts_at() returns timestamptz language plpgsql stable
    set search_path = public as $f$ begin return now() - interval '1 day'; end $f$ $q$;
  select count(*) into n from public.statement_of_information_public(t);
  if n <> 1 then raise exception 'FAIL 12c: switched back on, the link gave nothing'; end if;

  -- 13. The office's subscription ended: the link stops.
  perform set_config('request.jwt.claims', '', true);
  update public.agencies set status = 'canceled' where id = o1;
  select count(*) into n from public.statement_of_information_public(t);
  if n <> 0 then raise exception 'FAIL 13: an ended office''s link gave a file'; end if;

  raise notice 'Statements of information: all checks passed';
end $$;

rollback;
