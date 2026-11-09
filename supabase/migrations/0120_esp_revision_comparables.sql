-- ===== 0120: Each ESP revision's own comparable sales =====
--
-- NSW underquoting changes, from 17 November 2026 (Adam, 9 Nov 2026: "go
-- ahead with comparables per revision"; Master, 9 Nov 2026: each revision's
-- own comparable sales, and why any new one wasn't used before).
--
-- Reg s12G(1): the record of a revised ESP keeps
--   (a) each comparable property (address, date sold, sold price), how they
--       were identified and the comparison factors considered, why the 3 are
--       the most comparable, and the information used and its source,
--   (c) for a sold price taken into account now but not for the previous
--       ESP, why it wasn't taken into account then,
--   (d) if fewer than 3 are comparable, why.
--
-- WAS: a revision kept its figures, notice, evidence and market feedback
-- (0110, 0117). Its comparable sales were not kept with it: the listing has
-- one list of comparable sales, for the ESP worked out at the start.
-- NOW: each revision also keeps, fixed once recorded like the rest of it,
--   * the comparable sales taken into account for it: a list, each with its
--     address, date sold, sold price, distance, whether it is one of the 3
--     most comparable and why, the comparison factors weighed, and for one
--     not taken into account for the previous ESP, why not,
--   * the information used and where it came from,
--   * why fewer than 3 are comparable, when that is so.
-- Revisions already recorded keep everything they have; these stay empty.
--
-- record_esp_revision gets a third form with the new things (0110's and
-- 0117's forms stay, so the app as it is today keeps working until this
-- merges). No new table; the table's grants are restated. Safe to run twice.

begin;

-- ── 1. The new columns ───────────────────────────────────────────────────
alter table public.esp_revisions add column if not exists comparables jsonb not null default '[]'::jsonb;
alter table public.esp_revisions add column if not exists comparables_info_used text;
alter table public.esp_revisions add column if not exists comparables_fewer_reason text;

alter table public.esp_revisions drop constraint if exists esp_revisions_comparables_list;
alter table public.esp_revisions add constraint esp_revisions_comparables_list
  check (jsonb_typeof(comparables) = 'array' and jsonb_array_length(comparables) <= 60);
alter table public.esp_revisions drop constraint if exists esp_revisions_comparables_text;
alter table public.esp_revisions add constraint esp_revisions_comparables_text
  check (coalesce(length(comparables_info_used), 0) <= 4000 and coalesce(length(comparables_fewer_reason), 0) <= 4000);

comment on column public.esp_revisions.comparables is
  'The comparable sales taken into account for this revision (Reg s12G(1)(a), (c); 0120): a list, fixed once recorded.';
comment on column public.esp_revisions.comparables_info_used is
  'The information used for the comparable sales, and where it came from (Reg s12G(1)(a)(iv); 0120).';
comment on column public.esp_revisions.comparables_fewer_reason is
  'Why fewer than 3 are comparable, when that is so (Reg s12G(1)(d); 0120).';

-- Data API grants, restated (Adam's rule: grants with every change to a
-- table). The office reads and adds; nobody changes or deletes.
revoke all on table public.esp_revisions from public, anon, authenticated;
grant select, insert on public.esp_revisions to authenticated;
grant select, insert, update, delete on public.esp_revisions to service_role;

-- ── 2. Recording a revision, with its comparable sales ───────────────────
-- 0117's record_esp_revision, word for word, with the comparable sales, the
-- information used and the fewer-than-3 reason added (marked 0120). A third
-- form beside 0110's and 0117's: no defaults, so a call names one of them.
create or replace function public.record_esp_revision(
  p_property_id uuid,
  p_low numeric,
  p_high numeric,
  p_given_on date,
  p_notice_path text,
  p_notice_file_name text,
  p_entered_manually boolean,
  p_method text,
  p_reason text,
  p_card jsonb,
  p_status text,
  p_previous_low numeric,
  p_previous_high numeric,
  p_evidence_path text,
  p_evidence_file_name text,
  p_evidence_in_notice boolean,
  p_market_feedback jsonb,
  p_comparables jsonb,
  p_comparables_info_used text,
  p_comparables_fewer_reason text)
returns integer
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_agency uuid;
  v_no integer;
  v_rows integer;
  v_latest jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in again to record the revision.' using errcode = '42501';
  end if;
  select p.agency_id into v_agency from public.properties p
   where p.id = p_property_id and p.agency_id = public.current_agency_id();
  if v_agency is null or not public.can_see_property(p_property_id) then
    raise exception 'This listing isn''t one you can work on.' using errcode = '42501';
  end if;
  if p_status not in ('open', 'done') then
    raise exception 'Unknown status.' using errcode = 'P0001';
  end if;
  if p_low is null or p_high is null or p_low <= 0 or p_high <= 0 then
    raise exception 'Put in both figures from the notice.' using errcode = 'P0001';
  end if;
  if p_notice_path is null or not starts_with(p_notice_path, v_agency::text || '/' || p_property_id::text || '/d3/') then
    raise exception 'Upload the notice you gave the seller first.' using errcode = 'P0001';
  end if;
  -- 0117: the ESP before the revision, both figures or neither.
  if (p_previous_low is null) <> (p_previous_high is null)
     or coalesce(p_previous_low, 1) <= 0 or coalesce(p_previous_high, 1) <= 0 then
    raise exception 'Put in both figures for the ESP before the revision, or neither.' using errcode = 'P0001';
  end if;
  -- 0117: the evidence, in the listing's own folder.
  if p_evidence_path is not null
     and not starts_with(p_evidence_path, v_agency::text || '/' || p_property_id::text || '/d3/') then
    raise exception 'Upload the evidence again.' using errcode = 'P0001';
  end if;
  if p_market_feedback is not null and jsonb_typeof(p_market_feedback) <> 'array' then
    raise exception 'Market feedback has to be a list.' using errcode = 'P0001';
  end if;
  -- 0120: the comparable sales, a list; no more than 3 of them the most comparable.
  if p_comparables is not null and jsonb_typeof(p_comparables) <> 'array' then
    raise exception 'The comparable sales have to be a list.' using errcode = 'P0001';
  end if;
  if (select count(*) from jsonb_array_elements(coalesce(p_comparables, '[]'::jsonb)) e
       where (e ->> 'most') = 'true') > 3 then
    raise exception 'Only 3 sales can be marked as the most comparable.' using errcode = 'P0001';
  end if;

  insert into public.esp_revisions
    (agency_id, property_id, esp_low, esp_high, notice_given_on, notice_path, notice_file_name,
     entered_manually, method_of_service, reason,
     previous_esp_low, previous_esp_high, evidence_path, evidence_file_name, evidence_in_notice, market_feedback,
     comparables, comparables_info_used, comparables_fewer_reason)
  values
    (v_agency, p_property_id, p_low, p_high, p_given_on, p_notice_path, nullif(btrim(coalesce(p_notice_file_name, '')), ''),
     coalesce(p_entered_manually, false), nullif(btrim(coalesce(p_method, '')), ''), nullif(btrim(coalesce(p_reason, '')), ''),
     p_previous_low, p_previous_high, p_evidence_path, nullif(btrim(coalesce(p_evidence_file_name, '')), ''),
     coalesce(p_evidence_in_notice, false), coalesce(p_market_feedback, '[]'::jsonb),
     coalesce(p_comparables, '[]'::jsonb), nullif(btrim(coalesce(p_comparables_info_used, '')), ''),
     nullif(btrim(coalesce(p_comparables_fewer_reason, '')), ''))
  returning revision_no into v_no;

  v_latest := jsonb_build_object(
    'espRevised', true,
    'revisedEspLow', p_low,
    'revisedEspHigh', p_high,
    'noticeServedOn', p_given_on,
    'methodOfService', nullif(btrim(coalesce(p_method, '')), ''),
    'reason', nullif(btrim(coalesce(p_reason, '')), ''),
    'evidenceFileName', nullif(btrim(coalesce(p_notice_file_name, '')), ''),
    'enteredManually', coalesce(p_entered_manually, false),
    'latestRevision', v_no);

  update public.property_items
     set evidence_path = p_notice_path,
         status = p_status,
         completed_by = case when p_status = 'done' then auth.uid() end,
         data = (coalesce(data, '{}'::jsonb)
                  - array['pending', 'noticeReadFailed', 'noticeReadFailedReason', 'noticeReadAttemptedAt',
                          'noticeNotRecognised', 'enteredManuallyAt'])
                || coalesce(p_card, '{}'::jsonb) || v_latest
   where property_id = p_property_id and item_key = 'd3';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    insert into public.property_items (agency_id, property_id, item_key, status, data, evidence_path, completed_by)
    values (v_agency, p_property_id, 'd3', p_status, coalesce(p_card, '{}'::jsonb) || v_latest, p_notice_path,
            case when p_status = 'done' then auth.uid() end);
  end if;
  return v_no;
end
$$;
revoke execute on function public.record_esp_revision(
  uuid, numeric, numeric, date, text, text, boolean, text, text, jsonb, text,
  numeric, numeric, text, text, boolean, jsonb, jsonb, text, text) from public, anon;
grant execute on function public.record_esp_revision(
  uuid, numeric, numeric, date, text, text, boolean, text, text, jsonb, text,
  numeric, numeric, text, text, boolean, jsonb, jsonb, text, text) to authenticated, service_role;

commit;

-- ── Check ──────────────────────────────────────────────────────────────
-- One row, every value true.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'esp_revisions'
      and column_name in ('comparables', 'comparables_info_used', 'comparables_fewer_reason')) = 3 as columns_added,
  to_regprocedure('public.record_esp_revision(uuid, numeric, numeric, date, text, text, boolean, text, text, jsonb, text, numeric, numeric, text, text, boolean, jsonb, jsonb, text, text)') is not null
    as new_form_added,
  to_regprocedure('public.record_esp_revision(uuid, numeric, numeric, date, text, text, boolean, text, text, jsonb, text, numeric, numeric, text, text, boolean, jsonb)') is not null
    as old_form_kept,
  has_function_privilege('authenticated',
    'public.record_esp_revision(uuid, numeric, numeric, date, text, text, boolean, text, text, jsonb, text, numeric, numeric, text, text, boolean, jsonb, jsonb, text, text)', 'execute')
    and not has_function_privilege('anon',
    'public.record_esp_revision(uuid, numeric, numeric, date, text, text, boolean, text, text, jsonb, text, numeric, numeric, text, text, boolean, jsonb, jsonb, text, text)', 'execute')
    as new_form_grants,
  has_table_privilege('authenticated', 'public.esp_revisions', 'select')
    and has_table_privilege('authenticated', 'public.esp_revisions', 'insert')
    and not has_table_privilege('authenticated', 'public.esp_revisions', 'update')
    and not has_table_privilege('authenticated', 'public.esp_revisions', 'delete') as table_grants,
  (select count(*) from public.esp_revisions where jsonb_typeof(comparables) <> 'array') = 0 as comparables_lists;
