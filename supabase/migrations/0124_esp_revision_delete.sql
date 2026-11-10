-- 0124: Delete an ESP revision (Adam, 10 Nov 2026).
--
-- Master asked for a revision entered in error to be marked and kept. Adam,
-- 10 Nov 2026: "there's no need to leave a trail saying that it's been
-- entered in error. This isn't a trust account. Just have it deleted
-- cleanly." So the listing's agent or the licensee in charge deletes it: the
-- revision goes, with its notice, its evidence and its market feedback
-- record, and the later revisions move up a number, so the history reads as
-- if it had never been recorded. Nothing is kept about it.
--
-- Every "ESP now" check reads the ESP revision card (d3), which
-- record_esp_revision fills from the newest revision. Deleting the newest
-- moves the card back to the one before it (and asks again whether the
-- advertising matches it), or clears the revised figures when none is left.
-- An approval of the price statement given against the ESP that changes is
-- cancelled, as with any change of ESP; one given against the same figures
-- stands (the watch, from 0110, below).
--
-- Not while the file is signed off or the listing is withdrawn, and not where
-- a statement of information was prepared for that revision or a later one
-- (kept 3 years, s72C(6)).
--
-- Run once, in the SQL editor. Safe to run again.

begin;

-- ── 1. The price statement watch: a deletion cancels only on new figures ──
-- 0110's watcher, word for word, with the deletion marked (0124).
create or replace function public.watch_price_statement_inputs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_because text;
  v_before_low numeric;
  v_before_high numeric;
  v_after_low numeric;
  v_after_high numeric;
  v_d3_low numeric;
  v_d3_high numeric;
  -- 0124: a revision being deleted (delete_esp_revision, below). The card
  -- moves to the revision before it, or the later ones move up a number;
  -- only a change of the figures themselves cancels the approval.
  v_deleting boolean := coalesce(current_setting('realcomply.esp_revision_deleting', true), '') = 'on';
begin
  if new.item_key not in ('a4', 'a4c', 'd3') then
    return null;
  end if;

  -- Reopened: the ESP card or the ESP reasoning, or the ESP revision while
  -- it holds the revised ESP.
  if tg_op = 'UPDATE' and old.status in ('done', 'flagged') and new.status = 'open' then
    if new.item_key in ('a4', 'a4c') then
      v_because := 'reopened';
    elsif not v_deleting and public.jsonb_to_numeric(old.data -> 'revisedEspLow') is not null
          and public.jsonb_to_numeric(old.data -> 'revisedEspHigh') is not null then
      v_because := 'reopened';
    end if;
  end if;

  -- 0110: a new revision recorded (record_esp_revision), whatever its figures.
  if v_because is null and new.item_key = 'd3' and tg_op = 'UPDATE' and not v_deleting
     and (old.data -> 'latestRevision') is not null
     and (new.data -> 'latestRevision') is distinct from (old.data -> 'latestRevision') then
    v_because := 'esp_changed';
  end if;

  -- The ESP on the file changed (the same rule as listing_effective_esp,
  -- 0066: d3's revised figures when both are there, otherwise a4's).
  if v_because is null and new.item_key in ('a4', 'd3') then
    select e.esp_low, e.esp_high into v_after_low, v_after_high
      from public.listing_effective_esp(new.property_id) e;
    if new.item_key = 'd3' then
      if tg_op = 'UPDATE'
         and public.jsonb_to_numeric(old.data -> 'revisedEspLow') is not null
         and public.jsonb_to_numeric(old.data -> 'revisedEspHigh') is not null then
        v_before_low := public.jsonb_to_numeric(old.data -> 'revisedEspLow');
        v_before_high := public.jsonb_to_numeric(old.data -> 'revisedEspHigh');
      else
        select public.jsonb_to_numeric(a.data -> 'espLow'), public.jsonb_to_numeric(a.data -> 'espHigh')
          into v_before_low, v_before_high
          from public.property_items a where a.property_id = new.property_id and a.item_key = 'a4';
      end if;
    else
      select public.jsonb_to_numeric(d.data -> 'revisedEspLow'), public.jsonb_to_numeric(d.data -> 'revisedEspHigh')
        into v_d3_low, v_d3_high
        from public.property_items d where d.property_id = new.property_id and d.item_key = 'd3';
      if v_d3_low is not null and v_d3_high is not null then
        v_before_low := v_d3_low;
        v_before_high := v_d3_high;
      elsif tg_op = 'UPDATE' then
        v_before_low := public.jsonb_to_numeric(old.data -> 'espLow');
        v_before_high := public.jsonb_to_numeric(old.data -> 'espHigh');
      end if;
    end if;
    if v_before_low is not null and v_before_high is not null
       and (v_after_low is distinct from v_before_low or v_after_high is distinct from v_before_high) then
      v_because := 'esp_changed';
    end if;
  end if;

  if v_because is not null then
    perform public.cancel_price_statement_approval(new.property_id, new.item_key, v_because);
  end if;
  return null;
end
$$;
revoke execute on function public.watch_price_statement_inputs() from public, anon, authenticated;

-- ── 2. Delete a revision ─────────────────────────────────────────────────
-- The listing's agent (not an assistant) or the licensee in charge. Returns
-- the files that went with it, in the listing's own d3 folder, for the app to
-- remove from storage: only those no other revision, and not the card, uses.
create or replace function public.delete_esp_revision(p_property_id uuid, p_revision_no integer)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_agency uuid;
  v_agent uuid;
  v_rev public.esp_revisions%rowtype;
  v_now public.esp_revisions%rowtype;
  v_max integer;
  v_paths text[];
  v_keep text[];
  v_folder text;
  v_card jsonb;
  r record;
begin
  if v_uid is null then
    raise exception 'Sign in again to delete the revision.' using errcode = '42501';
  end if;
  select p.agency_id, p.created_by into v_agency, v_agent from public.properties p
   where p.id = p_property_id and p.agency_id = public.current_agency_id();
  if v_agency is null or not public.can_see_property(p_property_id) then
    raise exception 'This listing isn''t one you can work on.' using errcode = '42501';
  end if;
  if not ((v_agent = v_uid and not public.is_assistant()) or public.acts_as_licensee()) then
    raise exception 'Only the listing''s agent or the licensee in charge can delete a revision.' using errcode = '42501';
  end if;
  if public.agency_has_ended(v_agency) then
    raise exception 'This office''s subscription has ended.';
  end if;
  if public.listing_signed_off(p_property_id) then
    raise exception 'This file is signed off. Reopen it before deleting a revision.';
  end if;
  if public.listing_is_withdrawn(p_property_id) then
    raise exception 'This listing is withdrawn from sale. Put it back on the market to change it.';
  end if;

  -- One change to the revisions at a time (as stamp_esp_revision, 0110).
  perform pg_advisory_xact_lock(hashtextextended('esp_revision:' || p_property_id::text, 0));
  select * into v_rev from public.esp_revisions
   where property_id = p_property_id and revision_no = p_revision_no
   for update;
  if not found then
    raise exception 'That revision isn''t on this listing. Reload the page.';
  end if;
  if exists (select 1 from public.statements_of_information s
              where s.property_id = p_property_id and s.esp_revision_no >= p_revision_no) then
    raise exception 'A statement of information was prepared for this revision or a later one, and it has to be kept, so this revision stays.';
  end if;
  select max(revision_no) into v_max from public.esp_revisions where property_id = p_property_id;

  v_paths := array_remove(array[
    v_rev.notice_path,
    v_rev.evidence_path,
    (select e ->> 'path' from jsonb_array_elements(
       case when jsonb_typeof(v_rev.market_feedback) = 'array' then v_rev.market_feedback else '[]'::jsonb end) e
      where e ->> 'kind' = 'file' limit 1)], null);

  delete from public.esp_revisions where id = v_rev.id;

  -- The later ones move up a number, lowest first.
  for r in select id from public.esp_revisions
            where property_id = p_property_id and revision_no > p_revision_no
            order by revision_no loop
    update public.esp_revisions set revision_no = revision_no - 1 where id = r.id;
  end loop;

  -- The card follows: the watch above cancels an approval only if the
  -- figures on file change.
  perform set_config('realcomply.esp_revision_deleting', 'on', true);
  select * into v_now from public.esp_revisions
   where property_id = p_property_id order by revision_no desc limit 1;
  if not found then
    -- None left: the card asks again whether the ESP was revised.
    update public.property_items
       set evidence_path = null,
           status = 'open',
           completed_by = null,
           data = coalesce(data, '{}'::jsonb) - array[
             'espRevised', 'revisedEspLow', 'revisedEspHigh', 'noticeServedOn', 'methodOfService', 'reason',
             'evidenceFileName', 'enteredManually', 'latestRevision',
             'evidenceProvidedBeforeNotice', 'advertisingUpdated', 'outstanding', 'noticeProblems']
     where property_id = p_property_id and item_key = 'd3';
  elsif p_revision_no = v_max then
    -- The newest went: the card holds the one before it.
    v_card := jsonb_build_object(
      'espRevised', true,
      'revisedEspLow', v_now.esp_low,
      'revisedEspHigh', v_now.esp_high,
      'noticeServedOn', v_now.notice_given_on,
      'methodOfService', v_now.method_of_service,
      'reason', v_now.reason,
      'evidenceFileName', v_now.notice_file_name,
      'enteredManually', v_now.entered_manually,
      'latestRevision', v_now.revision_no);
    if v_now.esp_low = v_rev.esp_low and v_now.esp_high = v_rev.esp_high then
      update public.property_items
         set evidence_path = v_now.notice_path,
             data = coalesce(data, '{}'::jsonb) - 'noticeProblems' || v_card
       where property_id = p_property_id and item_key = 'd3';
    else
      -- New figures on file: is the advertising back in line with them?
      update public.property_items
         set evidence_path = v_now.notice_path,
             status = 'open',
             completed_by = null,
             data = (coalesce(data, '{}'::jsonb) - 'noticeProblems') || v_card || jsonb_build_object(
               'advertisingUpdated', false,
               'outstanding', case when coalesce((data ->> 'evidenceProvidedBeforeNotice')::boolean, false)
                 then jsonb_build_array('The advertising has not been confirmed as updated to the revised price (s73(3)).')
                 else jsonb_build_array(
                   'Evidence of the new price has not been confirmed as given to the vendor (s72A(5)).',
                   'The advertising has not been confirmed as updated to the revised price (s73(3)).') end)
       where property_id = p_property_id and item_key = 'd3';
    end if;
  else
    -- An earlier one went: the newest stays, one number lower.
    update public.property_items
       set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('latestRevision', v_now.revision_no)
     where property_id = p_property_id and item_key = 'd3';
  end if;
  perform set_config('realcomply.esp_revision_deleting', 'off', true);

  -- Its files, unless another revision or the card still uses them.
  v_folder := v_agency::text || '/' || p_property_id::text || '/d3/';
  select array_agg(x) into v_keep from (
    select notice_path as x from public.esp_revisions where property_id = p_property_id
    union select evidence_path from public.esp_revisions where property_id = p_property_id
    union select e ->> 'path' from public.esp_revisions s,
      jsonb_array_elements(case when jsonb_typeof(s.market_feedback) = 'array' then s.market_feedback else '[]'::jsonb end) e
      where s.property_id = p_property_id and e ->> 'kind' = 'file'
    union select evidence_path from public.property_items where property_id = p_property_id and item_key = 'd3'
    union select data -> 'pending' ->> 'path' from public.property_items where property_id = p_property_id and item_key = 'd3'
  ) k where x is not null;
  return array(select distinct p from unnest(v_paths) p
                where starts_with(p, v_folder) and not (p = any (coalesce(v_keep, '{}'::text[]))));
end
$$;
revoke execute on function public.delete_esp_revision(uuid, integer) from public, anon;
grant execute on function public.delete_esp_revision(uuid, integer) to authenticated, service_role;

commit;

-- ── Check query (run after; every column should be true) ─────────────────
-- select
--   (select prosecdef from pg_proc where proname = 'delete_esp_revision')            as delete_is_definer,
--   has_function_privilege('authenticated', 'public.delete_esp_revision(uuid, integer)', 'execute') as signed_in_can_call,
--   not has_function_privilege('anon', 'public.delete_esp_revision(uuid, integer)', 'execute') as signed_out_cant,
--   position('esp_revision_deleting' in pg_get_functiondef('public.watch_price_statement_inputs()'::regprocedure)) > 0 as watch_knows_deletes,
--   position('0110' in pg_get_functiondef('public.watch_price_statement_inputs()'::regprocedure)) > 0 as watch_keeps_0110,
--   not has_table_privilege('authenticated', 'public.esp_revisions', 'delete')         as revisions_not_deletable_directly,
--   not has_table_privilege('authenticated', 'public.esp_revisions', 'update')         as revisions_not_editable_directly;
