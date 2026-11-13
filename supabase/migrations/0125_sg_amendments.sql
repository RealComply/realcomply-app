-- ===== 0125: Supervision guidelines, part 2: quick amendments and staff sign-off of each change =====
--
-- Adam's mockup ("Supervision Guidelines Live", signed off 6 Nov 2026),
-- screens 3, 5 and 6; Master, 10 Nov 2026: "quick amendments in place ...
-- change log, staff sign-off of each change".
--
-- A quick amendment changes one paragraph of the live document (or adds one
-- at the end of a section). It starts as a draft or is approved straight
-- away by the licensee in charge or an office manager. Once approved it is
-- numbered (A1, A2 ... on that document), shows in place in the live
-- document with the previous wording kept, goes in the change log, and
-- every staff member is asked to sign it: "I've read and understood this
-- change". The approver has, so their signature is taken on approval.
--
-- Fair Trading's Supervision Guidelines 2.1.2: operational procedures
-- "should be reviewed and appropriately revised at least every 12 months".
-- An approved amendment counts as a revision: the app works the next review
-- date out from the latest one (lib/sg-document/change-log.ts); part 4 sends the
-- reminders.
--
-- Who can do what:
--   * Everyone in the office reads approved amendments; drafts only whoever
--     runs the office (runs_office(): the licensee in charge, an office
--     manager, an agent on their own plan).
--   * Saving a draft, approving and throwing one away go through
--     save_sg_amendment and discard_sg_amendment, which check runs_office(),
--     that the document is the office's live one, and that the office's
--     subscription hasn't ended. The wording it replaces is taken by the
--     database from the document as it stands, never from the browser.
--   * Each person signs for themselves, through sign_sg_amendment.
--   * Nobody deletes a row or changes an approved amendment.
--
-- Run once, in the SQL editor. Safe to run again.

begin;

create table if not exists public.sg_amendments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  document_id uuid not null references public.sg_documents(id) on delete cascade,
  -- A1, A2 ... on its document, given on approval.
  ref_no integer check (ref_no is null or ref_no > 0),
  section_position integer not null check (section_position >= 0),
  -- Which paragraph of the section, from 0. One past the last adds a paragraph.
  paragraph_index integer not null check (paragraph_index >= 0),
  -- "4. Trust money", as the section was headed when amended.
  section_label text not null check (char_length(section_label) between 1 and 330),
  -- The wording it replaced, as the document stood ('' for a paragraph added).
  previous_text text not null default '' check (char_length(previous_text) <= 20000),
  new_text text not null check (char_length(btrim(new_text)) between 1 and 20000),
  reason text not null check (reason in ('law_change', 'audit_finding', 'complaint', 'staffing', 'other')),
  reason_other text check (reason_other is null or char_length(reason_other) between 1 and 200),
  starts_on date not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'discarded')),
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_by_name text,
  -- 'licensee' or 'office_manager', as they were when they approved it.
  approved_as text check (approved_as is null or approved_as in ('licensee', 'office_manager')),
  approved_at timestamptz,
  constraint sg_amendments_other_has_words check (reason <> 'other' or reason_other is not null),
  constraint sg_amendments_approved_whole check (
    status <> 'approved' or (ref_no is not null and approved_at is not null and approved_as is not null)
  ),
  constraint sg_amendments_changes_something check (btrim(new_text) <> btrim(previous_text))
);

create index if not exists sg_amendments_document on public.sg_amendments (document_id, ref_no);
create index if not exists sg_amendments_agency on public.sg_amendments (agency_id, created_at desc);
create unique index if not exists sg_amendments_ref on public.sg_amendments (document_id, ref_no) where ref_no is not null;

comment on table public.sg_amendments is
  'Quick amendments to the live supervision guidelines (0125): one paragraph each, approved by the licensee in charge or an office manager, then signed by every staff member.';

create table if not exists public.sg_amendment_signatures (
  amendment_id uuid not null references public.sg_amendments(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  signed_name text,
  signed_at timestamptz not null default now(),
  primary key (amendment_id, profile_id)
);

create index if not exists sg_amendment_signatures_profile on public.sg_amendment_signatures (profile_id);

comment on table public.sg_amendment_signatures is
  'Each staff member''s "I''ve read and understood this change" on an approved amendment (0125).';

alter table public.sg_amendments enable row level security;
alter table public.sg_amendment_signatures enable row level security;

drop policy if exists "sg_amendments: office reads approved ones, whoever runs it reads drafts" on public.sg_amendments;
create policy "sg_amendments: office reads approved ones, whoever runs it reads drafts" on public.sg_amendments
  for select using (
    agency_id = public.current_agency_id()
    and (status = 'approved' or public.runs_office())
  );

-- Everyone in the office sees who has signed (the change log shows "4 of 6").
drop policy if exists "sg_amendment_signatures: the office reads them" on public.sg_amendment_signatures;
create policy "sg_amendment_signatures: the office reads them" on public.sg_amendment_signatures
  for select using (agency_id = public.current_agency_id());

-- Grants (every new table in public carries its own): read only for a
-- signed-in person, through the policies above. Every change goes through
-- the functions below.
revoke all on table public.sg_amendments from public, anon, authenticated;
grant select on public.sg_amendments to authenticated;
grant select, insert, update, delete on public.sg_amendments to service_role;

revoke all on table public.sg_amendment_signatures from public, anon, authenticated;
grant select on public.sg_amendment_signatures to authenticated;
grant select, insert, update, delete on public.sg_amendment_signatures to service_role;

drop trigger if exists sg_amendments_not_ended_guard on public.sg_amendments;
create trigger sg_amendments_not_ended_guard before insert or update or delete on public.sg_amendments
  for each row execute function public.guard_agency_not_ended();
drop trigger if exists sg_amendment_signatures_not_ended_guard on public.sg_amendment_signatures;
create trigger sg_amendment_signatures_not_ended_guard before insert or update or delete on public.sg_amendment_signatures
  for each row execute function public.guard_agency_not_ended();

-- ── Save a quick amendment, as a draft or approved. ──────────────────────
-- p_id: the draft being saved again, or null for a new one. The wording it
-- replaces is the paragraph as the live document stands now: the newest
-- approved amendment to it, else the document's own words.
create or replace function public.save_sg_amendment(
  p_id uuid,
  p_document_id uuid,
  p_section_position integer,
  p_paragraph_index integer,
  p_new_text text,
  p_reason text,
  p_reason_other text,
  p_starts_on date,
  p_approve boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_uid uuid := auth.uid();
  v_doc public.sg_documents%rowtype;
  v_section public.sg_document_sections%rowtype;
  v_count integer;
  v_last integer;
  v_previous text;
  v_new text := btrim(coalesce(p_new_text, ''));
  v_other text := nullif(btrim(regexp_replace(coalesce(p_reason_other, ''), '\s+', ' ', 'g')), '');
  v_label text;
  v_name text;
  v_ref integer;
  v_id uuid := p_id;
  v_as text;
begin
  if v_agency is null or v_uid is null or not public.runs_office() then
    raise exception 'Only the licensee in charge or an office manager can amend the supervision guidelines.' using errcode = '42501';
  end if;
  if public.agency_has_ended(v_agency) then
    raise exception 'This office''s subscription has ended.';
  end if;
  select * into v_doc from public.sg_documents where id = p_document_id and agency_id = v_agency;
  if not found or v_doc.status <> 'live' then
    raise exception 'That isn''t the office''s current document. Reload the page.';
  end if;
  select * into v_section from public.sg_document_sections
   where document_id = p_document_id and position = p_section_position;
  if not found then
    raise exception 'Choose a section.';
  end if;
  v_count := coalesce(array_length(v_section.paragraphs, 1), 0);
  -- Paragraphs added by earlier amendments count too: the next one added goes after them.
  select greatest(v_count, coalesce(max(a.paragraph_index) + 1, 0)) into v_last
    from public.sg_amendments a
   where a.document_id = p_document_id and a.section_position = p_section_position and a.status = 'approved';
  if p_paragraph_index is null or p_paragraph_index < 0 or p_paragraph_index > v_last then
    raise exception 'Choose the paragraph to amend.';
  end if;
  if v_new = '' then
    raise exception 'Write the new wording.';
  end if;
  if char_length(v_new) > 20000 then
    raise exception 'Keep the new wording to 20,000 characters.';
  end if;
  if p_reason is null or p_reason not in ('law_change', 'audit_finding', 'complaint', 'staffing', 'other') then
    raise exception 'Choose the reason.';
  end if;
  if p_reason = 'other' and v_other is null then
    raise exception 'Say what the other reason is.';
  end if;
  if char_length(coalesce(v_other, '')) > 200 then
    raise exception 'Keep the reason to 200 characters.';
  end if;
  if p_starts_on is null then
    raise exception 'Give the date it starts.';
  end if;

  -- One amendment to the document at a time.
  perform pg_advisory_xact_lock(hashtextextended('sg_amendment:' || p_document_id::text, 0));

  select a.new_text into v_previous from public.sg_amendments a
   where a.document_id = p_document_id and a.section_position = p_section_position
     and a.paragraph_index = p_paragraph_index and a.status = 'approved'
   order by a.ref_no desc limit 1;
  if not found then
    v_previous := case when p_paragraph_index < v_count then v_section.paragraphs[p_paragraph_index + 1] else '' end;
  end if;
  if btrim(v_new) = btrim(coalesce(v_previous, '')) then
    raise exception 'The new wording is the same as the current wording.';
  end if;

  v_label := left(case when v_section.number is null or btrim(v_section.number) = '' then v_section.title
                       else regexp_replace(btrim(v_section.number), '\.$', '') || '. ' || v_section.title end, 330);
  select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'A team member') into v_name
    from public.profiles where id = v_uid;

  if v_id is null then
    insert into public.sg_amendments (agency_id, document_id, section_position, paragraph_index, section_label,
      previous_text, new_text, reason, reason_other, starts_on, created_by, created_by_name)
    values (v_agency, p_document_id, p_section_position, p_paragraph_index, v_label,
      coalesce(v_previous, ''), v_new, p_reason, case when p_reason = 'other' then v_other end, p_starts_on, v_uid, v_name)
    returning id into v_id;
  else
    update public.sg_amendments set
      section_position = p_section_position, paragraph_index = p_paragraph_index, section_label = v_label,
      previous_text = coalesce(v_previous, ''), new_text = v_new, reason = p_reason,
      reason_other = case when p_reason = 'other' then v_other end, starts_on = p_starts_on
    where id = v_id and agency_id = v_agency and document_id = p_document_id and status = 'draft';
    if not found then
      raise exception 'That draft has already been approved or thrown away. Reload the page.';
    end if;
  end if;

  if coalesce(p_approve, false) then
    select coalesce(max(ref_no), 0) + 1 into v_ref from public.sg_amendments where document_id = p_document_id;
    v_as := case when public.acts_as_licensee() then 'licensee' else 'office_manager' end;
    update public.sg_amendments set
      status = 'approved', ref_no = v_ref, approved_by = v_uid, approved_by_name = v_name,
      approved_as = v_as, approved_at = now()
    where id = v_id;
    -- The approver has read it.
    insert into public.sg_amendment_signatures (amendment_id, agency_id, profile_id, signed_name)
    values (v_id, v_agency, v_uid, v_name)
    on conflict do nothing;
  end if;
  return v_id;
end;
$$;

-- ── Throw a draft away. ──────────────────────────────────────────────────
create or replace function public.discard_sg_amendment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
begin
  if v_agency is null or not public.runs_office() then
    raise exception 'Only the licensee in charge or an office manager can do that.' using errcode = '42501';
  end if;
  update public.sg_amendments set status = 'discarded'
   where id = p_id and agency_id = v_agency and status = 'draft';
  if not found then
    raise exception 'That draft has already been approved or thrown away.';
  end if;
end;
$$;

-- ── Sign an approved amendment: "I've read and understood this change". ──
-- Each person for themselves, on their own office's amendments.
create or replace function public.sign_sg_amendment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_uid uuid := auth.uid();
  v_name text;
begin
  if v_agency is null or v_uid is null then
    raise exception 'Sign in again to sign this.' using errcode = '42501';
  end if;
  if public.agency_has_ended(v_agency) then
    raise exception 'This office''s subscription has ended.';
  end if;
  if not exists (select 1 from public.sg_amendments where id = p_id and agency_id = v_agency and status = 'approved') then
    raise exception 'That change isn''t one to sign.';
  end if;
  select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), '')) into v_name
    from public.profiles where id = v_uid and agency_id = v_agency;
  insert into public.sg_amendment_signatures (amendment_id, agency_id, profile_id, signed_name)
  values (p_id, v_agency, v_uid, v_name)
  on conflict do nothing;
end;
$$;

revoke execute on function public.save_sg_amendment(uuid, uuid, integer, integer, text, text, text, date, boolean) from public, anon;
revoke execute on function public.discard_sg_amendment(uuid) from public, anon;
revoke execute on function public.sign_sg_amendment(uuid) from public, anon;
grant execute on function public.save_sg_amendment(uuid, uuid, integer, integer, text, text, text, date, boolean) to authenticated, service_role;
grant execute on function public.discard_sg_amendment(uuid) to authenticated, service_role;
grant execute on function public.sign_sg_amendment(uuid) to authenticated, service_role;

commit;

-- ── Check query (run after; every column should be true) ─────────────────
-- select
--   to_regclass('public.sg_amendments') is not null
--     and to_regclass('public.sg_amendment_signatures') is not null                    as two_tables,
--   (select relrowsecurity from pg_class where oid = 'public.sg_amendments'::regclass)
--     and (select relrowsecurity from pg_class where oid = 'public.sg_amendment_signatures'::regclass) as rls_on,
--   has_table_privilege('authenticated', 'public.sg_amendments', 'select')
--     and not has_table_privilege('authenticated', 'public.sg_amendments', 'insert')
--     and not has_table_privilege('authenticated', 'public.sg_amendments', 'update')
--     and not has_table_privilege('authenticated', 'public.sg_amendment_signatures', 'insert') as signed_in_read_only,
--   not has_table_privilege('anon', 'public.sg_amendments', 'select')
--     and not has_table_privilege('anon', 'public.sg_amendment_signatures', 'select')  as signed_out_nothing,
--   (select count(*) from pg_proc where proname in ('save_sg_amendment', 'discard_sg_amendment',
--      'sign_sg_amendment') and prosecdef) = 3                                          as three_functions,
--   not has_function_privilege('anon', 'public.sign_sg_amendment(uuid)', 'execute')     as anon_cant_sign,
--   (select count(*) from pg_trigger where tgname in ('sg_amendments_not_ended_guard',
--      'sg_amendment_signatures_not_ended_guard')) = 2                                  as ended_guard,
--   (select count(*) from public.sg_amendments) = 0                                     as nothing_amended_yet;
