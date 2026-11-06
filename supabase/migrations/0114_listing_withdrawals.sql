-- ===== 0114: Withdrawn from sale =====
--
-- Job B, the listing tabs (mockup v6, Adam's OK; Master's brief, 5 Nov 2026).
-- "Withdraw from market" on a listing that hasn't exchanged: the date it came
-- off the market, the reason (Seller changed their mind, Listed with another
-- agency, Agency agreement ended, or Other with a reason), and optional
-- evidence. Who and when are stamped here, not sent by the app. The listing
-- moves to the Withdrawn from sale tab and opens read only: its cards and
-- details can't change until it is put back. "Put back on the market" returns
-- it, every card as it was, and is recorded with who and when too.
--
-- Nothing is deleted. Every withdrawal and every put-back stays, so the file
-- shows its whole history. Plan counts don't change: they count listings
-- created in the last 365 days (agency_listing_count, 0036), whatever their
-- stage or tab.
--
-- Who: the listing's own agent, or whoever acts as the licensee (the licensee
-- in charge, or the agent on an agent plan). Not an assistant. Only before
-- exchange (stages Listing set-up to Campaign).
--
-- One new table, with its grants. Safe to run twice.

begin;

-- Order check.
do $$
begin
  if to_regprocedure('public.can_see_property(uuid)') is null
     or to_regprocedure('public.acts_as_licensee()') is null
     or to_regprocedure('public.current_agency_id()') is null then
    raise exception 'Run 0058 and 0093 before this one. Nothing was changed.';
  end if;
end $$;

-- ── 1. Withdrawals ───────────────────────────────────────────────────────
create table if not exists public.listing_withdrawals (
  id                 uuid primary key default gen_random_uuid(),
  agency_id          uuid not null references public.agencies (id) on delete cascade,
  property_id        uuid not null references public.properties (id) on delete cascade,
  -- The day it came off the market, as the agent gives it.
  withdrawn_on       date not null,
  reason             text not null check (reason in (
                       'seller_changed_mind', 'listed_with_another_agency', 'agreement_ended', 'other')),
  reason_other       text check (reason_other is null or char_length(reason_other) <= 500),
  -- Optional evidence: a file in this listing's own withdrawal folder.
  evidence_path      text check (evidence_path is null or char_length(evidence_path) <= 600),
  evidence_file_name text check (evidence_file_name is null or char_length(evidence_file_name) <= 255),
  withdrawn_by       uuid references public.profiles (id) on delete set null,
  withdrawn_at       timestamptz not null default now(),
  put_back_by        uuid references public.profiles (id) on delete set null,
  put_back_at        timestamptz,
  constraint listing_withdrawals_other_says_why
    check (reason <> 'other' or nullif(btrim(coalesce(reason_other, '')), '') is not null)
);
comment on table public.listing_withdrawals is
  'Listings withdrawn from sale, and put back on the market (0114, Job B, 6 Nov 2026). A row with no put_back_at is a listing withdrawn now. Rows are never deleted while the listing exists.';
-- One open withdrawal per listing.
create unique index if not exists listing_withdrawals_one_open
  on public.listing_withdrawals (property_id) where put_back_at is null;
create index if not exists listing_withdrawals_agency_open_idx
  on public.listing_withdrawals (agency_id) where put_back_at is null;
create index if not exists listing_withdrawals_property_idx
  on public.listing_withdrawals (property_id, withdrawn_at);

alter table public.listing_withdrawals enable row level security;
drop policy if exists "listing_withdrawals: whoever can see the listing" on public.listing_withdrawals;
create policy "listing_withdrawals: whoever can see the listing" on public.listing_withdrawals
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.can_see_property(property_id));

-- Read through the policy above; written only through the two functions below.
revoke all on table public.listing_withdrawals from public, anon, authenticated;
grant select on public.listing_withdrawals to authenticated;
grant select, insert, update, delete on public.listing_withdrawals to service_role;

-- ── 2. Withdraw, and put back ────────────────────────────────────────────
-- The plain refusals, in the app's words. Each returns the new or updated row.

-- Who may withdraw or put back this listing, or why not (null when allowed).
create or replace function public.listing_withdrawal_refusal(p_property uuid)
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_me public.profiles%rowtype;
  v_property public.properties%rowtype;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if not found or v_me.archived_at is not null then
    return 'Sign in again to do this.';
  end if;
  select * into v_property from public.properties
   where id = p_property and agency_id = v_me.agency_id;
  if not found or not public.can_see_property(p_property) then
    return 'Couldn''t find that listing.';
  end if;
  if v_me.is_assistant then
    return 'Only the listing''s agent or the licensee in charge can do this.';
  end if;
  if v_property.created_by is distinct from v_me.id and not public.acts_as_licensee() then
    return 'Only the listing''s agent or the licensee in charge can do this.';
  end if;
  return null;
end;
$$;

create or replace function public.withdraw_listing(
  p_property uuid,
  p_withdrawn_on date,
  p_reason text,
  p_reason_other text default null,
  p_evidence_path text default null,
  p_evidence_file_name text default null
)
returns public.listing_withdrawals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refusal text;
  v_property public.properties%rowtype;
  v_today date := (now() at time zone 'Australia/Sydney')::date;
  v_other text := nullif(btrim(coalesce(p_reason_other, '')), '');
  v_path text := nullif(btrim(coalesce(p_evidence_path, '')), '');
  v_row public.listing_withdrawals%rowtype;
begin
  v_refusal := public.listing_withdrawal_refusal(p_property);
  if v_refusal is not null then
    raise exception '%', v_refusal;
  end if;
  select * into v_property from public.properties where id = p_property;
  if v_property.stage >= 4 then
    raise exception 'Only a listing that hasn''t exchanged can be withdrawn from sale.';
  end if;
  if exists (select 1 from public.listing_withdrawals where property_id = p_property and put_back_at is null) then
    raise exception 'This listing is already withdrawn from sale.';
  end if;
  if p_withdrawn_on is null then
    raise exception 'Enter the date it was withdrawn.';
  end if;
  if p_withdrawn_on > v_today then
    raise exception 'The date withdrawn can''t be in the future.';
  end if;
  if p_reason is null or p_reason not in ('seller_changed_mind', 'listed_with_another_agency', 'agreement_ended', 'other') then
    raise exception 'Choose a reason.';
  end if;
  if p_reason = 'other' and v_other is null then
    raise exception 'Say why it was withdrawn.';
  end if;
  -- Evidence only from this listing's own withdrawal folder.
  if v_path is not null
     and v_path not like (v_property.agency_id::text || '/' || v_property.id::text || '/withdrawal/%') then
    raise exception 'That upload isn''t in this listing''s folder. Try again.';
  end if;

  insert into public.listing_withdrawals (
    agency_id, property_id, withdrawn_on, reason, reason_other, evidence_path, evidence_file_name, withdrawn_by
  ) values (
    v_property.agency_id, p_property, p_withdrawn_on, p_reason,
    case when p_reason = 'other' then v_other else null end,
    v_path,
    case when v_path is null then null else nullif(btrim(coalesce(p_evidence_file_name, '')), '') end,
    auth.uid()
  )
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.put_listing_back_on_market(p_property uuid)
returns public.listing_withdrawals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refusal text;
  v_row public.listing_withdrawals%rowtype;
begin
  v_refusal := public.listing_withdrawal_refusal(p_property);
  if v_refusal is not null then
    raise exception '%', v_refusal;
  end if;
  update public.listing_withdrawals
     set put_back_at = now(), put_back_by = auth.uid()
   where property_id = p_property and put_back_at is null
  returning * into v_row;
  if not found then
    raise exception 'This listing isn''t withdrawn from sale.';
  end if;
  return v_row;
end;
$$;

revoke execute on function public.listing_withdrawal_refusal(uuid) from public, anon;
revoke execute on function public.withdraw_listing(uuid, date, text, text, text, text) from public, anon;
revoke execute on function public.put_listing_back_on_market(uuid) from public, anon;
grant execute on function public.listing_withdrawal_refusal(uuid) to authenticated, service_role;
grant execute on function public.withdraw_listing(uuid, date, text, text, text, text) to authenticated;
grant execute on function public.put_listing_back_on_market(uuid) to authenticated;

-- ── 3. Read only while withdrawn ─────────────────────────────────────────
-- A withdrawn listing's cards and details don't change until it is put back.
-- Deleting the listing is still the licensee's, as before.
create or replace function public.listing_is_withdrawn(p_property uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.listing_withdrawals where property_id = p_property and put_back_at is null);
$$;
revoke execute on function public.listing_is_withdrawn(uuid) from public, anon;
grant execute on function public.listing_is_withdrawn(uuid) to authenticated, service_role;

create or replace function public.guard_withdrawn_listing_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid := case when tg_op = 'DELETE' then old.property_id else new.property_id end;
begin
  -- The listing itself being deleted takes its cards with it: allowed.
  if tg_op = 'DELETE' and not exists (select 1 from public.properties where id = v_property) then
    return old;
  end if;
  if public.listing_is_withdrawn(v_property) then
    raise exception 'This listing is withdrawn from sale. Put it back on the market to change it.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke execute on function public.guard_withdrawn_listing_items() from public, anon, authenticated;

drop trigger if exists property_items_withdrawn_guard on public.property_items;
create trigger property_items_withdrawn_guard
  before insert or update or delete on public.property_items
  for each row execute function public.guard_withdrawn_listing_items();

create or replace function public.guard_withdrawn_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.listing_is_withdrawn(old.id) then
    raise exception 'This listing is withdrawn from sale. Put it back on the market to change it.';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_withdrawn_listing() from public, anon, authenticated;

drop trigger if exists properties_withdrawn_guard on public.properties;
create trigger properties_withdrawn_guard
  before update on public.properties
  for each row execute function public.guard_withdrawn_listing();

commit;
