-- ===== 0117: Each ESP revision: the ESP before it, its evidence, and market feedback =====
--
-- NSW underquoting changes, from 17 November 2026 (Adam, 9 Nov 2026: "check
-- the old ESP and attach the evidence"; Master, 9 Nov 2026: with the market
-- feedback columns).
--
-- s72A(5), as amended: when the ESP is revised, the agent gives the seller
--   (b)(i)  written notice of the revision that includes the ESP before the
--           revision and the revised ESP, and
--   (b)(ii) evidence of the reasonableness of the revised ESP.
-- Reg s12G(1)(f): the record of a revision includes any market feedback it
-- relied on (who, how, when, what, why it was relevant, how it was used).
--
-- WAS (0110): each revision kept its revised figures, the date the notice was
-- given, the notice, and who recorded it. Not the ESP before the revision as
-- the notice states it, not the evidence given with it.
-- NOW: each revision also keeps
--   * the ESP before the revision, as the notice states it (the app compares
--     it with the ESP on file and says so when it differs or is missing),
--   * the evidence given to the seller: a file in the listing's own d3
--     folder, or that it is part of the notice itself,
--   * market feedback, a list the app fills in later (empty until then).
-- Revisions already recorded keep everything they have; these stay empty.
--
-- record_esp_revision gets a second form with the new things (0110's form
-- stays, so the app as it is today keeps working until this merges). No new
-- table; the table's grants are restated. Safe to run twice.

begin;

-- ── 1. The new columns ───────────────────────────────────────────────────
alter table public.esp_revisions add column if not exists previous_esp_low numeric;
alter table public.esp_revisions add column if not exists previous_esp_high numeric;
alter table public.esp_revisions add column if not exists evidence_path text;
alter table public.esp_revisions add column if not exists evidence_file_name text;
alter table public.esp_revisions add column if not exists evidence_in_notice boolean not null default false;
alter table public.esp_revisions add column if not exists market_feedback jsonb not null default '[]'::jsonb;

alter table public.esp_revisions drop constraint if exists esp_revisions_previous_esp_positive;
alter table public.esp_revisions add constraint esp_revisions_previous_esp_positive
  check ((previous_esp_low is null or previous_esp_low > 0) and (previous_esp_high is null or previous_esp_high > 0));
alter table public.esp_revisions drop constraint if exists esp_revisions_evidence_in_folder;
alter table public.esp_revisions add constraint esp_revisions_evidence_in_folder
  check (evidence_path is null or starts_with(evidence_path, agency_id::text || '/' || property_id::text || '/d3/'));
alter table public.esp_revisions drop constraint if exists esp_revisions_market_feedback_list;
alter table public.esp_revisions add constraint esp_revisions_market_feedback_list
  check (jsonb_typeof(market_feedback) = 'array');

comment on column public.esp_revisions.previous_esp_low is
  'The ESP before this revision, as the notice states it (s72A(5)(b)(i); 0117). Null when the notice does not, or for revisions before 0117.';
comment on column public.esp_revisions.evidence_path is
  'The evidence of the revised ESP''s reasonableness given to the seller (s72A(5)(b)(ii); 0117), in the listing''s d3 folder.';
comment on column public.esp_revisions.market_feedback is
  'Market feedback the revision relied on (Reg s12G(1)(f); 0117): a list, empty until the app records it.';

-- Data API grants, restated (Adam's rule: grants with every change to a
-- table). The office reads and adds; nobody changes or deletes.
revoke all on table public.esp_revisions from public, anon, authenticated;
grant select, insert on public.esp_revisions to authenticated;
grant select, insert, update, delete on public.esp_revisions to service_role;

-- ── 2. Recording a revision, with the new things ─────────────────────────
-- 0110's record_esp_revision, word for word, with the ESP before the
-- revision, the evidence and market feedback added (marked 0117). A second
-- form beside 0110's: no defaults, so a call names one or the other.
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
  p_market_feedback jsonb)
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

  insert into public.esp_revisions
    (agency_id, property_id, esp_low, esp_high, notice_given_on, notice_path, notice_file_name,
     entered_manually, method_of_service, reason,
     previous_esp_low, previous_esp_high, evidence_path, evidence_file_name, evidence_in_notice, market_feedback)
  values
    (v_agency, p_property_id, p_low, p_high, p_given_on, p_notice_path, nullif(btrim(coalesce(p_notice_file_name, '')), ''),
     coalesce(p_entered_manually, false), nullif(btrim(coalesce(p_method, '')), ''), nullif(btrim(coalesce(p_reason, '')), ''),
     p_previous_low, p_previous_high, p_evidence_path, nullif(btrim(coalesce(p_evidence_file_name, '')), ''),
     coalesce(p_evidence_in_notice, false), coalesce(p_market_feedback, '[]'::jsonb))
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
  numeric, numeric, text, text, boolean, jsonb) from public, anon;
grant execute on function public.record_esp_revision(
  uuid, numeric, numeric, date, text, text, boolean, text, text, jsonb, text,
  numeric, numeric, text, text, boolean, jsonb) to authenticated, service_role;

commit;

-- ── Check ──────────────────────────────────────────────────────────────
-- One row, every value true.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'esp_revisions'
      and column_name in ('previous_esp_low', 'previous_esp_high', 'evidence_path', 'evidence_file_name',
                          'evidence_in_notice', 'market_feedback')) = 6 as columns_added,
  to_regprocedure('public.record_esp_revision(uuid, numeric, numeric, date, text, text, boolean, text, text, jsonb, text, numeric, numeric, text, text, boolean, jsonb)') is not null
    as new_form_added,
  to_regprocedure('public.record_esp_revision(uuid, numeric, numeric, date, text, text, boolean, text, text, jsonb, text)') is not null
    as old_form_kept,
  has_function_privilege('authenticated',
    'public.record_esp_revision(uuid, numeric, numeric, date, text, text, boolean, text, text, jsonb, text, numeric, numeric, text, text, boolean, jsonb)', 'execute')
    and not has_function_privilege('anon',
    'public.record_esp_revision(uuid, numeric, numeric, date, text, text, boolean, text, text, jsonb, text, numeric, numeric, text, text, boolean, jsonb)', 'execute')
    as new_form_grants,
  has_table_privilege('authenticated', 'public.esp_revisions', 'select')
    and has_table_privilege('authenticated', 'public.esp_revisions', 'insert')
    and not has_table_privilege('authenticated', 'public.esp_revisions', 'update')
    and not has_table_privilege('authenticated', 'public.esp_revisions', 'delete') as table_grants,
  (select count(*) from public.esp_revisions where jsonb_typeof(market_feedback) <> 'array') = 0 as feedback_lists;
