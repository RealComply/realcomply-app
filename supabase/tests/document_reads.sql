-- ===== READ ONLY. The record of document reads and the same-day alert, 1 November 2026 =====
--
-- Proves supabase/migrations/0103_document_reads.sql: every read is recorded
-- through note_document_read(), an alert is due for a failed read or a
-- comparable-sales report with 0 comparables, at most once per listing per
-- day (per office and kind of document for a read that isn't on a listing),
-- and nobody signed in reaches the two tables directly. Run after it. Safe on
-- the live database: everything happens inside one transaction that is rolled
-- back at the end, so the made-up offices and people never exist outside it.
--
-- Pass: the last line says "Document reads: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1 uuid := gen_random_uuid();   -- an office
  o2 uuid := gen_random_uuid();   -- another office
  l   uuid := gen_random_uuid();  -- o1's licensee in charge
  a   uuid := gen_random_uuid();  -- an agent in o1
  b   uuid := gen_random_uuid();  -- another agent in o1
  x   uuid := gen_random_uuid();  -- o2's licensee in charge
  p1  uuid := gen_random_uuid();  -- the agent's listing
  p2  uuid := gen_random_uuid();  -- another listing of the agent's
  pb  uuid := gen_random_uuid();  -- the other agent's listing (the agent can't open it)
  p9  uuid := gen_random_uuid();  -- a listing in o2
  r jsonb;
  n integer;
  failed boolean;
begin
  insert into auth.users (id, email) values
    (l, 'dr-l@example.invalid'), (a, 'dr-a@example.invalid'), (b, 'dr-b@example.invalid'), (x, 'dr-x@example.invalid');
  insert into public.agencies (id, name, plan, status) values
    (o1, 'DR Office One (made up)', 'office_1', 'active'),
    (o2, 'DR Office Two (made up)', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (l, o1, 'Lee Licensee', 'dr-l@example.invalid', true, true, false),
    (a, o1, 'Ana Agent', 'dr-a@example.invalid', true, false, false),
    (b, o1, 'Ben Agent', 'dr-b@example.invalid', true, false, false),
    (x, o2, 'Xan Elsewhere', 'dr-x@example.invalid', true, true, false);
  insert into public.properties (id, agency_id, created_by, address) values
    (p1, o1, a, '1 Made Up Street, Nowhere NSW (made up)'),
    (p2, o1, a, '2 Made Up Street, Nowhere NSW (made up)'),
    (pb, o1, b, '3 Made Up Street, Nowhere NSW (made up)'),
    (p9, o2, x, '9 Made Up Street, Elsewhere NSW (made up)');

  -- Everything below is the agent, signed in.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. A read that went well: recorded, no alert.
  r := public.note_document_read('contract', 'read', null, p1, null);
  if r <> '{"alert": false}'::jsonb then raise exception 'Check 1 failed: a good read asked for an alert: %', r; end if;

  -- 2. The comparable-sales report cut off at the limit: recorded, alert due,
  --    with the office's name and the listing's address for the email.
  r := public.note_document_read('comparable_sales', 'failed', 'cut_off', p1, null);
  if not (r ->> 'alert')::boolean
     or r ->> 'office' <> 'DR Office One (made up)'
     or r ->> 'listing' <> '1 Made Up Street, Nowhere NSW (made up)' then
    raise exception 'Check 2 failed: a cut-off read did not ask for an alert with office and listing: %', r;
  end if;

  -- 3. Another failure on the same listing the same day: recorded, no second email.
  r := public.note_document_read('contract', 'failed', 'service', p1, null);
  if (r ->> 'alert')::boolean then raise exception 'Check 3 failed: a second alert for the same listing the same day'; end if;

  -- 4. A comparable-sales report read to the end with 0 comparables: alert
  --    (another listing). With sales found: no alert.
  r := public.note_document_read('comparable_sales', 'nothing_found', null, p2, 0);
  if not (r ->> 'alert')::boolean then raise exception 'Check 4 failed: 0 comparables did not ask for an alert'; end if;
  r := public.note_document_read('comparable_sales', 'read', null, p2, 27);
  if (r ->> 'alert')::boolean then raise exception 'Check 4 failed: 27 comparables asked for an alert'; end if;

  -- 5. A read that isn't on a listing: one alert per office, per kind of
  --    document, per day. A CPD failure alerts; a second doesn't; a licence
  --    failure does.
  r := public.note_document_read('cpd_certificate', 'failed', 'cut_off', null, null);
  if not (r ->> 'alert')::boolean or r ->> 'office' <> 'DR Office One (made up)' or r ? 'listing' and r ->> 'listing' is not null then
    raise exception 'Check 5 failed: a CPD read failure: %', r;
  end if;
  r := public.note_document_read('cpd_certificate', 'failed', 'service', null, null);
  if (r ->> 'alert')::boolean then raise exception 'Check 5 failed: a second CPD alert the same day'; end if;
  r := public.note_document_read('licence', 'failed', 'unparseable', null, null);
  if not (r ->> 'alert')::boolean then raise exception 'Check 5 failed: a licence failure after a CPD one did not alert'; end if;

  -- 6. Not a listing they can open: refused, nothing recorded. Another
  --    office's listing, and a listing in their own office they can't open.
  failed := false;
  begin
    perform public.note_document_read('contract', 'failed', 'cut_off', p9, null);
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'Check 6 failed: recorded a read on another office''s listing'; end if;
  failed := false;
  begin
    perform public.note_document_read('contract', 'failed', 'cut_off', pb, null);
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'Check 6 failed: recorded a read on a listing the agent can''t open'; end if;

  -- 7. Nobody signed in reaches the tables directly: not to read, not to
  --    add a read, not to claim an alert.
  failed := false;
  begin
    perform 1 from public.document_reads;
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'Check 7 failed: a signed-in person read document_reads'; end if;
  failed := false;
  begin
    insert into public.document_reads (agency_id, reader, outcome) values (o1, 'contract', 'read');
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'Check 7 failed: a signed-in person added a read directly'; end if;
  failed := false;
  begin
    insert into public.reader_alerts (alert_key, agency_id) values ('listing:x:2026-11-01', o1);
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'Check 7 failed: a signed-in person claimed an alert directly'; end if;

  -- 8. A made-up reader or outcome is refused.
  failed := false;
  begin
    perform public.note_document_read('Comparable Sales!', 'read', null, p1, null);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'Check 8 failed: a reader name with capitals and punctuation was taken'; end if;
  failed := false;
  begin
    perform public.note_document_read('contract', 'great', null, p1, null);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'Check 8 failed: an unknown outcome was taken'; end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- 9. Not signed in: refused.
  set local role anon;
  failed := false;
  begin
    perform public.note_document_read('contract', 'read', null, null, null);
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'Check 9 failed: anon recorded a read'; end if;
  reset role;

  -- 10. What was recorded: 8 reads (checks 1 to 5; nothing from 6 to 9), a
  --     reason on each failed one, the sales kept; and 4 alerts claimed.
  select count(*) into n from public.document_reads where agency_id = o1;
  if n <> 8 then raise exception 'Check 10 failed: % reads recorded, expected 8', n; end if;
  select count(*) into n from public.document_reads where agency_id = o1 and outcome = 'failed' and why is not null;
  if n <> 5 then raise exception 'Check 10 failed: % failed reads with a reason, expected 5', n; end if;
  select count(*) into n from public.document_reads where agency_id = o1 and reader = 'comparable_sales' and sales = 27;
  if n <> 1 then raise exception 'Check 10 failed: the 27 sales were not kept'; end if;
  select count(*) into n from public.reader_alerts where agency_id = o1;
  if n <> 4 then raise exception 'Check 10 failed: % alerts claimed, expected 4', n; end if;
  select count(*) into n from public.document_reads where agency_id = o2;
  if n <> 0 then raise exception 'Check 10 failed: a read recorded against the other office'; end if;

  -- 11. A failed read without a reason is recorded as "other"; a reason given
  --     with a read that didn't fail is left off.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.note_document_read('inspection_report', 'failed', null, p2, null);
  perform public.note_document_read('agency_agreement', 'read', 'cut_off', p1, null);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.document_reads where agency_id = o1 and reader = 'inspection_report' and why = 'other';
  if n <> 1 then raise exception 'Check 11 failed: a failed read with no reason was not recorded as other'; end if;
  select count(*) into n from public.document_reads where agency_id = o1 and reader = 'agency_agreement' and why is null;
  if n <> 1 then raise exception 'Check 11 failed: a reason was kept on a read that didn''t fail'; end if;

  -- 12. Deleting a listing takes its reads and its alert with it; deleting the
  --     office takes the rest.
  delete from public.properties where id = p1;
  select count(*) into n from public.document_reads where property_id = p1;
  if n <> 0 then raise exception 'Check 12 failed: reads kept after their listing was deleted'; end if;
  select count(*) into n from public.reader_alerts where property_id = p1;
  if n <> 0 then raise exception 'Check 12 failed: an alert kept after its listing was deleted'; end if;
  delete from public.agencies where id = o1;
  select count(*) into n from public.document_reads where agency_id = o1;
  if n <> 0 then raise exception 'Check 12 failed: reads kept after the office was deleted'; end if;
  select count(*) into n from public.reader_alerts where agency_id = o1;
  if n <> 0 then raise exception 'Check 12 failed: alerts kept after the office was deleted'; end if;

  raise notice 'Document reads: all checks passed';
end $$;

rollback;

select 'Document reads: all checks passed' as result;
