-- ===== READ ONLY. Each ESP revision's own comparable sales, 9 November 2026 =====
--
-- Proves supabase/migrations/0120_esp_revision_comparables.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up office, people and listing it
-- creates never exist outside it.
--
-- Pass: the last line says "ESP revision comparables: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  o1  uuid := gen_random_uuid();  -- the office
  a   uuid := gen_random_uuid();  -- its agent
  p1  uuid;
  n   integer;
  r   record;
  folder text;
  comps jsonb := '[
    {"address": "14 Near Street (made up)", "soldOn": "2026-10-01", "soldPrice": 1250000, "distanceM": 600,
     "most": true, "mostReason": "Same street and layout.", "factors": ["location", "layout"], "notBeforeReason": null},
    {"address": "3 New Avenue (made up)", "soldOn": "2026-11-05", "soldPrice": 1180000, "distanceM": 900,
     "most": true, "mostReason": "Sold this month, same size.", "factors": ["date_sold"],
     "notBeforeReason": "It sold after the first ESP was worked out."}
  ]';
begin
  insert into auth.users (id, email) values (a, 'erc-a@example.invalid');
  insert into public.agencies (id, name, plan, status, licensee_name, licensee_email) values
    (o1, 'ERC Office (made up)', 'office_1', 'active', 'Lou Licensee', 'erc-lou@example.invalid');
  insert into public.profiles (id, agency_id, full_name, email, is_agent, is_licensee_in_charge, is_assistant) values
    (a, o1, 'Ana Agent', 'erc-a@example.invalid', true, false, false);
  insert into public.properties (agency_id, created_by, address) values (o1, a, '12 Harbour Street (made up)') returning id into p1;
  folder := o1::text || '/' || p1::text || '/d3/';
  insert into public.property_items (agency_id, property_id, item_key, status, data) values
    (o1, p1, 'a4', 'done', '{"espLow": 1400000, "espHigh": 1450000}'),
    (o1, p1, 'd3', 'open', '{"espRevised": true}');

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. A revision with its comparable sales, the information used and the fewer-than-3 reason.
  n := public.record_esp_revision(p1, 1300000, 1360000, date '2026-11-20', folder || '1-notice.pdf', 'Notice.pdf',
                                  false, 'Email', 'Buyer feedback', '{}', 'done',
                                  1400000, 1450000, null, null, true, '[]',
                                  comps, 'Comparable-sales report (made up)', 'Only 2 sales within 2 km.');
  if n <> 1 then raise exception 'FAIL 1: numbered %', n; end if;
  select * into r from public.esp_revisions where property_id = p1 and revision_no = 1;
  if jsonb_array_length(r.comparables) <> 2 or r.comparables -> 1 ->> 'notBeforeReason' <> 'It sold after the first ESP was worked out.'
     or r.comparables_info_used <> 'Comparable-sales report (made up)' or r.comparables_fewer_reason <> 'Only 2 sales within 2 km.' then
    raise exception 'FAIL 1b: kept as %', row_to_json(r); end if;

  -- 2. The 0117 form still records a revision, with no comparable sales.
  n := public.record_esp_revision(p1, 1250000, 1300000, date '2026-11-25', folder || '2-notice.pdf', 'Notice 2.pdf',
                                  false, null, null, '{}', 'open',
                                  1300000, 1360000, null, null, true, '[]');
  select * into r from public.esp_revisions where property_id = p1 and revision_no = 2;
  if r.comparables <> '[]'::jsonb or r.comparables_info_used is not null then
    raise exception 'FAIL 2: the 0117 form kept %', row_to_json(r); end if;

  -- 3. Four marked the most comparable, or a list that isn't one: refused.
  begin
    perform public.record_esp_revision(p1, 1200000, 1250000, date '2026-11-28', folder || '3-notice.pdf', 'Notice 3.pdf',
                                       false, null, null, '{}', 'open', 1250000, 1300000, null, null, true, '[]',
                                       comps || comps, null, null);
    raise exception 'FAIL 3a: four most comparable were taken';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'Only 3 sales%' then raise exception 'FAIL 3b: refused with %', sqlerrm; end if;
  end;
  begin
    perform public.record_esp_revision(p1, 1200000, 1250000, date '2026-11-28', folder || '3-notice.pdf', 'Notice 3.pdf',
                                       false, null, null, '{}', 'open', 1250000, 1300000, null, null, true, '[]',
                                       '{"address": "x"}', null, null);
    raise exception 'FAIL 3c: a list that isn''t one was taken';
  exception when sqlstate 'P0001' then null;
  end;

  -- 4. Still no changing a revision once recorded.
  begin
    update public.esp_revisions set comparables = '[]' where property_id = p1 and revision_no = 1;
    raise exception 'FAIL 4: a revision''s comparable sales were changed';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 5. Anonymous can't record one.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin
    perform public.record_esp_revision(p1, 1200000, 1250000, date '2026-11-28', folder || '3-notice.pdf', 'Notice 3.pdf',
                                       false, null, null, '{}', 'open', 1250000, 1300000, null, null, true, '[]', '[]', null, null);
    raise exception 'FAIL 5: anonymous recorded a revision';
  exception when insufficient_privilege then null;
  end;
  reset role;

  raise notice 'ESP revision comparables: all checks passed';
end $$;

rollback;
