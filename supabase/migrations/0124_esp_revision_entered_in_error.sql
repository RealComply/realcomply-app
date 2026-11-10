-- 0124: "Entered in error" on ESP revisions (Master, 10 Nov 2026).
--
-- Revisions are never deleted. The listing's agent or the licensee in charge
-- marks a revision "Entered in error", with a reason. It stays on the card,
-- struck through ("Entered in error by [name], [date]: [reason]"), and in the
-- history and the audit pack, and every check leaves it out: the latest ESP,
-- the price floor, the price check, the Statement of Information. The licensee
-- can undo it.
--
-- Every "ESP now" check reads the ESP revision card (d3), which
-- record_esp_revision fills from the newest revision. So marking one in error,
-- or undoing it, moves the card to the newest revision that stands, or clears
-- the revised figures when none does. Moving the card is what the price
-- statement watch (0100, 0110) sees: an approval given against the ESP that
-- changes is cancelled, as with any change of ESP.
--
-- Run once, in the SQL editor. Safe to run again.

-- ── The mark, on the revision ─────────────────────────────────────────────
alter table public.esp_revisions add column if not exists entered_in_error_at timestamptz;
alter table public.esp_revisions add column if not exists entered_in_error_by uuid references public.profiles (id) on delete set null;
alter table public.esp_revisions add column if not exists entered_in_error_by_name text;
alter table public.esp_revisions add column if not exists entered_in_error_reason text;

alter table public.esp_revisions drop constraint if exists esp_revisions_entered_in_error_whole;
alter table public.esp_revisions add constraint esp_revisions_entered_in_error_whole check (
  (entered_in_error_at is null and entered_in_error_reason is null and entered_in_error_by is null and entered_in_error_by_name is null)
  or (entered_in_error_at is not null and char_length(btrim(coalesce(entered_in_error_reason, ''))) between 1 and 500));

comment on column public.esp_revisions.entered_in_error_at is
  'When the revision was marked "Entered in error" (0124). Null while it stands. Every check leaves a marked revision out.';

-- A revision always arrives standing: the mark is only ever set by
-- mark_esp_revision_in_error below, never with the row itself.
create or replace function public.esp_revision_arrives_standing()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.entered_in_error_at := null;
  new.entered_in_error_by := null;
  new.entered_in_error_by_name := null;
  new.entered_in_error_reason := null;
  return new;
end
$$;
revoke execute on function public.esp_revision_arrives_standing() from public, anon, authenticated;
drop trigger if exists esp_revisions_arrive_standing on public.esp_revisions;
create trigger esp_revisions_arrive_standing before insert on public.esp_revisions
  for each row execute function public.esp_revision_arrives_standing();

-- ── Every mark and every undo, kept ───────────────────────────────────────
create table if not exists public.esp_revision_error_log (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  revision_no integer not null check (revision_no > 0),
  action text not null check (action in ('marked', 'undone')),
  reason text check (reason is null or char_length(reason) <= 500),
  done_by uuid references public.profiles (id) on delete set null,
  done_by_name text not null check (char_length(done_by_name) between 1 and 200),
  done_at timestamptz not null default now()
);
create index if not exists esp_revision_error_log_property on public.esp_revision_error_log (property_id, done_at);

alter table public.esp_revision_error_log enable row level security;
drop policy if exists "esp revision error log: whoever sees the listing can view" on public.esp_revision_error_log;
create policy "esp revision error log: whoever sees the listing can view" on public.esp_revision_error_log
  for select using (agency_id = public.current_agency_id() and public.can_read_property(property_id));

-- Grants (every new table in public carries its own): read only for a
-- signed-in person, through the policy above; written only by the functions below.
revoke all on table public.esp_revision_error_log from public, anon, authenticated;
grant select on public.esp_revision_error_log to authenticated;
grant select, insert, update, delete on public.esp_revision_error_log to service_role;

drop trigger if exists esp_revision_error_log_not_ended_guard on public.esp_revision_error_log;
create trigger esp_revision_error_log_not_ended_guard
  before insert or update or delete on public.esp_revision_error_log
  for each row execute function public.guard_agency_not_ended();

-- ── The card follows the newest revision that stands ──────────────────────
-- Internal: only the two functions below call it.
create or replace function public.esp_card_follow_revisions(p_property_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.esp_revisions%rowtype;
begin
  select * into r from public.esp_revisions
   where property_id = p_property_id and entered_in_error_at is null
   order by revision_no desc limit 1;
  if found then
    update public.property_items
       set evidence_path = r.notice_path,
           data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
             'espRevised', true,
             'revisedEspLow', r.esp_low,
             'revisedEspHigh', r.esp_high,
             'noticeServedOn', r.notice_given_on,
             'methodOfService', r.method_of_service,
             'reason', r.reason,
             'evidenceFileName', r.notice_file_name,
             'enteredManually', r.entered_manually,
             'latestRevision', r.revision_no)
     where property_id = p_property_id and item_key = 'd3'
       and (data -> 'latestRevision') is distinct from to_jsonb(r.revision_no);
  else
    -- None stands: the card asks again whether the ESP was revised.
    update public.property_items
       set evidence_path = null,
           status = 'open',
           completed_by = null,
           data = coalesce(data, '{}'::jsonb) - array[
             'espRevised', 'revisedEspLow', 'revisedEspHigh', 'noticeServedOn', 'methodOfService', 'reason',
             'evidenceFileName', 'enteredManually', 'latestRevision',
             'evidenceProvidedBeforeNotice', 'advertisingUpdated', 'outstanding', 'noticeProblems']
     where property_id = p_property_id and item_key = 'd3'
       and (data ? 'latestRevision' or data ? 'revisedEspLow');
  end if;
end
$$;
revoke execute on function public.esp_card_follow_revisions(uuid) from public, anon, authenticated;

-- ── Mark a revision "Entered in error" ───────────────────────────────────
-- The listing's agent (not an assistant) or the licensee in charge.
create or replace function public.mark_esp_revision_in_error(p_property_id uuid, p_revision_no integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_agency uuid;
  v_agent uuid;
  v_name text;
  v_reason text := btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g'));
  v_rev public.esp_revisions%rowtype;
begin
  if v_uid is null then
    raise exception 'Sign in again to mark the revision.' using errcode = '42501';
  end if;
  select p.agency_id, p.created_by into v_agency, v_agent from public.properties p
   where p.id = p_property_id and p.agency_id = public.current_agency_id();
  if v_agency is null or not public.can_see_property(p_property_id) then
    raise exception 'This listing isn''t one you can work on.' using errcode = '42501';
  end if;
  if not ((v_agent = v_uid and not public.is_assistant()) or public.acts_as_licensee()) then
    raise exception 'Only the listing''s agent or the licensee in charge can mark a revision entered in error.' using errcode = '42501';
  end if;
  if public.agency_has_ended(v_agency) then
    raise exception 'This office''s subscription has ended.';
  end if;
  if public.listing_signed_off(p_property_id) then
    raise exception 'This file is signed off. Reopen it before marking a revision entered in error.';
  end if;
  if public.listing_is_withdrawn(p_property_id) then
    raise exception 'This listing is withdrawn from sale. Put it back on the market to change it.';
  end if;
  if v_reason = '' then
    raise exception 'Say why it was entered in error.';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Keep the reason to 500 characters.';
  end if;
  select * into v_rev from public.esp_revisions
   where property_id = p_property_id and revision_no = p_revision_no
   for update;
  if not found then
    raise exception 'That revision isn''t on this listing.';
  end if;
  if v_rev.entered_in_error_at is not null then
    raise exception 'That revision is already marked entered in error.';
  end if;

  select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'A team member') into v_name
    from public.profiles where id = v_uid;

  update public.esp_revisions
     set entered_in_error_at = now(),
         entered_in_error_by = v_uid,
         entered_in_error_by_name = left(v_name, 200),
         entered_in_error_reason = v_reason
   where id = v_rev.id;
  insert into public.esp_revision_error_log (agency_id, property_id, revision_no, action, reason, done_by, done_by_name)
  values (v_agency, p_property_id, p_revision_no, 'marked', v_reason, v_uid, left(v_name, 200));

  perform public.esp_card_follow_revisions(p_property_id);
end
$$;
revoke execute on function public.mark_esp_revision_in_error(uuid, integer, text) from public, anon;
grant execute on function public.mark_esp_revision_in_error(uuid, integer, text) to authenticated, service_role;

-- ── Undo it: the licensee in charge ──────────────────────────────────────
create or replace function public.undo_esp_revision_in_error(p_property_id uuid, p_revision_no integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_agency uuid;
  v_name text;
  v_rev public.esp_revisions%rowtype;
begin
  if v_uid is null then
    raise exception 'Sign in again to undo it.' using errcode = '42501';
  end if;
  select p.agency_id into v_agency from public.properties p
   where p.id = p_property_id and p.agency_id = public.current_agency_id();
  if v_agency is null or not public.can_see_property(p_property_id) then
    raise exception 'This listing isn''t one you can work on.' using errcode = '42501';
  end if;
  if not public.acts_as_licensee() then
    raise exception 'Only the licensee in charge can undo this.' using errcode = '42501';
  end if;
  if public.agency_has_ended(v_agency) then
    raise exception 'This office''s subscription has ended.';
  end if;
  if public.listing_signed_off(p_property_id) then
    raise exception 'This file is signed off. Reopen it before undoing this.';
  end if;
  if public.listing_is_withdrawn(p_property_id) then
    raise exception 'This listing is withdrawn from sale. Put it back on the market to change it.';
  end if;
  select * into v_rev from public.esp_revisions
   where property_id = p_property_id and revision_no = p_revision_no
   for update;
  if not found then
    raise exception 'That revision isn''t on this listing.';
  end if;
  if v_rev.entered_in_error_at is null then
    raise exception 'That revision isn''t marked entered in error.';
  end if;

  select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'A team member') into v_name
    from public.profiles where id = v_uid;

  update public.esp_revisions
     set entered_in_error_at = null,
         entered_in_error_by = null,
         entered_in_error_by_name = null,
         entered_in_error_reason = null
   where id = v_rev.id;
  insert into public.esp_revision_error_log (agency_id, property_id, revision_no, action, reason, done_by, done_by_name)
  values (v_agency, p_property_id, p_revision_no, 'undone', null, v_uid, left(v_name, 200));

  perform public.esp_card_follow_revisions(p_property_id);
end
$$;
revoke execute on function public.undo_esp_revision_in_error(uuid, integer) from public, anon;
grant execute on function public.undo_esp_revision_in_error(uuid, integer) to authenticated, service_role;

-- ── Check query (run after; every column should be true) ─────────────────
-- select
--   (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'esp_revisions'
--      and column_name in ('entered_in_error_at', 'entered_in_error_by', 'entered_in_error_by_name', 'entered_in_error_reason')) = 4 as mark_columns,
--   to_regclass('public.esp_revision_error_log') is not null                            as log_table,
--   (select relrowsecurity from pg_class where oid = 'public.esp_revision_error_log'::regclass) as log_rls_on,
--   has_table_privilege('authenticated', 'public.esp_revision_error_log', 'select')
--     and not has_table_privilege('authenticated', 'public.esp_revision_error_log', 'insert')
--     and not has_table_privilege('authenticated', 'public.esp_revision_error_log', 'update') as log_read_only,
--   not has_table_privilege('anon', 'public.esp_revision_error_log', 'select')         as signed_out_nothing,
--   not has_table_privilege('authenticated', 'public.esp_revisions', 'update')         as revisions_still_not_editable,
--   (select count(*) from pg_proc where proname in ('mark_esp_revision_in_error', 'undo_esp_revision_in_error',
--      'esp_card_follow_revisions') and prosecdef) = 3                                   as three_functions,
--   not has_function_privilege('authenticated', 'public.esp_card_follow_revisions(uuid)', 'execute') as card_move_internal,
--   not has_function_privilege('anon', 'public.mark_esp_revision_in_error(uuid, integer, text)', 'execute') as anon_cant_mark,
--   exists (select 1 from pg_trigger where tgname = 'esp_revision_error_log_not_ended_guard') as ended_guard,
--   exists (select 1 from pg_trigger where tgname = 'esp_revisions_arrive_standing')  as arrives_standing,
--   (select count(*) from public.esp_revisions where entered_in_error_at is not null) = 0 as nothing_marked_yet;
