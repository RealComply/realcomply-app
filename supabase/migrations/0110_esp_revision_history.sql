-- ===== 0110: ESP revision history: every revision kept, with its notice =====
--
-- Adam, 3 Nov 2026 (mockup approved: "ESP Revision History").
--
-- WAS: the card "Was the Estimated Selling Price revised?" (d3) held one set of
-- revised figures and one notice. Attaching a new notice replaced the notice on
-- the card, and reading it wrote the new figures, the date the notice was
-- given, how it was given and the reason over the old ones. The old file stayed
-- in the listing's folder, but nothing linked it to the card or its figures,
-- and who recorded each revision wasn't kept.
-- NOW: nothing on this card is ever written over. Every revision is a row here:
-- its figures, the date the notice was given, who recorded it and when, and the
-- notice itself. Rows are only ever added, never changed or deleted (the
-- office's own deletion of its account aside). The d3 card keeps the latest
-- revision's figures, which every check reads (listing_effective_esp, 0066; and
-- espFrom in the app): the advertised price scan, the sale price 10% check, the
-- rejected-offer check and the price statement.
--
-- Each new revision cancels the price statement approval, as reopening the card
-- does today (0100); the cancelled approval stays on record. Before 0110 the
-- approval was cancelled only when the figures changed; a revision with the
-- same figures as the one before now cancels it too.
--
-- Revisions recorded before 0110 (two on live: 16 Greenmount Way, Mount Colah,
-- and 2/194 The Esplanade, Speers Point) become Revision 1, with their notice,
-- and nothing else about them changes.
--
-- One new table, with its grants. Safe to run twice.

begin;

-- ── 1. Every revision ───────────────────────────────────────────────────
create table if not exists public.esp_revisions (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null references public.agencies (id) on delete cascade,
  property_id      uuid not null references public.properties (id) on delete cascade,
  revision_no      integer not null check (revision_no > 0),
  esp_low          numeric not null check (esp_low > 0),
  esp_high         numeric not null check (esp_high > 0),
  -- The date the notice was given to the seller, as on the notice.
  notice_given_on  date,
  -- The notice, in the listing's own d3 folder. Never printed, only fetched.
  notice_path      text not null,
  notice_file_name text,
  -- Typed from the notice because it couldn't be read.
  entered_manually boolean not null default false,
  method_of_service text,
  reason           text,
  recorded_by      uuid references public.profiles (id) on delete set null,
  -- The name as it was then, for the record after a person leaves.
  recorded_by_name text,
  recorded_at      timestamptz not null default now(),
  unique (property_id, revision_no),
  constraint esp_revisions_notice_in_folder
    check (starts_with(notice_path, agency_id::text || '/' || property_id::text || '/d3/'))
);
create index if not exists esp_revisions_agency on public.esp_revisions (agency_id);
comment on table public.esp_revisions is
  'Every revision of the estimated selling price on a listing, with its notice (0110, Adam 3 Nov 2026). Added to, never changed. The latest drives every check, through the d3 card.';

alter table public.esp_revisions enable row level security;
drop policy if exists "esp_revisions: whoever sees the listing can view" on public.esp_revisions;
create policy "esp_revisions: whoever sees the listing can view" on public.esp_revisions
  for select using (agency_id = public.current_agency_id() and public.can_see_property(property_id));
drop policy if exists "esp_revisions: whoever works on the listing can add" on public.esp_revisions;
create policy "esp_revisions: whoever works on the listing can add" on public.esp_revisions
  for insert with check (agency_id = public.current_agency_id() and public.can_see_property(property_id));

-- Data API grants: the office reads and adds; nobody changes or deletes.
revoke all on table public.esp_revisions from public, anon, authenticated;
grant select, insert on public.esp_revisions to authenticated;
grant select, insert, update, delete on public.esp_revisions to service_role;

drop trigger if exists esp_revisions_not_ended_guard on public.esp_revisions;
create trigger esp_revisions_not_ended_guard
  before insert or update or delete on public.esp_revisions
  for each row execute function public.guard_agency_not_ended();

-- The number, who and when are the database's to write, never the browser's.
-- Runs as the caller (not security definer), so current_user tells
-- RealComply's own code (this migration) from someone signed in.
create or replace function public.stamp_esp_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('esp_revision:' || new.property_id::text, 0));
  if current_user in ('authenticated', 'anon') then
    new.recorded_by := auth.uid();
    select coalesce(nullif(btrim(full_name), ''), email) into new.recorded_by_name
      from public.profiles where id = auth.uid();
    new.recorded_at := now();
    new.revision_no := null;
  end if;
  if new.revision_no is null then
    select coalesce(max(r.revision_no), 0) + 1 into new.revision_no
      from public.esp_revisions r where r.property_id = new.property_id;
  end if;
  return new;
end
$$;
drop trigger if exists esp_revisions_stamp on public.esp_revisions;
create trigger esp_revisions_stamp before insert on public.esp_revisions
  for each row execute function public.stamp_esp_revision();

-- ── 2. Recording a revision: the row, and the card's latest figures ──────
-- One transaction, as the person recording it (so every rule on the card
-- applies: a signed-off file can't take one). The card's figures, the date the
-- notice was given and its notice become the new revision's; the draft read
-- from the notice goes. p_card carries the two confirmations (s72A(5), s73(3))
-- and what is outstanding; p_status is 'done' when both are confirmed.
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
  p_status text)
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

  insert into public.esp_revisions
    (agency_id, property_id, esp_low, esp_high, notice_given_on, notice_path, notice_file_name,
     entered_manually, method_of_service, reason)
  values
    (v_agency, p_property_id, p_low, p_high, p_given_on, p_notice_path, nullif(btrim(coalesce(p_notice_file_name, '')), ''),
     coalesce(p_entered_manually, false), nullif(btrim(coalesce(p_method, '')), ''), nullif(btrim(coalesce(p_reason, '')), ''))
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
revoke execute on function public.record_esp_revision(uuid, numeric, numeric, date, text, text, boolean, text, text, jsonb, text)
  from public, anon;
grant execute on function public.record_esp_revision(uuid, numeric, numeric, date, text, text, boolean, text, text, jsonb, text)
  to authenticated, service_role;

-- ── 3. Revisions recorded before 0110 become Revision 1 ──────────────────
-- Every d3 card holding both revised figures and a notice in its own folder,
-- with no revision here yet. Who recorded it: whoever saved the card. When:
-- when the notice was read (or the figures typed), else now. Before the
-- watcher below changes, and with the same figures, so no approval is
-- cancelled by this.
insert into public.esp_revisions
  (agency_id, property_id, revision_no, esp_low, esp_high, notice_given_on, notice_path, notice_file_name,
   entered_manually, method_of_service, reason, recorded_by, recorded_by_name, recorded_at)
select i.agency_id, i.property_id, 1,
       public.jsonb_to_numeric(i.data -> 'revisedEspLow'),
       public.jsonb_to_numeric(i.data -> 'revisedEspHigh'),
       case when coalesce(i.data ->> 'noticeServedOn', '') ~ '^\d{4}-\d{2}-\d{2}$' then (i.data ->> 'noticeServedOn')::date end,
       i.evidence_path,
       nullif(btrim(coalesce(i.data ->> 'evidenceFileName', '')), ''),
       coalesce(i.data ->> 'enteredManually', '') = 'true',
       nullif(btrim(coalesce(i.data ->> 'methodOfService', '')), ''),
       nullif(btrim(coalesce(i.data ->> 'reason', '')), ''),
       i.completed_by,
       (select coalesce(nullif(btrim(pr.full_name), ''), pr.email) from public.profiles pr where pr.id = i.completed_by),
       coalesce(
         case when coalesce(i.data ->> 'enteredManuallyAt', '') ~ '^\d{4}-\d{2}-\d{2}T' then (i.data ->> 'enteredManuallyAt')::timestamptz end,
         case when coalesce(i.data ->> 'noticeReadAt', '') ~ '^\d{4}-\d{2}-\d{2}T' then (i.data ->> 'noticeReadAt')::timestamptz end,
         now())
  from public.property_items i
 where i.item_key = 'd3'
   and public.jsonb_to_numeric(i.data -> 'revisedEspLow') > 0
   and public.jsonb_to_numeric(i.data -> 'revisedEspHigh') > 0
   and i.evidence_path is not null
   and starts_with(i.evidence_path, i.agency_id::text || '/' || i.property_id::text || '/d3/')
   and not exists (select 1 from public.esp_revisions r where r.property_id = i.property_id);

update public.property_items i
   set data = coalesce(i.data, '{}'::jsonb) || jsonb_build_object('latestRevision', 1)
 where i.item_key = 'd3'
   and not (coalesce(i.data, '{}'::jsonb) ? 'latestRevision')
   and exists (select 1 from public.esp_revisions r where r.property_id = i.property_id and r.revision_no = 1);

-- ── 4. Each new revision cancels the price statement approval ────────────
-- 0100's watcher, word for word, with one rule added (marked 0110): a new
-- revision on the d3 card cancels the approval even where its figures are the
-- same as the last one's.
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
begin
  if new.item_key not in ('a4', 'a4c', 'd3') then
    return null;
  end if;

  -- Reopened: the ESP card or the ESP reasoning, or the ESP revision while
  -- it holds the revised ESP.
  if tg_op = 'UPDATE' and old.status in ('done', 'flagged') and new.status = 'open' then
    if new.item_key in ('a4', 'a4c') then
      v_because := 'reopened';
    elsif public.jsonb_to_numeric(old.data -> 'revisedEspLow') is not null
          and public.jsonb_to_numeric(old.data -> 'revisedEspHigh') is not null then
      v_because := 'reopened';
    end if;
  end if;

  -- 0110: a new revision recorded (record_esp_revision), whatever its figures.
  if v_because is null and new.item_key = 'd3' and tg_op = 'UPDATE'
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

commit;

-- ── Check ──────────────────────────────────────────────────────────────
-- One row. Every true/false value true; the last column shows 2/194 The
-- Esplanade, Speers Point as Revision 1 with its notice.
select
  to_regclass('public.esp_revisions') is not null
    and has_table_privilege('authenticated', 'public.esp_revisions', 'select')
    and has_table_privilege('authenticated', 'public.esp_revisions', 'insert')
    and not has_table_privilege('authenticated', 'public.esp_revisions', 'update')
    and not has_table_privilege('authenticated', 'public.esp_revisions', 'delete')
    and not has_table_privilege('anon', 'public.esp_revisions', 'select') as revisions_kept_never_changed,
  has_function_privilege('authenticated',
    'public.record_esp_revision(uuid, numeric, numeric, date, text, text, boolean, text, text, jsonb, text)', 'execute')
    and not has_function_privilege('anon',
    'public.record_esp_revision(uuid, numeric, numeric, date, text, text, boolean, text, text, jsonb, text)', 'execute')
    as record_ready,
  position('0110' in pg_get_functiondef('public.watch_price_statement_inputs()'::regprocedure)) > 0
    as each_revision_cancels_approval,
  exists (select 1 from public.esp_revisions r
           where r.property_id = '973b0573-9a61-4403-b376-4ca4258d0b7e' and r.revision_no = 1
             and r.esp_low = 940000 and r.esp_high = 1025000 and r.notice_given_on = date '2026-10-19'
             and r.notice_path is not null) as speers_point_is_revision_1,
  (select count(*) from public.esp_revisions where revision_no = 1) as revisions_brought_across,
  (select 'Revision ' || r.revision_no || ': $' || to_char(r.esp_low, 'FM9,999,999') || ' to $' || to_char(r.esp_high, 'FM9,999,999')
          || ', given ' || to_char(r.notice_given_on, 'FMDD Mon YYYY') || ', notice ' || coalesce(r.notice_file_name, '(no name)')
          || ', recorded by ' || coalesce(r.recorded_by_name, 'unknown')
     from public.esp_revisions r
    where r.property_id = '973b0573-9a61-4403-b376-4ca4258d0b7e' and r.revision_no = 1) as speers_point;
