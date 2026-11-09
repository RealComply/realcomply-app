-- ===== 0121: Every version of a listing's Statement of Information =====
--
-- NSW underquoting changes, statement of information from 8 February 2027
-- (Adam, 9 Nov 2026: "go ahead with the Statement of Information"; "both":
-- RealComply makes it from the listing's records, or the agent uploads one
-- made elsewhere. Adam, 10 Nov 2026, through Master: a public link for ads,
-- the agent's own document published by their choice).
--
-- s72C(1), (2): an agent who enters into an agency agreement prepares a
--   statement of information in the approved form, with what Reg s12H
--   prescribes.
-- s72C(5), Reg s12I: revised within 2 business days of an ESP revision that
--   uses different comparable properties.
-- s72C(6): a copy of the original and of each revised version kept for at
--   least 3 years.
-- s72C(4): a copy in every online ad, or on a website the ad links to.
--
-- WAS: nothing kept a statement of information.
-- NOW: a new table, statements_of_information. One row per version, numbered
-- 1, 2, 3 for the listing, never changed once added:
--   * the PDF, in the listing's own folder (…/soi/),
--   * whether RealComply made it or it was uploaded,
--   * for one RealComply made, what went into it,
--   * the ESP revision it was made for, when it was,
--   * the date it was prepared, and who prepared it (stamped by the
--     database).
-- The office reads them; whoever works on the listing adds them; nobody
-- changes or deletes one. A signed-off, withdrawn or ended listing can't take
-- a new one.
--
-- And a second new table, statement_of_information_links: one link per
-- listing for its online ads. The agent switches it on, and off. The link is
-- 64 random characters the database makes; nobody chooses it. Opened by
-- anyone, it shows the listing's current statement only, nothing else, and
-- only while the link is on, the listing hasn't reached Settled or been
-- signed off, isn't withdrawn from sale, and the office's subscription
-- hasn't ended. That check is one function, statement_of_information_public,
-- the only thing a signed-out visitor can call. Who switched it on or off,
-- and when, is stamped.
--
-- THE SWITCH (Master, 10 Nov 2026): all of it stays off until midnight
-- Sydney on 8 February 2027, then only for a listing whose agency agreement
-- was signed on or after that day (or isn't signed yet). A listing signed
-- before never gets it. One function says so, soi_applies; until then nothing
-- can be added, no link switched on, and the link shows nothing.
--
-- Grants are given here, with each table. Safe to run twice.

begin;

-- ── 0. The switch ────────────────────────────────────────────────────────
-- When it starts: midnight at the start of 8 February 2027, Sydney (daylight
-- time, +11:00). Its own function so a test can switch it on inside a
-- transaction it rolls back.
create or replace function public.soi_starts_at()
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
begin
  return timestamptz '2027-02-08 00:00:00+11';
end
$$;
revoke execute on function public.soi_starts_at() from public, anon, authenticated;

-- Whether it's on for the listing: never before it starts; from then, for an
-- agreement signed on or after 8 February 2027 (the agreement card's date),
-- or none signed yet (Act Sch 1, transitional cl 3).
create or replace function public.soi_applies(p_property uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_signed date;
begin
  if now() < public.soi_starts_at() then
    return false;
  end if;
  select i.event_date into v_signed
    from public.property_items i
   where i.property_id = p_property and i.item_key = 'a3';
  return coalesce(v_signed, (now() at time zone 'Australia/Sydney')::date) >= date '2027-02-08';
end
$$;
revoke execute on function public.soi_applies(uuid) from public, anon;
grant execute on function public.soi_applies(uuid) to authenticated, service_role;

-- ── 1. The table ─────────────────────────────────────────────────────────
create table if not exists public.statements_of_information (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  version_no integer not null,
  source text not null,
  pdf_path text not null,
  file_name text,
  content jsonb,
  esp_revision_no integer,
  prepared_on date not null default ((now() at time zone 'Australia/Sydney')::date),
  prepared_by uuid references public.profiles(id) on delete set null,
  prepared_by_name text,
  created_at timestamptz not null default now(),
  constraint statements_of_information_version unique (property_id, version_no),
  constraint statements_of_information_source check (source in ('realcomply', 'uploaded')),
  constraint statements_of_information_in_folder
    check (starts_with(pdf_path, agency_id::text || '/' || property_id::text || '/soi/')),
  constraint statements_of_information_content
    check (content is null or jsonb_typeof(content) = 'object'),
  constraint statements_of_information_made_has_content
    check (source <> 'realcomply' or content is not null)
);
create index if not exists statements_of_information_property on public.statements_of_information (property_id, version_no);

comment on table public.statements_of_information is
  'Each version of a listing''s statement of information (s72C; Reg s12H, s12I; 0121). Kept, never changed: s72C(6) keeps every version 3 years.';
comment on column public.statements_of_information.source is
  'realcomply: made by RealComply from the listing''s records; uploaded: made elsewhere and uploaded.';
comment on column public.statements_of_information.content is
  'For one RealComply made: what went into it (the property, the comparable sales, the reports known, who prepared it).';

-- ── 2. Number, date and who, stamped by the database ─────────────────────
create or replace function public.stamp_statement_of_information()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('statement_of_information:' || new.property_id::text, 0));
  if current_user in ('authenticated', 'anon') then
    new.prepared_by := auth.uid();
    select coalesce(nullif(btrim(full_name), ''), email) into new.prepared_by_name
      from public.profiles where id = auth.uid();
    new.created_at := now();
    new.version_no := null;
    if new.prepared_on > (now() at time zone 'Australia/Sydney')::date then
      raise exception 'The date it was prepared can''t be in the future.';
    end if;
    if not public.soi_applies(new.property_id) then
      raise exception 'The Statement of Information starts on 8 February 2027, for agency agreements signed from that day.';
    end if;
  end if;
  if new.version_no is null then
    select coalesce(max(s.version_no), 0) + 1 into new.version_no
      from public.statements_of_information s where s.property_id = new.property_id;
  end if;
  return new;
end
$$;
revoke execute on function public.stamp_statement_of_information() from public, anon, authenticated;

drop trigger if exists statements_of_information_stamp on public.statements_of_information;
create trigger statements_of_information_stamp
  before insert on public.statements_of_information
  for each row execute function public.stamp_statement_of_information();

-- The same guards as the listing's cards: not once the office's subscription
-- has ended, not on a signed-off file, not while withdrawn from sale.
drop trigger if exists statements_of_information_not_ended_guard on public.statements_of_information;
create trigger statements_of_information_not_ended_guard
  before insert or update or delete on public.statements_of_information
  for each row execute function public.guard_agency_not_ended();
drop trigger if exists statements_of_information_signed_off_lock on public.statements_of_information;
create trigger statements_of_information_signed_off_lock
  before insert or update or delete on public.statements_of_information
  for each row execute function public.guard_signed_off_listing();
drop trigger if exists statements_of_information_withdrawn_guard on public.statements_of_information;
create trigger statements_of_information_withdrawn_guard
  before insert or update or delete on public.statements_of_information
  for each row execute function public.guard_withdrawn_listing_items();

-- ── 3. Who sees and adds them ────────────────────────────────────────────
alter table public.statements_of_information enable row level security;

drop policy if exists "statements_of_information: whoever sees the listing can view" on public.statements_of_information;
create policy "statements_of_information: whoever sees the listing can view"
  on public.statements_of_information for select
  using (agency_id = public.current_agency_id() and public.can_read_property(property_id));

drop policy if exists "statements_of_information: whoever works on the listing can add" on public.statements_of_information;
create policy "statements_of_information: whoever works on the listing can add"
  on public.statements_of_information for insert
  with check (agency_id = public.current_agency_id() and public.can_see_property(property_id));

-- Data API grants (Adam's rule: every new table carries its grants). The
-- office reads and adds; nobody changes or deletes.
revoke all on table public.statements_of_information from public, anon, authenticated;
grant select, insert on public.statements_of_information to authenticated;
grant select, insert, update, delete on public.statements_of_information to service_role;

-- ── 4. The link for online ads ───────────────────────────────────────────
create table if not exists public.statement_of_information_links (
  property_id uuid primary key references public.properties(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  token text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  enabled boolean not null default true,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles(id) on delete set null,
  changed_by_name text,
  created_at timestamptz not null default now(),
  constraint statement_of_information_links_token unique (token),
  constraint statement_of_information_links_token_shape check (token ~ '^[0-9a-f]{64}$')
);

comment on table public.statement_of_information_links is
  'Each listing''s link to its current statement of information, for online ads (s72C(4); 0121). Switched on and off by the agent.';

-- The link is the database's own: made on the way in, never changed. Who
-- switched it and when, stamped. Switched on only with a statement on the
-- listing, and not once it has reached Settled, been signed off or been
-- withdrawn from sale. Switching off is always allowed.
create or replace function public.stamp_statement_of_information_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    new.created_at := now();
  else
    new.token := old.token;
    new.property_id := old.property_id;
    new.agency_id := old.agency_id;
    new.created_at := old.created_at;
  end if;
  -- Security definer, so the caller is read from the request, not current_user.
  if auth.uid() is not null then
    new.changed_by := auth.uid();
    select coalesce(nullif(btrim(full_name), ''), email) into new.changed_by_name
      from public.profiles where id = auth.uid();
  end if;
  new.changed_at := now();

  if new.enabled and (tg_op = 'INSERT' or not old.enabled) then
    if not public.soi_applies(new.property_id) then
      raise exception 'The Statement of Information starts on 8 February 2027, for agency agreements signed from that day.';
    end if;
    if not exists (select 1 from public.statements_of_information s where s.property_id = new.property_id) then
      raise exception 'Make or upload the statement of information first, then switch the link on.';
    end if;
    if public.listing_is_withdrawn(new.property_id) then
      raise exception 'This listing is withdrawn from sale. Put it back on the market to switch the link on.';
    end if;
    if public.listing_signed_off(new.property_id)
       or exists (select 1 from public.properties p where p.id = new.property_id and p.stage >= 5) then
      raise exception 'This listing has reached Settled, so its link can''t be switched on.';
    end if;
  end if;
  return new;
end
$$;
revoke execute on function public.stamp_statement_of_information_link() from public, anon, authenticated;

drop trigger if exists statement_of_information_links_stamp on public.statement_of_information_links;
create trigger statement_of_information_links_stamp
  before insert or update on public.statement_of_information_links
  for each row execute function public.stamp_statement_of_information_link();
drop trigger if exists statement_of_information_links_not_ended_guard on public.statement_of_information_links;
create trigger statement_of_information_links_not_ended_guard
  before insert or update or delete on public.statement_of_information_links
  for each row execute function public.guard_agency_not_ended();

alter table public.statement_of_information_links enable row level security;

drop policy if exists "soi links: whoever sees the listing can view" on public.statement_of_information_links;
create policy "soi links: whoever sees the listing can view"
  on public.statement_of_information_links for select
  using (agency_id = public.current_agency_id() and public.can_read_property(property_id));

drop policy if exists "soi links: whoever works on the listing can add" on public.statement_of_information_links;
create policy "soi links: whoever works on the listing can add"
  on public.statement_of_information_links for insert
  with check (agency_id = public.current_agency_id() and public.can_see_property(property_id));

drop policy if exists "soi links: whoever works on the listing can switch" on public.statement_of_information_links;
create policy "soi links: whoever works on the listing can switch"
  on public.statement_of_information_links for update
  using (agency_id = public.current_agency_id() and public.can_see_property(property_id))
  with check (agency_id = public.current_agency_id() and public.can_see_property(property_id));

-- Data API grants. The office reads the link, adds it, and switches it on or
-- off (that column only); nobody deletes one.
revoke all on table public.statement_of_information_links from public, anon, authenticated;
grant select, insert on public.statement_of_information_links to authenticated;
grant update (enabled) on public.statement_of_information_links to authenticated;
grant select, insert, update, delete on public.statement_of_information_links to service_role;

-- ── 5. What the link shows ────────────────────────────────────────────────
-- The current statement's file, for a link that's on, on a listing that's
-- still for sale, of an office still subscribed. Nothing else about the
-- listing or the office. The file itself is read by the server.
create or replace function public.statement_of_information_public(p_token text)
returns table (pdf_path text)
language sql
stable
security definer
set search_path = public
as $$
  select v.pdf_path
    from public.statement_of_information_links l
    join public.properties p on p.id = l.property_id
    join lateral (
      select s.pdf_path from public.statements_of_information s
       where s.property_id = l.property_id
       order by s.version_no desc
       limit 1
    ) v on true
   where p_token ~ '^[0-9a-f]{64}$'
     and l.token = p_token
     and l.enabled
     and public.soi_applies(l.property_id)
     and p.stage < 5
     and not public.listing_signed_off(l.property_id)
     and not public.listing_is_withdrawn(l.property_id)
     and not public.agency_has_ended(l.agency_id);
$$;
revoke execute on function public.statement_of_information_public(text) from public;
grant execute on function public.statement_of_information_public(text) to anon, authenticated, service_role;

commit;

-- ── Check ──────────────────────────────────────────────────────────────
-- One row, every value true.
select
  to_regclass('public.statements_of_information') is not null as table_added,
  (select relrowsecurity from pg_class where oid = 'public.statements_of_information'::regclass) as rls_on,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'statements_of_information') = 2 as two_policies,
  (select count(*) from pg_trigger where tgrelid = 'public.statements_of_information'::regclass and not tgisinternal
     and tgname in ('statements_of_information_stamp', 'statements_of_information_not_ended_guard',
                    'statements_of_information_signed_off_lock', 'statements_of_information_withdrawn_guard')) = 4
    as four_triggers,
  has_table_privilege('authenticated', 'public.statements_of_information', 'select')
    and has_table_privilege('authenticated', 'public.statements_of_information', 'insert')
    and not has_table_privilege('authenticated', 'public.statements_of_information', 'update')
    and not has_table_privilege('authenticated', 'public.statements_of_information', 'delete')
    and not has_table_privilege('anon', 'public.statements_of_information', 'select')
    as grants_right,
  not has_function_privilege('anon', 'public.stamp_statement_of_information()', 'execute') as stamp_not_callable,
  to_regclass('public.statement_of_information_links') is not null
    and (select relrowsecurity from pg_class where oid = 'public.statement_of_information_links'::regclass)
    and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'statement_of_information_links') = 3
    as link_table_added,
  has_column_privilege('authenticated', 'public.statement_of_information_links', 'enabled', 'update')
    and not has_column_privilege('authenticated', 'public.statement_of_information_links', 'token', 'update')
    and not has_table_privilege('authenticated', 'public.statement_of_information_links', 'delete')
    and not has_table_privilege('anon', 'public.statement_of_information_links', 'select')
    as link_grants_right,
  has_function_privilege('anon', 'public.statement_of_information_public(text)', 'execute') as link_lookup_open,
  public.soi_starts_at() = timestamptz '2027-02-08 00:00:00+11'
    and not has_function_privilege('anon', 'public.soi_applies(uuid)', 'execute')
    as switched_on_8_feb_2027;
