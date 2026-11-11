-- ===== 0126: Supervision guidelines, part 4: the annual review =====
--
-- Adam's mockup ("Supervision Guidelines Live", signed off 6 Nov 2026),
-- screens 5, 6 and 7; Master, 10 Nov 2026: "annual review reminders ...
-- Quote 2.1.2 word for word from Fair Trading's Supervision Guidelines".
--
-- Fair Trading's Supervision Guidelines 2.1.2: "Operational procedures
-- should be reviewed and appropriately revised at least every 12 months to
-- ensure they remain current and emerging risks are addressed."
--
-- The next review is due 12 months after the latest of: the office's
-- RealComply sign-up, a version saved, an amendment approved, or (new here)
-- "Reviewed, no changes needed". The app works the date out
-- (lib/sg-document/change-log.ts nextReviewDue).
--
-- Three things:
--   1. sg_reviews: "Reviewed, no changes needed", with an optional note.
--      Recorded by the licensee in charge or an office manager through
--      record_sg_review, on the office's live document. It goes in the change
--      log and moves the next review 12 months on. Everyone in the office
--      reads them. Nobody changes or deletes one.
--   2. sg_review_reminders: one row per annual review reminder email, at 90,
--      60, 30, 14 and 7 days before the review is due, to the licensee in
--      charge and every office manager. Written by the daily job only
--      (service key), BEFORE the email goes; the unique index stops a repeat.
--      Whoever runs the office can read the office's rows.
--   3. staff_reminders (0093) also takes 'sg_change_sign': the reminder the
--      licensee or an office manager sends staff who haven't signed a change
--      to the supervision guidelines.
--
-- Run once, in the SQL editor. Safe to run again.

begin;

-- ── 1. Reviewed, no changes needed ───────────────────────────────────────
create table if not exists public.sg_reviews (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  -- The live document when it was reviewed.
  document_id uuid not null references public.sg_documents(id) on delete cascade,
  -- Optional, plain text.
  note text check (note is null or char_length(note) between 1 and 1000),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_by_name text,
  -- 'licensee' or 'office_manager', as they were when they reviewed it.
  reviewed_as text not null check (reviewed_as in ('licensee', 'office_manager')),
  reviewed_at timestamptz not null default now()
);

create index if not exists sg_reviews_agency on public.sg_reviews (agency_id, reviewed_at desc);

comment on table public.sg_reviews is
  '"Reviewed, no changes needed" on the live supervision guidelines (0126), with an optional note. Moves the next review 12 months on (Fair Trading''s Supervision Guidelines 2.1.2).';

alter table public.sg_reviews enable row level security;

drop policy if exists "sg_reviews: the office reads them" on public.sg_reviews;
create policy "sg_reviews: the office reads them" on public.sg_reviews
  for select using (agency_id = public.current_agency_id());

-- Grants (every new table in public carries its own): read only for a
-- signed-in person, through the policy above. A review is recorded through
-- record_sg_review only.
revoke all on table public.sg_reviews from public, anon, authenticated;
grant select on public.sg_reviews to authenticated;
grant select, insert, update, delete on public.sg_reviews to service_role;

drop trigger if exists sg_reviews_not_ended_guard on public.sg_reviews;
create trigger sg_reviews_not_ended_guard before insert or update or delete on public.sg_reviews
  for each row execute function public.guard_agency_not_ended();

-- Record "Reviewed, no changes needed" on the office's live document.
-- Whoever runs the office: the licensee in charge, an office manager, an
-- agent on their own plan. Once a day per document: a second press, or a
-- second person the same day, is told it's already done.
create or replace function public.record_sg_review(p_document_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_uid uuid := auth.uid();
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]+', ' ', 'g')), '');
  v_name text;
  v_id uuid;
begin
  if v_agency is null or v_uid is null or not public.runs_office() then
    raise exception 'Only the licensee in charge or an office manager can record the review.' using errcode = '42501';
  end if;
  if public.agency_has_ended(v_agency) then
    raise exception 'This office''s subscription has ended.';
  end if;
  if not exists (select 1 from public.sg_documents
                  where id = p_document_id and agency_id = v_agency and status = 'live') then
    raise exception 'That isn''t the office''s current document. Reload the page.';
  end if;
  if char_length(coalesce(v_note, '')) > 1000 then
    raise exception 'Keep the note to 1,000 characters.';
  end if;

  -- One at a time per document, so two presses can't both pass the check below.
  perform pg_advisory_xact_lock(hashtextextended('sg_review:' || p_document_id::text, 0));
  if exists (select 1 from public.sg_reviews
              where document_id = p_document_id
                and (reviewed_at at time zone 'Australia/Sydney')::date = (now() at time zone 'Australia/Sydney')::date) then
    raise exception 'The supervision guidelines were already marked reviewed today.';
  end if;

  select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'A team member') into v_name
    from public.profiles where id = v_uid;
  insert into public.sg_reviews (agency_id, document_id, note, reviewed_by, reviewed_by_name, reviewed_as)
  values (v_agency, p_document_id, v_note, v_uid, v_name,
          case when public.acts_as_licensee() then 'licensee' else 'office_manager' end)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.record_sg_review(uuid, text) from public, anon;
grant execute on function public.record_sg_review(uuid, text) to authenticated, service_role;

-- ── 2. The annual review reminders ───────────────────────────────────────
create table if not exists public.sg_review_reminders (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  -- Who it went to: the licensee in charge or an office manager.
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- The review date it was about, and how many days before it.
  due_on date not null,
  days_before integer not null check (days_before in (90, 60, 30, 14, 7)),
  created_at timestamptz not null default now(),
  -- Null when the email didn't go.
  email_sent_at timestamptz
);

create unique index if not exists sg_review_reminders_once
  on public.sg_review_reminders (agency_id, profile_id, due_on, days_before);

comment on table public.sg_review_reminders is
  'One row per annual review reminder for the supervision guidelines (0126): 90, 60, 30, 14 and 7 days before the review is due, to the licensee in charge and every office manager. Written only by the daily job, before the email; the unique index stops a repeat.';

alter table public.sg_review_reminders enable row level security;

drop policy if exists "sg_review_reminders: whoever runs the office reads them" on public.sg_review_reminders;
create policy "sg_review_reminders: whoever runs the office reads them" on public.sg_review_reminders
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.runs_office());

-- Grants: read only for a signed-in person, through the policy above. Only
-- the daily job (service key) writes.
revoke all on table public.sg_review_reminders from public, anon, authenticated;
grant select on public.sg_review_reminders to authenticated;
grant select, insert, update, delete on public.sg_review_reminders to service_role;

-- ── 3. Staff reminders: a change still to sign ───────────────────────────
alter table public.staff_reminders drop constraint if exists staff_reminders_kinds_check;
alter table public.staff_reminders add constraint staff_reminders_kinds_check
  check (cardinality(kinds) > 0 and kinds <@ array['sg_manual_sign', 'sg_read', 'sg_change_sign']::text[]);

commit;

-- ── Check query (run after; every column should be true) ─────────────────
-- select
--   to_regclass('public.sg_reviews') is not null
--     and to_regclass('public.sg_review_reminders') is not null                        as two_tables,
--   (select relrowsecurity from pg_class where oid = 'public.sg_reviews'::regclass)
--     and (select relrowsecurity from pg_class where oid = 'public.sg_review_reminders'::regclass) as rls_on,
--   has_table_privilege('authenticated', 'public.sg_reviews', 'select')
--     and not has_table_privilege('authenticated', 'public.sg_reviews', 'insert')
--     and not has_table_privilege('authenticated', 'public.sg_review_reminders', 'insert')
--     and not has_table_privilege('authenticated', 'public.sg_review_reminders', 'update') as signed_in_read_only,
--   not has_table_privilege('anon', 'public.sg_reviews', 'select')
--     and not has_table_privilege('anon', 'public.sg_review_reminders', 'select')      as signed_out_nothing,
--   has_table_privilege('service_role', 'public.sg_review_reminders', 'insert')        as daily_job_writes,
--   (select prosecdef from pg_proc where proname = 'record_sg_review')                 as review_is_definer,
--   not has_function_privilege('anon', 'public.record_sg_review(uuid, text)', 'execute') as anon_cant_review,
--   to_regclass('public.sg_review_reminders_once') is not null                          as never_twice,
--   exists (select 1 from pg_trigger where tgname = 'sg_reviews_not_ended_guard')       as ended_guard,
--   (select pg_get_constraintdef(oid) like '%sg_change_sign%' from pg_constraint
--     where conname = 'staff_reminders_kinds_check')                                    as change_reminders_ok,
--   (select count(*) from public.sg_reviews) = 0
--     and (select count(*) from public.sg_review_reminders) = 0                         as nothing_yet;
