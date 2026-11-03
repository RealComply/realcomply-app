-- ===== 0107: Email that gets through: Copy link, Opened, and the nudge =====
--
-- WHY (Adam, 2 Nov 2026, queue item 2). Vic Srbinovski (Raine & Horne
-- Queanbeyan) didn't get a price statement approval email on 21 Oct: it was
-- most likely held by his office's email security. Offices must never need
-- IT to let RealComply through, and must never rely on email alone. Every
-- emailed approval or signing link now shows "Sent [date]", then "Opened
-- [date, time]" only when a real person opens it in a browser, and after 2
-- business days unopened a nudge on Home and on the card.
--
-- COPY LINK, OPTION 2 (Adam, 3 Nov 2026). Was (9 Oct 2026, 0058): nobody
-- signed in can read a link's token, because an agent holding the link could
-- open it and sign as the licensee. Now:
--   * File sign-off (property_signoff_requests, sign_licensee): Copy link,
--     with a trail. Every copy is recorded (who, when) in
--     signoff_link_copies, and a signature given after a copy says so on the
--     record and in the audit pack. The token is still never readable from
--     the table: copy_signoff_link() records the copy and only then hands it
--     back.
--   * Office manager approval and the annexure: no Copy link. The person
--     asking is the person being approved, and the annexure is adopted in the
--     licensee's name. Opened status and the nudge only.
--   * Trust reconciliations and the SG Manual stay with the licensee, signed
--     in the app (Adam, 3 Nov 2026). Nothing here changes them.
-- Who can sign anything is unchanged.
--
-- WHAT COUNTS AS OPENED. A security scanner fetching the link must not count.
-- The page reports an open only after a person scrolls, taps, moves the mouse
-- or types on it in a browser (src/components/links/OpenedBeacon.tsx), and
-- never when the visitor is signed in to the same office (an agent checking
-- the link they copied is not the licensee opening it). Signing or approving
-- counts as opened too; the app reads that from signed_at / approved_at /
-- used_at.
--
-- One new table, with its grants. Safe to run twice.

begin;

-- ── 1. When each link was first opened by a person ─────────────────────
alter table public.property_signoff_requests add column if not exists opened_at timestamptz;
alter table public.office_manager_requests add column if not exists opened_at timestamptz;
alter table public.sg_annexure_links add column if not exists opened_at timestamptz;
-- The annexure email's delivery, like the other two (0047, 0093): when it
-- reached the provider. Null for links sent before this.
alter table public.sg_annexure_links add column if not exists email_sent_at timestamptz;

comment on column public.property_signoff_requests.opened_at is
  'When a person first opened the link in a browser (scrolled, tapped, moved the mouse or typed), not a security scanner fetching it (0107).';
comment on column public.office_manager_requests.opened_at is
  'When a person first opened the link in a browser (0107).';
comment on column public.sg_annexure_links.opened_at is
  'When a person first opened the link in a browser (0107).';
comment on column public.sg_annexure_links.email_sent_at is
  'When the annexure email reached the email provider (0107). Null for links sent before 0107.';

-- The signed-in may read when it was opened, as they read when it was sent.
-- Never the token.
grant select (opened_at) on public.property_signoff_requests to authenticated;
grant select (opened_at) on public.office_manager_requests to authenticated;

-- ── 2. Every copy of a file sign-off link ──────────────────────────────
create table if not exists public.signoff_link_copies (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.property_signoff_requests (id) on delete cascade,
  agency_id   uuid not null references public.agencies (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  copied_by   uuid references public.profiles (id) on delete set null,
  -- The name as it was when copied, for the record after a person leaves.
  copied_by_name text not null,
  copied_at   timestamptz not null default now()
);
comment on table public.signoff_link_copies is
  'Each time someone copied a file sign-off link to send it themselves (0107, Adam 3 Nov 2026, option 2). A signature given after a copy says so on the record.';
create index if not exists signoff_link_copies_request on public.signoff_link_copies (request_id, copied_at);

alter table public.signoff_link_copies enable row level security;
drop policy if exists "signoff_link_copies: office reads its listings" on public.signoff_link_copies;
create policy "signoff_link_copies: office reads its listings" on public.signoff_link_copies
  for select using (agency_id = public.current_agency_id() and public.can_see_property(property_id));

-- Data API grants: read by the office, written only by copy_signoff_link().
revoke all on table public.signoff_link_copies from public, anon, authenticated;
grant select on public.signoff_link_copies to authenticated;
grant select, insert, update, delete on public.signoff_link_copies to service_role;

-- ── 3. Copy link: record the copy, then hand back the token ────────────
-- Anyone who can see the listing, for a file sign-off link that can still be
-- signed. Not a price statement link (none can be signed since 0104).
create or replace function public.copy_signoff_link(p_request_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_req public.property_signoff_requests%rowtype;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Sign in again to copy the link.' using errcode = '42501';
  end if;
  select * into v_req from public.property_signoff_requests where id = p_request_id;
  if v_req.id is null
     or v_req.agency_id is distinct from public.current_agency_id()
     or not public.can_see_property(v_req.property_id) then
    raise exception 'That link isn''t on a listing you can see.' using errcode = '42501';
  end if;
  if coalesce(v_req.item_key, 'sign_licensee') <> 'sign_licensee'
     or v_req.signed_at is not null or v_req.revoked_at is not null or v_req.expires_at <= now() then
    raise exception 'That link can''t be signed any more. Send a new one.' using errcode = 'P0001';
  end if;
  select coalesce(nullif(btrim(full_name), ''), email) into v_name from public.profiles where id = auth.uid();
  insert into public.signoff_link_copies (request_id, agency_id, property_id, copied_by, copied_by_name)
  values (v_req.id, v_req.agency_id, v_req.property_id, auth.uid(), coalesce(v_name, 'Someone in the office'));
  return v_req.token;
end
$$;
revoke execute on function public.copy_signoff_link(uuid) from public, anon;
grant execute on function public.copy_signoff_link(uuid) to authenticated, service_role;

-- ── 4. Opened: a person opened the link in a browser ──────────────────
-- Called by the page once someone interacts with it. Says nothing back, so it
-- can't be used to find out which tokens are real. The first open counts;
-- later ones change nothing. Not counted for someone signed in to the same
-- office, and not once the link has expired.
create or replace function public.note_link_opened(p_kind text, p_token uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_viewer_agency uuid := case when auth.uid() is null then null else public.current_agency_id() end;
begin
  if p_token is null then
    return;
  end if;
  if p_kind = 'signoff' then
    update public.property_signoff_requests
       set opened_at = now()
     where token = p_token and opened_at is null and revoked_at is null and expires_at > now()
       and agency_id is distinct from v_viewer_agency;
  elsif p_kind = 'office_manager' then
    update public.office_manager_requests
       set opened_at = now()
     where token = p_token and opened_at is null and cancelled_at is null and expires_at > now()
       and agency_id is distinct from v_viewer_agency;
  elsif p_kind = 'annexure' then
    update public.sg_annexure_links
       set opened_at = now()
     where token = p_token and opened_at is null and expires_at > now()
       and agency_id is distinct from v_viewer_agency;
  end if;
end
$$;
revoke execute on function public.note_link_opened(text, uuid) from public;
grant execute on function public.note_link_opened(text, uuid) to anon, authenticated, service_role;

-- ── 5. The annexure link, for the office that's waiting on it ──────────
-- Whoever set the new office up (the account holder) or runs it sees whether
-- the annexure email reached their licensee and whether it was opened. No
-- token, no Copy link.
create or replace function public.office_annexure_link_status()
returns table (sent_to text, created_at timestamptz, email_sent_at timestamptz, opened_at timestamptz,
               used_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select l.sent_to, l.created_at, l.email_sent_at, l.opened_at, l.used_at, l.expires_at
    from public.sg_annexure_links l
   where l.agency_id = public.current_agency_id()
     and l.purpose = 'new_office'
     and (public.runs_office() or public.is_account_holder())
   order by l.created_at desc
   limit 1;
$$;
revoke execute on function public.office_annexure_link_status() from public, anon;
grant execute on function public.office_annexure_link_status() to authenticated, service_role;

commit;

-- ── Check ──────────────────────────────────────────────────────────────
-- One row, every value true.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and column_name = 'opened_at'
      and table_name in ('property_signoff_requests', 'office_manager_requests', 'sg_annexure_links')) = 3
    as opened_columns_added,
  to_regclass('public.signoff_link_copies') is not null
    and has_table_privilege('authenticated', 'public.signoff_link_copies', 'select')
    and not has_table_privilege('authenticated', 'public.signoff_link_copies', 'insert')
    and not has_table_privilege('anon', 'public.signoff_link_copies', 'select') as copies_table_ready,
  has_function_privilege('authenticated', 'public.copy_signoff_link(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.copy_signoff_link(uuid)', 'execute') as copy_link_ready,
  has_function_privilege('anon', 'public.note_link_opened(text, uuid)', 'execute') as opened_ready,
  not has_column_privilege('authenticated', 'public.property_signoff_requests', 'token', 'select') as token_still_hidden;
