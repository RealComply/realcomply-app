-- ===== RUN THIS ONE. Migration 0067, adopting the SG annexure, 14 October 2026 =====
--
-- MIGRATION 0067 — the licensee in charge adopts the RealComply annexure to
-- the agency's Supervision Guidelines, from a link (brief, 14 Oct 2026).
--
-- The link goes in the welcome email (early access offices), in a short email
-- of its own (every other new office, and wherever the person who signed up
-- is not the licensee in charge), and behind the Home card a licensee sees
-- until they adopt. The page it opens is signed out, like the licensee
-- sign-off link.
--
--   1. sg_annexure_links: one row per link. The token, expiry (30 days),
--      the email the link went to, and why it was made. One 'new_office'
--      link per office, so the email at the start of a trial goes once.
--      Nobody signed in or signed out reads this table: only the functions
--      below and the server.
--   2. sg_annexure_adoptions: one row per adoption. Office, annexure version,
--      the name typed, the licence number given, the email the link was sent
--      to, and when. Nothing else: no IP address, no device details. Only the
--      licensee in charge (or an agent on their own plan) can read it. One per
--      office per version, so a double click or a second link adopts once.
--   3. sg_annexure_link_details(token, version): what the signing page shows.
--   4. adopt_sg_annexure(token, version, name, licence): records the
--      adoption once and uses the link up. Refuses a used, expired or unknown
--      link, and an office that has already adopted this version.
--   5. create_sg_annexure_link(): a fresh link for the signed-in licensee in
--      charge, from the Home card. It goes to their own login email.
--   6. Neither table can change once an office's subscription has ended, the
--      same as every other office table.
--
-- The signed copy is saved by the server as a Document sign-offs entry
-- (category 'sg_annexure') that only the licensee can see under the rules
-- already in place, so it reaches "Download all records" and the 7-year
-- activity record like every other sign-off. Nothing that exists today
-- changes.
--
-- Safe while the app now live is in use: it reads none of this.
--
-- Run after 0066. SAFE TO RUN TWICE. One transaction.
--
-- Tests: supabase/tests/sg_annexure_adoption.sql.

begin;

-- ── 0. Order ────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.get_signoff_request_v3(uuid)') is null
     or to_regprocedure('public.guard_agency_not_ended()') is null
     or to_regprocedure('public.acts_as_licensee()') is null then
    raise exception 'Run 0066 before 0067.';
  end if;
end
$$;

-- ── 1. Links ────────────────────────────────────────────────────────────
create table if not exists public.sg_annexure_links (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  sent_to text not null check (btrim(sent_to) <> ''),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  used_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null
);
create index if not exists sg_annexure_links_agency_idx on public.sg_annexure_links (agency_id);

-- Why the link exists: 'home' (the licensee pressed the Home card) or
-- 'new_office' (emailed when a new office's trial starts). Stripe sends more
-- than one event for a new subscription, so the new office's link is claimed
-- by inserting it: one per office, and a second insert fails rather than
-- sending a second email.
alter table public.sg_annexure_links
  add column if not exists purpose text not null default 'home';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sg_annexure_links_purpose_check') then
    alter table public.sg_annexure_links
      add constraint sg_annexure_links_purpose_check check (purpose in ('home', 'new_office'));
  end if;
end
$$;
create unique index if not exists sg_annexure_links_new_office_once
  on public.sg_annexure_links (agency_id) where purpose = 'new_office';

comment on table public.sg_annexure_links is
  'A link to adopt the SG annexure (0067). The token is a key, not a record: it is never shown in the app or exported.';

-- ── 2. Adoptions ────────────────────────────────────────────────────────
create table if not exists public.sg_annexure_adoptions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  annexure_version text not null check (annexure_version ~ '^[0-9]+\.[0-9]+$'),
  signed_name text not null check (length(btrim(signed_name)) between 2 and 120),
  licence_number text not null check (length(btrim(licence_number)) between 1 and 40),
  sent_to text not null check (btrim(sent_to) <> ''),
  signed_at timestamptz not null default now(),
  -- The signed copy in Document sign-offs, once the server has saved it.
  signoff_document_id uuid references public.signoff_documents(id) on delete set null,
  constraint sg_annexure_adoptions_once unique (agency_id, annexure_version)
);

comment on table public.sg_annexure_adoptions is
  'The licensee in charge adopting the SG annexure (0067): office, version, typed name, licence number given, the email the link went to, and when. Nothing else.';

alter table public.sg_annexure_links enable row level security;
alter table public.sg_annexure_adoptions enable row level security;

-- Links: no policy at all. Read and written only by the functions below and
-- the server.
-- Adoptions: the licensee in charge (or an agent on their own plan) reads
-- their own office's. Nobody signed in writes them.
drop policy if exists "sg_annexure_adoptions: licensee can view" on public.sg_annexure_adoptions;
create policy "sg_annexure_adoptions: licensee can view" on public.sg_annexure_adoptions
  for select using (agency_id = public.current_agency_id() and public.acts_as_licensee());

-- Data API grants: every new table states who may read it.
revoke all on public.sg_annexure_links, public.sg_annexure_adoptions from anon, authenticated;
grant select on public.sg_annexure_adoptions to authenticated;
grant all on public.sg_annexure_links, public.sg_annexure_adoptions to service_role;

-- ── 6. Not once the subscription has ended ──────────────────────────────
drop trigger if exists sg_annexure_links_not_ended_guard on public.sg_annexure_links;
create trigger sg_annexure_links_not_ended_guard
  before insert or update or delete on public.sg_annexure_links
  for each row execute function public.guard_agency_not_ended();
drop trigger if exists sg_annexure_adoptions_not_ended_guard on public.sg_annexure_adoptions;
create trigger sg_annexure_adoptions_not_ended_guard
  before insert or update or delete on public.sg_annexure_adoptions
  for each row execute function public.guard_agency_not_ended();

-- ── 3. What the signing page shows ──────────────────────────────────────
-- The licence number the page fills in: the agency's corporation licence;
-- otherwise the licensee in charge's own licence; on an agent's own plan, the
-- agent's. Null when none is recorded, and the page asks for it.
--
-- state: 'adopted' (this office has adopted this version, by any link),
-- 'ended' (subscription ended), 'used', 'expired', or 'open'.
create or replace function public.sg_annexure_link_details(p_token uuid, p_version text)
returns table (
  agency_id uuid,
  agency_name text,
  licence_number text,
  logo_path text,
  sent_to text,
  state text,
  adopted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id,
         a.name,
         coalesce(
           nullif(btrim(a.corporation_licence_number), ''),
           (select nullif(btrim(p.licence_number), '')
              from public.profiles p
             where p.agency_id = a.id and p.archived_at is null
               and (p.is_licensee_in_charge or (left(a.plan, 6) = 'agent_' and not p.is_assistant))
             order by p.is_licensee_in_charge desc, p.created_at
             limit 1)),
         a.logo_path,
         l.sent_to,
         case
           when ad.id is not null then 'adopted'
           when a.ended_at is not null then 'ended'
           when l.used_at is not null then 'used'
           when l.expires_at <= now() then 'expired'
           else 'open'
         end,
         ad.signed_at
    from public.sg_annexure_links l
    join public.agencies a on a.id = l.agency_id
    left join public.sg_annexure_adoptions ad
      on ad.agency_id = l.agency_id and ad.annexure_version = p_version
   where l.token = p_token;
$$;
revoke execute on function public.sg_annexure_link_details(uuid, text) from public;
grant execute on function public.sg_annexure_link_details(uuid, text) to anon, authenticated;

-- ── 4. Adopting ─────────────────────────────────────────────────────────
-- The link row is locked first, so two presses at once adopt once: the second
-- waits, then finds the link used. The unique constraint covers two different
-- links for the same office.
create or replace function public.adopt_sg_annexure(
  p_token uuid,
  p_version text,
  p_signed_name text,
  p_licence_number text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.sg_annexure_links;
  v_name text := btrim(coalesce(p_signed_name, ''));
  v_licence text := btrim(coalesce(p_licence_number, ''));
  v_id uuid;
begin
  if p_version is null or p_version !~ '^[0-9]+\.[0-9]+$' then
    raise exception 'That version of the annexure is not one RealComply knows.';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Type your full name.';
  end if;
  if length(v_licence) < 1 or length(v_licence) > 40 then
    raise exception 'Type your licence number.';
  end if;

  select * into v_link from public.sg_annexure_links where token = p_token for update;
  if not found or v_link.used_at is not null or v_link.expires_at <= now() then
    raise exception 'This link is no longer valid.';
  end if;
  if exists (select 1 from public.sg_annexure_adoptions
              where agency_id = v_link.agency_id and annexure_version = p_version) then
    raise exception 'This annexure has already been adopted.';
  end if;

  insert into public.sg_annexure_adoptions (agency_id, annexure_version, signed_name, licence_number, sent_to)
  values (v_link.agency_id, p_version, v_name, v_licence, v_link.sent_to)
  returning id into v_id;
  update public.sg_annexure_links set used_at = now() where id = v_link.id;
  return v_id;
end
$$;
revoke execute on function public.adopt_sg_annexure(uuid, text, text, text) from public;
grant execute on function public.adopt_sg_annexure(uuid, text, text, text) to anon, authenticated;

-- ── 5. A fresh link for the signed-in licensee ──────────────────────────
-- For the Home card. Only the licensee in charge, or an agent on their own
-- plan; the link goes to their own login email.
create or replace function public.create_sg_annexure_link()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_email text;
  v_token uuid;
begin
  if v_agency is null or not public.acts_as_licensee() then
    raise exception 'Only the licensee in charge can adopt the annexure.';
  end if;
  select nullif(lower(btrim(email)), '') into v_email from public.profiles where id = auth.uid();
  if v_email is null then
    raise exception 'Your login has no email address.';
  end if;
  insert into public.sg_annexure_links (agency_id, sent_to, created_by)
  values (v_agency, v_email, auth.uid())
  returning token into v_token;
  return v_token;
end
$$;
revoke execute on function public.create_sg_annexure_link() from public, anon;
grant execute on function public.create_sg_annexure_link() to authenticated;

commit;

-- Check: one row, every column true.
select to_regclass('public.sg_annexure_links') is not null as links_table,
       to_regclass('public.sg_annexure_adoptions') is not null as adoptions_table,
       to_regprocedure('public.sg_annexure_link_details(uuid, text)') is not null as details_function,
       to_regprocedure('public.adopt_sg_annexure(uuid, text, text, text)') is not null as adopt_function,
       to_regprocedure('public.create_sg_annexure_link()') is not null as fresh_link_function;
