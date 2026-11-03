-- ===== 0108: The office manager sees every listing; gift and complaint reviews record who and when =====
--
-- Monthly licensee sign-off pack, part 1 (Adam, 3 Nov 2026). Run after 0107.
--
-- 1. THE OFFICE MANAGER SEES EVERY LISTING (Adam, 3 Nov 2026: "the office
--    manager sees everything. That's the way it was designed. The licensee
--    signs off on authority for them to have access to everything." Then:
--    "see them", not work on them).
--    Was (0093, 29 Oct 2026): every listing in the office was "not decided
--    yet, so left with the licensee"; an office manager saw their own
--    listings and their own property management properties, like any agent.
--    Now: an office manager can READ every listing and property management
--    property in their office: every card, flag, note, document and link
--    status. Only the "can view" rules change. Every "can add" and "can
--    change" rule is untouched, so they still can't tick, upload, edit,
--    send or copy anything on another agent's file.
--
-- 2. GIFT REVIEWS ARE THE LICENSEE'S (Adam, 3 Nov 2026).
--    Was (0093): the licensee in charge or the office manager could mark a
--    gift over the limit reviewed, and nothing recorded who or when.
--    Now: only the licensee in charge (or the agent on their own plan) marks
--    a gift reviewed, and the database records who and when. The office
--    manager still records gifts and edits their notes. Reviews done before
--    this stay as they are, with no name or time filled in.
--
-- 3. COMPLAINTS (Adam, 3 Nov 2026).
--    Was (0058, 0102): only the licensee in charge could move a complaint to
--    Under review or Resolved, and nothing recorded who or when; the office
--    manager could only add and read.
--    Now: the licensee or the office manager can mark a complaint Under
--    review or Resolved, and each records who and when. Once it is
--    Resolved, the licensee in charge signs it off: "I've reviewed how this
--    complaint was handled and resolved." (sign_off_complaint), recording
--    who and when. A signed-off complaint's status no longer changes.
--    Agents still have no access to complaints. Complaints already resolved
--    stay as they are, with no names filled in; they wait for the
--    licensee's sign-off like any other resolved complaint.
--
-- New columns only on existing tables, with their grants below. Safe to run
-- twice.

begin;

-- ── 1. Reading, for the office manager ────────────────────────────────
-- What can_see_property() allows (the listing's agent, their assistant, the
-- licensee), plus the office's approved office manager, to read.
create or replace function public.can_read_property(p_property uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.can_see_property(p_property)
      or (public.is_office_manager()
          and exists (select 1 from public.properties p
                       where p.id = p_property and p.agency_id = public.current_agency_id()));
$$;
revoke execute on function public.can_read_property(uuid) from public, anon;
grant execute on function public.can_read_property(uuid) to authenticated, service_role;

create or replace function public.can_read_pm_property(p_property uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.can_see_pm_property(p_property)
      or (public.is_office_manager()
          and exists (select 1 from public.pm_properties p
                       where p.id = p_property and p.agency_id = public.current_agency_id()));
$$;
revoke execute on function public.can_read_pm_property(uuid) from public, anon;
grant execute on function public.can_read_pm_property(uuid) to authenticated, service_role;

-- The listing's "can view" rules. Each was
--   agency_id = current_agency_id() and can_see_property(property_id)
-- and is now the same with can_read_property.
alter policy "listing_reopen_requests: whoever sees the listing can view" on public.listing_reopen_requests
  using (agency_id = public.current_agency_id() and public.can_read_property(property_id));
alter policy "listing_send_back_items: whoever sees the listing can view" on public.listing_send_back_items
  using (agency_id = public.current_agency_id() and public.can_read_property(property_id));
alter policy "listing_send_backs: whoever sees the listing can view" on public.listing_send_backs
  using (agency_id = public.current_agency_id() and public.can_read_property(property_id));
alter policy "listing_signoff_cancellations: whoever sees the listing can vie" on public.listing_signoff_cancellations
  using (agency_id = public.current_agency_id() and public.can_read_property(property_id));
alter policy "comparables: whoever sees the listing can view" on public.property_comparables
  using (agency_id = public.current_agency_id() and public.can_read_property(property_id));
alter policy "property_items: whoever sees the listing can view" on public.property_items
  using (agency_id = public.current_agency_id() and public.can_read_property(property_id));
alter policy "market listings: whoever sees the listing can view" on public.property_market_listings
  using (agency_id = public.current_agency_id() and public.can_read_property(property_id));
alter policy "signoff requests: whoever sees the listing can view" on public.property_signoff_requests
  using (agency_id = public.current_agency_id() and public.can_read_property(property_id));
alter policy "property_transfers: whoever sees the listing can view" on public.property_transfers
  using (agency_id = public.current_agency_id() and public.can_read_property(property_id));
alter policy "signoff_link_copies: office reads its listings" on public.signoff_link_copies
  using (agency_id = public.current_agency_id() and public.can_read_property(property_id));
alter policy "superseded_agent_signatures: whoever sees the listing can view" on public.superseded_agent_signatures
  using (agency_id = public.current_agency_id() and public.can_read_property(property_id));
-- Was: agency_id = current_agency_id() and can_see_agent(created_by)
alter policy "properties: own, assisted or licensee can view" on public.properties
  using (agency_id = public.current_agency_id()
         and (public.can_see_agent(created_by) or public.is_office_manager()));

-- Property management's "can view" rules, the same way.
alter policy "pm_group_moves: whoever sees the property can view" on public.pm_group_moves
  using (agency_id = public.current_agency_id() and public.can_read_pm_property(property_id));
alter policy "pm_item_events: whoever sees the property can view" on public.pm_item_events
  using (agency_id = public.current_agency_id() and public.can_read_pm_property(property_id));
alter policy "pm_item_states: whoever sees the property can view" on public.pm_item_states
  using (agency_id = public.current_agency_id() and public.can_read_pm_property(property_id));
alter policy "pm_records: whoever sees the property can view" on public.pm_records
  using (agency_id = public.current_agency_id() and public.can_read_pm_property(property_id));
alter policy "pm_tenancies: whoever sees the property can view" on public.pm_tenancies
  using (agency_id = public.current_agency_id() and public.can_read_pm_property(property_id));
-- Was: agency_id = current_agency_id() and can_see_agent(manager_id)
alter policy "pm_properties: manager, assistant or licensee can view" on public.pm_properties
  using (agency_id = public.current_agency_id()
         and (public.can_see_agent(manager_id) or public.is_office_manager()));

-- A complaint the office manager logs can name any listing in the office now
-- they can see it (was: only their own, 0102).
alter policy "complaints: office manager can add" on public.complaints
  with check (agency_id = public.current_agency_id() and public.is_office_manager()
              and created_by = auth.uid() and status = 'open' and resolved_date is null
              and (property_id is null or public.can_read_property(property_id)));

-- The listing's files, to read: the same as 0102 with can_read_property for a
-- listing's folder. Uploading (evidence_path_writable) is unchanged.
create or replace function public.evidence_path_readable(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_seg text[] := storage.foldername(p_name);
begin
  if public.current_agency_id() is null or v_seg[1] is distinct from public.current_agency_id()::text then
    return false;
  end if;
  -- 0101: complaint files, the licensee in charge of the office only.
  -- 0102: and an office manager, to read (Adam, 31 Oct 2026).
  if v_seg[2] = '_complaints' then
    return public.is_office_licensee() or public.is_office_manager();
  end if;
  if public.acts_as_licensee() then
    return true;
  end if;
  if v_seg[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    -- 0108: every listing's files, to read, for an office manager.
    return public.can_read_property(v_seg[2]::uuid);
  end if;
  -- 0093: the office's own records, for an office manager.
  if public.is_office_manager() then
    return true;
  end if;
  if v_seg[2] in ('_licences', '_cpd') then
    return v_seg[3] = auth.uid()::text;
  end if;
  if v_seg[2] in ('_brand', '_sg-manual', '_pending') then
    return true;
  end if;
  if v_seg[2] = '_signoffs' then
    return exists (
      select 1 from public.signoff_documents d
       where d.agency_id = public.current_agency_id()
         and (d.file_path = p_name or d.signed_file_path = p_name)
         and (d.uploaded_by = auth.uid()
              or exists (select 1 from public.signoff_signatures s
                          where s.document_id = d.id and s.signer_id = auth.uid())));
  end if;
  return false;
end
$$;

-- Who uploaded each of a listing's files (0102): readable by whoever can read
-- the listing.
create or replace function public.listing_file_uploads(p_property_id uuid)
returns table (path text, uploaded_by uuid, uploaded_by_name text, uploaded_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_agency uuid;
begin
  select p.agency_id into v_agency from public.properties p where p.id = p_property_id;
  if v_agency is null then
    return;
  end if;
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '') <> 'service_role' then
    if v_agency is distinct from public.current_agency_id() or not public.can_read_property(p_property_id) then
      return;
    end if;
  end if;

  return query
    select o.name::text,
           pr.id,
           coalesce(nullif(btrim(pr.full_name), ''), pr.email)::text,
           o.created_at
      from storage.objects o
      left join public.profiles pr
        on pr.id::text = coalesce(o.owner_id, o.owner::text)
       and pr.agency_id = v_agency
     where o.bucket_id = 'compliance-evidence'
       and o.name like v_agency::text || '/' || p_property_id::text || '/%';
end
$$;

-- ── 2. Gift reviews: the licensee's, with who and when ─────────────────
alter table public.gifts add column if not exists reviewed_by uuid references public.profiles (id) on delete set null;
alter table public.gifts add column if not exists reviewed_by_name text;
alter table public.gifts add column if not exists reviewed_at timestamptz;
comment on column public.gifts.reviewed_by_name is
  'Who marked the gift reviewed, as their name was then (0108). Null for reviews before 0108.';

-- Runs as the caller (not security definer), so current_user tells
-- RealComply's own code from someone signed in.
create or replace function public.guard_gift_review()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_name text;
begin
  -- RealComply's own code (a signing link, a monthly pack) records its own
  -- reviews; everyone else goes through the checks below.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    new.reviewed_by := old.reviewed_by;
    new.reviewed_by_name := old.reviewed_by_name;
    new.reviewed_at := old.reviewed_at;
    return new;
  end if;
  if new.status = 'reviewed' or (tg_op = 'UPDATE' and old.status = 'reviewed') then
    if not public.acts_as_licensee() then
      raise exception 'Only the licensee in charge can mark a gift reviewed.' using errcode = '42501';
    end if;
  end if;
  if new.status = 'reviewed' then
    select coalesce(nullif(btrim(full_name), ''), email) into v_name from public.profiles where id = auth.uid();
    new.reviewed_by := auth.uid();
    new.reviewed_by_name := v_name;
    new.reviewed_at := now();
  else
    new.reviewed_by := null;
    new.reviewed_by_name := null;
    new.reviewed_at := null;
  end if;
  return new;
end
$$;
drop trigger if exists gifts_review_guard on public.gifts;
create trigger gifts_review_guard before insert or update on public.gifts
  for each row execute function public.guard_gift_review();

-- ── 3. Complaints: Under review and Resolved, then the licensee's sign-off ─
alter table public.complaints add column if not exists under_review_by uuid references public.profiles (id) on delete set null;
alter table public.complaints add column if not exists under_review_by_name text;
alter table public.complaints add column if not exists under_review_at timestamptz;
alter table public.complaints add column if not exists resolved_by uuid references public.profiles (id) on delete set null;
alter table public.complaints add column if not exists resolved_by_name text;
alter table public.complaints add column if not exists resolved_at timestamptz;
alter table public.complaints add column if not exists signed_off_by uuid references public.profiles (id) on delete set null;
alter table public.complaints add column if not exists signed_off_name text;
alter table public.complaints add column if not exists signed_off_at timestamptz;
comment on column public.complaints.signed_off_at is
  'When the licensee in charge signed off a resolved complaint: "I''ve reviewed how this complaint was handled and resolved." (0108).';

-- The office manager may move a complaint on (0108). What they may change is
-- limited by guard_complaint_update below.
drop policy if exists "complaints: office manager can move it on" on public.complaints;
create policy "complaints: office manager can move it on" on public.complaints
  for update
  using (agency_id = public.current_agency_id() and public.is_office_manager())
  with check (agency_id = public.current_agency_id() and public.is_office_manager());

-- Runs as the caller (not security definer), so current_user tells
-- RealComply's own code from someone signed in.
create or replace function public.guard_complaint_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_name text;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- Who and when are the database's to write, never the app's.
  if tg_op = 'INSERT' then
    new.under_review_by := null; new.under_review_by_name := null; new.under_review_at := null;
    new.resolved_by := null; new.resolved_by_name := null; new.resolved_at := null;
    new.signed_off_by := null; new.signed_off_name := null; new.signed_off_at := null;
  else
    new.under_review_by := old.under_review_by; new.under_review_by_name := old.under_review_by_name;
    new.under_review_at := old.under_review_at;
    new.resolved_by := old.resolved_by; new.resolved_by_name := old.resolved_by_name;
    new.resolved_at := old.resolved_at;
    new.signed_off_by := old.signed_off_by; new.signed_off_name := old.signed_off_name;
    new.signed_off_at := old.signed_off_at;

    if old.signed_off_at is not null and new.status is distinct from old.status then
      raise exception 'This complaint is signed off. Its status can''t change.' using errcode = 'P0001';
    end if;

    -- The office manager moves a complaint on, and changes nothing else
    -- (Legal, 3 Nov 2026: "the office manager can change only the status,
    -- not the details"). Every column but the status and what the database
    -- writes with it is compared, so a column added later is covered too.
    if public.is_office_manager() and not public.is_office_licensee() then
      if new.status is distinct from old.status
         and (old.status = 'resolved' or new.status not in ('under_review', 'resolved')) then
        raise exception 'An office manager can mark a complaint Under review or Resolved.' using errcode = '42501';
      end if;
      if (to_jsonb(new) - array['status', 'resolved_date', 'under_review_by', 'under_review_by_name', 'under_review_at',
                                'resolved_by', 'resolved_by_name', 'resolved_at',
                                'signed_off_by', 'signed_off_name', 'signed_off_at'])
         is distinct from
         (to_jsonb(old) - array['status', 'resolved_date', 'under_review_by', 'under_review_by_name', 'under_review_at',
                                'resolved_by', 'resolved_by_name', 'resolved_at',
                                'signed_off_by', 'signed_off_name', 'signed_off_at']) then
        raise exception 'An office manager can mark a complaint Under review or Resolved, and change nothing else.'
          using errcode = '42501';
      end if;
      -- The date it was resolved is the database's: today, when they mark it
      -- Resolved below. They can't give one, or change it later.
      if new.status is distinct from old.status then
        new.resolved_date := null;
      elsif new.resolved_date is distinct from old.resolved_date then
        raise exception 'An office manager can mark a complaint Under review or Resolved, and change nothing else.'
          using errcode = '42501';
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' or new.status is distinct from old.status then
    select coalesce(nullif(btrim(full_name), ''), email) into v_name from public.profiles where id = v_me;
    if new.status = 'under_review' then
      new.under_review_by := v_me; new.under_review_by_name := v_name; new.under_review_at := now();
    elsif new.status = 'resolved' then
      new.resolved_by := v_me; new.resolved_by_name := v_name; new.resolved_at := now();
      new.resolved_date := coalesce(new.resolved_date, (now() at time zone 'Australia/Sydney')::date);
    end if;
    if tg_op = 'UPDATE' and old.status = 'resolved' and new.status <> 'resolved' then
      new.resolved_by := null; new.resolved_by_name := null; new.resolved_at := null;
      new.resolved_date := null;
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists complaints_update_guard on public.complaints;
create trigger complaints_update_guard before insert or update on public.complaints
  for each row execute function public.guard_complaint_update();

-- The licensee's sign-off of a resolved complaint, in the app.
create or replace function public.sign_off_complaint(p_complaint_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.complaints%rowtype;
  v_name text;
  v_at timestamptz := now();
begin
  if auth.uid() is null or not public.is_office_licensee() then
    raise exception 'Only the licensee in charge can sign off a complaint.' using errcode = '42501';
  end if;
  select * into v_row from public.complaints
   where id = p_complaint_id and agency_id = public.current_agency_id();
  if v_row.id is null then
    raise exception 'That complaint isn''t on your register.' using errcode = '42501';
  end if;
  if v_row.status <> 'resolved' then
    raise exception 'Mark the complaint Resolved first.' using errcode = 'P0001';
  end if;
  if v_row.signed_off_at is not null then
    return v_row.signed_off_at;
  end if;
  select coalesce(nullif(btrim(full_name), ''), email) into v_name from public.profiles where id = auth.uid();
  update public.complaints
     set signed_off_by = auth.uid(), signed_off_name = v_name, signed_off_at = v_at
   where id = v_row.id;
  return v_at;
end
$$;
revoke execute on function public.sign_off_complaint(uuid) from public, anon;
grant execute on function public.sign_off_complaint(uuid) to authenticated, service_role;

-- Data API grants for the new columns (Adam's rule: a new column or table
-- needs its grants). The office reads them; only the triggers and
-- sign_off_complaint() write them.
grant select (reviewed_by, reviewed_by_name, reviewed_at) on public.gifts to authenticated;
grant select, update (reviewed_by, reviewed_by_name, reviewed_at) on public.gifts to service_role;
grant select (under_review_by, under_review_by_name, under_review_at, resolved_by, resolved_by_name, resolved_at,
              signed_off_by, signed_off_name, signed_off_at) on public.complaints to authenticated;
grant select, update (under_review_by, under_review_by_name, under_review_at, resolved_by, resolved_by_name, resolved_at,
                      signed_off_by, signed_off_name, signed_off_at) on public.complaints to service_role;

commit;

-- ── Check ──────────────────────────────────────────────────────────────
-- One row, every value true.
select
  has_function_privilege('authenticated', 'public.can_read_property(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.can_read_property(uuid)', 'execute') as read_property_ready,
  (select count(*) from pg_policies where schemaname = 'public' and cmd = 'SELECT'
      and qual ~ 'can_read_(pm_)?property|is_office_manager') >= 18 as view_rules_widened,
  (select count(*) from pg_policies where schemaname = 'public' and cmd in ('INSERT', 'UPDATE')
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'can_see_(property|pm_property|agent)') >= 15 as change_rules_untouched,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'gifts'
      and column_name in ('reviewed_by', 'reviewed_by_name', 'reviewed_at')) = 3 as gift_review_columns,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'complaints'
      and column_name like any (array['under_review_%', 'resolved_by%', 'resolved_at', 'signed_off_%'])) >= 9 as complaint_columns,
  exists (select 1 from pg_trigger where tgname = 'gifts_review_guard')
    and exists (select 1 from pg_trigger where tgname = 'complaints_update_guard') as guards_on,
  has_function_privilege('authenticated', 'public.sign_off_complaint(uuid)', 'execute') as sign_off_ready;
