-- ===== 0105: An agent's own listings page for the daily price check (Adam, 2 Nov 2026) =====
--
-- WHY. The 7am price check finds each listing's web page from the office's
-- listings page only (agencies.website_url). It had not found a page for any
-- listing outside Cass Property and Uralla Properties: 36/86 Derrima Road and
-- 6 Markham Close went from On market to Sold with no price check. Many agents
-- have their own page on the office website, often their agent profile, that
-- shows exactly their listings. Approved by Adam on 9 Oct 2026 (code review
-- brief, part D2); built 2 Nov 2026.
--
-- WHAT.
--   * agent_listing_pages: one optional page per person who lists properties
--     ("My listings page"). An agent sets only their own. The licensee in
--     charge (or the agent on their own plan) and an office manager can add or
--     change anyone's in their office. Written only through
--     set_agent_listings_page(); read by the office.
--   * listings_page_checks: what each page showed at this morning's check,
--     the office page and every agent's page, one row each: how many listings
--     the page showed and how many that agent (or office) has in RealComply.
--     Written by the 7am check (service role). "Keep this one" on the
--     group-page warning is recorded here, through keep_listings_page().
--   * The 7am check reads the listing agent's own page first, then the office
--     page (src/lib/actions/website-scan.ts).
--
-- SAFE FETCHING is in the app, the same for both pages: public https:// pages
-- only, no internal addresses, page text treated as untrusted when it goes to
-- the AI (src/lib/net/public-page.ts). This table only refuses anything that
-- isn't an https:// address.
--
-- Two new tables, with their grants in this file. Nothing existing changes.
-- Safe to run twice.

begin;

-- ── 1. Each lister's own page ──────────────────────────────────────────────
create table if not exists public.agent_listing_pages (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  url text not null check (url ~ '^https://[^[:space:]/]+' and length(url) <= 2048),
  set_by uuid references public.profiles(id) on delete set null,
  set_at timestamptz not null default now()
);
create index if not exists agent_listing_pages_agency on public.agent_listing_pages (agency_id);
alter table public.agent_listing_pages enable row level security;

drop policy if exists "agent listing pages: the office reads them" on public.agent_listing_pages;
create policy "agent listing pages: the office reads them" on public.agent_listing_pages
  for select to authenticated
  using (agency_id = public.current_agency_id());

-- ── 2. What each page showed this morning ──────────────────────────────────
-- page_key is 'office:<agency id>' for the office page, 'agent:<profile id>'
-- for an agent's own page. Only the latest check is kept: it is what the
-- field shows ("Checked this morning: ...").
create table if not exists public.listings_page_checks (
  page_key text primary key,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  url text not null,
  checked_at timestamptz not null,
  -- read: the page was read; refused: the website turned the check away or
  -- the address can't be fetched; failed: the reader itself failed.
  outcome text not null check (outcome in ('read', 'refused', 'failed')),
  listings_found integer check (listings_found >= 0),
  in_realcomply integer check (in_realcomply >= 0),
  -- The page's links, hashed, so an unchanged page is not counted again.
  links_hash text,
  -- "Keep this one" on the group-page warning, for this address.
  kept_url text,
  kept_by uuid references public.profiles(id) on delete set null,
  kept_at timestamptz,
  constraint listings_page_checks_key check (
    (profile_id is null and page_key = 'office:' || agency_id::text)
    or (profile_id is not null and page_key = 'agent:' || profile_id::text))
);
create index if not exists listings_page_checks_agency on public.listings_page_checks (agency_id);
alter table public.listings_page_checks enable row level security;

drop policy if exists "listings page checks: the office reads them" on public.listings_page_checks;
create policy "listings page checks: the office reads them" on public.listings_page_checks
  for select to authenticated
  using (agency_id = public.current_agency_id());

-- ── Grants ─────────────────────────────────────────────────────────────────
-- Explicit, as for every new table since Supabase stopped granting new public
-- tables automatically (30 Oct 2026). The office reads both; nobody signed in
-- writes either directly: the two functions below do, and the 7am check.
revoke all on table public.agent_listing_pages from public, anon, authenticated;
revoke all on table public.listings_page_checks from public, anon, authenticated;
grant select on public.agent_listing_pages to authenticated;
grant select on public.listings_page_checks to authenticated;
grant select, insert, update, delete on public.agent_listing_pages to service_role;
grant select, insert, update, delete on public.listings_page_checks to service_role;

-- ── 3. Setting a page ──────────────────────────────────────────────────────
-- Own page, or anyone's in the office for whoever runs the office (the
-- licensee in charge, the agent on their own plan, or an office manager:
-- runs_office(), 0093). Blank removes it, and the listing agent's listings go
-- back to the office page.
create or replace function public.set_agent_listings_page(p_profile_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me public.profiles;
  v_target public.profiles;
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  select * into v_me from public.profiles where id = auth.uid() and archived_at is null;
  if not found then
    raise exception 'Sign in again to change a listings page.';
  end if;
  select * into v_target from public.profiles where id = p_profile_id and archived_at is null;
  if not found or v_target.agency_id is distinct from v_me.agency_id then
    raise exception 'That person isn''t in your office.';
  end if;
  if v_target.id <> v_me.id and not public.runs_office() then
    raise exception 'You can only change your own listings page. The licensee in charge or the office manager can change anyone''s.';
  end if;
  if v_target.is_agent is not true then
    raise exception 'Only someone who lists properties has a listings page.';
  end if;

  if v_url is null then
    delete from public.agent_listing_pages where profile_id = v_target.id;
    delete from public.listings_page_checks where page_key = 'agent:' || v_target.id::text;
    return;
  end if;
  if v_url !~ '^https://[^[:space:]/]+' or length(v_url) > 2048 then
    raise exception 'The listings page needs to be a web address starting https://.';
  end if;

  insert into public.agent_listing_pages (profile_id, agency_id, url, set_by, set_at)
  values (v_target.id, v_target.agency_id, v_url, v_me.id, now())
  on conflict (profile_id) do update
     set url = excluded.url, set_by = excluded.set_by, set_at = excluded.set_at
   where public.agent_listing_pages.url is distinct from excluded.url;
end
$$;
revoke execute on function public.set_agent_listings_page(uuid, text) from public, anon;
grant execute on function public.set_agent_listings_page(uuid, text) to authenticated;

-- ── 4. "Keep this one" on the group-page warning ───────────────────────────
-- The office page: whoever may change it (may_change_agency_details, as
-- set_agency_website). An agent's page: that agent, or whoever runs the
-- office.
create or replace function public.keep_listings_page(p_page_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me public.profiles;
  v_row public.listings_page_checks;
begin
  select * into v_me from public.profiles where id = auth.uid() and archived_at is null;
  if not found then
    raise exception 'Sign in again to keep this page.';
  end if;
  select * into v_row from public.listings_page_checks where page_key = p_page_key for update;
  if not found or v_row.agency_id is distinct from v_me.agency_id then
    raise exception 'There''s no check of that page to keep.';
  end if;
  if v_row.profile_id is null then
    if not public.may_change_agency_details() then
      raise exception 'Only the licensee in charge can keep the office listings page.';
    end if;
  elsif v_row.profile_id <> v_me.id and not public.runs_office() then
    raise exception 'You can only keep your own listings page. The licensee in charge or the office manager can keep anyone''s.';
  end if;
  update public.listings_page_checks
     set kept_url = v_row.url, kept_by = v_me.id, kept_at = now()
   where page_key = p_page_key;
end
$$;
revoke execute on function public.keep_listings_page(text) from public, anon;
grant execute on function public.keep_listings_page(text) to authenticated;

commit;

-- ── Check ──────────────────────────────────────────────────────────────────
-- One row, every value true.
select
  to_regclass('public.agent_listing_pages') is not null
    and to_regclass('public.listings_page_checks') is not null as tables_made,
  has_table_privilege('authenticated', 'public.agent_listing_pages', 'select')
    and not has_table_privilege('authenticated', 'public.agent_listing_pages', 'insert')
    and not has_table_privilege('anon', 'public.agent_listing_pages', 'select')
    and has_table_privilege('service_role', 'public.listings_page_checks', 'insert') as grants_right,
  has_function_privilege('authenticated', 'public.set_agent_listings_page(uuid, text)', 'execute')
    and not has_function_privilege('anon', 'public.set_agent_listings_page(uuid, text)', 'execute') as setting_a_page_works;
