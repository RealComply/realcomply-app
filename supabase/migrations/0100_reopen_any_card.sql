-- ===== 0100: Every card on a sales listing can be reopened (Adam, 28 Oct 2026) =====
--
-- WAS: some cards could not be reopened at all (the price statement approval,
-- the signatures, the price guide, the final sale price and others), and a
-- file the licensee had signed off stayed signed whatever happened to its
-- cards afterwards. The covering letter rule of 20 Oct 2026 is an example: it
-- kept the received date "as signed" on a signed-off file, while every other
-- card on that file could still be changed underneath the signature.
--
-- NOW:
--   1. Any card can be reopened by anyone who can work the listing. Who
--      reopened it, and when, goes on the card ('reopenedBy', 'reopenedAt').
--      Everything already on it stays.
--   2. The price statement approval (b4) is cancelled when the ESP it was
--      given against changes: the ESP card (a4) or the ESP reasoning card
--      (a4c) is reopened, the ESP revision card (d3) is reopened while it
--      holds the revised ESP, or the ESP on the file changes. The approval is
--      kept, marked cancelled, with who reopened what and when. b4 goes back
--      to open. Every approval link for it stops working, so the licensee
--      approves again the usual way.
--   3. Only the licensee in charge reopens the licensee's own sign-off cards:
--      the price statement approval and the licensee's signature.
--   4. Once the licensee has signed the file off, nothing on it can be
--      changed except by the licensee in charge, who reopens a card and so
--      cancels the file sign-off (kept, marked cancelled, with who and when).
--      Both signatures are then needed again. Anyone else can ask the
--      licensee to reopen it, with a reason.
--   5. All of it enforced here, in the database, not only on screen.
--
-- Two new tables, each with its grants in this file. Safe to run twice.

-- ── 1. Cancelled approvals and sign-offs ─────────────────────────────────
-- Never deleted while the listing exists. 'card' is the card exactly as it
-- stood when it was cancelled: who gave it, the words approved, when.
create table if not exists public.listing_signoff_cancellations (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null references public.agencies (id) on delete cascade,
  property_id      uuid not null references public.properties (id) on delete cascade,
  item_key         text not null check (item_key in ('b4', 'sign_agent', 'sign_licensee')),
  card             jsonb not null,
  cancelled_at     timestamptz not null default now(),
  cancelled_by     uuid references public.profiles (id) on delete set null,
  -- The card whose reopening cancelled it, and why: 'reopened' (that card
  -- was reopened), 'esp_changed' (the ESP on the file changed), 'withdrawn'
  -- (the card itself was reopened) or 'file_reopened' (the licensee reopened
  -- a card on the signed-off file).
  because_item_key text,
  because          text not null check (because in ('reopened', 'esp_changed', 'withdrawn', 'file_reopened'))
);
create index if not exists listing_signoff_cancellations_property_idx
  on public.listing_signoff_cancellations (property_id);
create index if not exists listing_signoff_cancellations_agency_idx
  on public.listing_signoff_cancellations (agency_id);
comment on table public.listing_signoff_cancellations is
  'A price statement approval or file sign-off cancelled because a card was reopened (0100, Adam 28 Oct 2026). The card as it stood, who cancelled it, when and why. Written only by this migration''s functions.';

alter table public.listing_signoff_cancellations enable row level security;
drop policy if exists "listing_signoff_cancellations: whoever sees the listing can view" on public.listing_signoff_cancellations;
create policy "listing_signoff_cancellations: whoever sees the listing can view" on public.listing_signoff_cancellations
  for select using (agency_id = public.current_agency_id() and public.can_see_property(property_id));

revoke all on table public.listing_signoff_cancellations from public, anon, authenticated;
grant select on public.listing_signoff_cancellations to authenticated;
grant select, insert, update, delete on public.listing_signoff_cancellations to service_role;

drop trigger if exists listing_signoff_cancellations_not_ended_guard on public.listing_signoff_cancellations;
create trigger listing_signoff_cancellations_not_ended_guard
  before insert or update or delete on public.listing_signoff_cancellations
  for each row execute function public.guard_agency_not_ended();

-- ── 2. Requests to reopen a signed-off file ──────────────────────────────
create table if not exists public.listing_reopen_requests (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references public.agencies (id) on delete cascade,
  property_id  uuid not null references public.properties (id) on delete cascade,
  item_key     text not null check (item_key ~ '^[a-z0-9_]{1,40}$'),
  reason       text not null check (char_length(btrim(reason)) between 1 and 500),
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  status       text not null default 'waiting' check (status in ('waiting', 'reopened', 'declined')),
  answered_by  uuid references public.profiles (id) on delete set null,
  answered_at  timestamptz
);
-- One waiting request per card.
create unique index if not exists listing_reopen_requests_one_waiting
  on public.listing_reopen_requests (property_id, item_key) where status = 'waiting';
create index if not exists listing_reopen_requests_agency_idx
  on public.listing_reopen_requests (agency_id);
comment on table public.listing_reopen_requests is
  'Someone asking the licensee in charge to reopen a card on a signed-off file, with their reason, and the licensee''s answer (0100, Adam 28 Oct 2026). Written only by this migration''s functions.';

alter table public.listing_reopen_requests enable row level security;
drop policy if exists "listing_reopen_requests: whoever sees the listing can view" on public.listing_reopen_requests;
create policy "listing_reopen_requests: whoever sees the listing can view" on public.listing_reopen_requests
  for select using (agency_id = public.current_agency_id() and public.can_see_property(property_id));

revoke all on table public.listing_reopen_requests from public, anon, authenticated;
grant select on public.listing_reopen_requests to authenticated;
grant select, insert, update, delete on public.listing_reopen_requests to service_role;

drop trigger if exists listing_reopen_requests_not_ended_guard on public.listing_reopen_requests;
create trigger listing_reopen_requests_not_ended_guard
  before insert or update or delete on public.listing_reopen_requests
  for each row execute function public.guard_agency_not_ended();

-- ── 3. Is the file signed off? ────────────────────────────────────────────
-- Signed off means the licensee's signature card is done, whether they
-- signed in the app or by the emailed link.
create or replace function public.listing_signed_off(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.property_items i
                  where i.property_id = p_property_id and i.item_key = 'sign_licensee' and i.status = 'done');
$$;
revoke execute on function public.listing_signed_off(uuid) from public, anon;
grant execute on function public.listing_signed_off(uuid) to authenticated, service_role;

-- ── 4. A signed-off file can't be changed ─────────────────────────────────
-- By anyone signed in or using a link, on any card, comparable sale or
-- on-market listing. The licensee reopens a card through
-- reopen_listing_card() below, which cancels the sign-off first. The
-- finalised file (f2) is still generated after sign-off. A listing being
-- deleted takes its cards with it.
create or replace function public.guard_signed_off_listing()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := coalesce(new.property_id, old.property_id);
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'property_items' and to_jsonb(coalesce(new, old)) ->> 'item_key' = 'f2' then
    return coalesce(new, old);
  end if;
  if not exists (select 1 from public.properties p where p.id = v_property) then
    return coalesce(new, old);
  end if;
  if public.listing_signed_off(v_property) then
    raise exception 'Only the licensee can reopen a signed-off file.';
  end if;
  return coalesce(new, old);
end
$$;
revoke execute on function public.guard_signed_off_listing() from public, anon, authenticated;

drop trigger if exists property_items_signed_off_lock on public.property_items;
create trigger property_items_signed_off_lock
  before insert or update or delete on public.property_items
  for each row execute function public.guard_signed_off_listing();
drop trigger if exists property_comparables_signed_off_lock on public.property_comparables;
create trigger property_comparables_signed_off_lock
  before insert or update or delete on public.property_comparables
  for each row execute function public.guard_signed_off_listing();
drop trigger if exists property_market_listings_signed_off_lock on public.property_market_listings;
create trigger property_market_listings_signed_off_lock
  before insert or update or delete on public.property_market_listings
  for each row execute function public.guard_signed_off_listing();

-- ── 5. Who reopened a card, and when ──────────────────────────────────────
-- Whenever a done or flagged card goes back to open and a person did it.
-- Replaced on the next reopen. Not the two signature cards: a signature
-- that is cancelled is kept whole in listing_signoff_cancellations (or, on a
-- send-back, superseded_agent_signatures) and the card starts empty.
create or replace function public.stamp_card_reopen()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.status in ('done', 'flagged') and new.status = 'open' and auth.uid() is not null
     and new.item_key not in ('sign_agent', 'sign_licensee') then
    new.data := coalesce(new.data, '{}'::jsonb)
                || jsonb_build_object('reopenedBy', auth.uid(), 'reopenedAt', now());
  end if;
  return new;
end
$$;
revoke execute on function public.stamp_card_reopen() from public, anon, authenticated;

drop trigger if exists property_items_reopen_stamp on public.property_items;
create trigger property_items_reopen_stamp
  before update on public.property_items
  for each row execute function public.stamp_card_reopen();

-- ── 6. Cancelling the price statement approval ────────────────────────────
-- Keeps the approval in listing_signoff_cancellations, puts b4 back to open
-- with who, when and which card, and stops every approval link for it: an
-- unsigned one asks about the old figures, a signed one is the approval just
-- cancelled. When b4 is not done yet only the links stop.
create or replace function public.cancel_price_statement_approval(
  p_property_id uuid, p_because_item_key text, p_because text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b4 public.property_items;
begin
  select * into v_b4 from public.property_items
   where property_id = p_property_id and item_key = 'b4' for update;

  if found and v_b4.status = 'done' then
    insert into public.listing_signoff_cancellations
      (agency_id, property_id, item_key, card, cancelled_by, because_item_key, because)
    values (v_b4.agency_id, p_property_id, 'b4', to_jsonb(v_b4), auth.uid(), p_because_item_key, p_because);

    update public.property_items
       set status = 'open',
           completed_by = null,
           event_date = null,
           data = (coalesce(data, '{}'::jsonb)
                    - array['signedVia', 'signedName', 'signoffRequestId', 'sentTo', 'typedName', 'signedAt', 'signedBy'])
                  || jsonb_build_object('reopenedBy', auth.uid(), 'reopenedAt', now(),
                                        'reopenedBecause', p_because_item_key, 'reopenedWhy', p_because)
     where id = v_b4.id;
  end if;

  update public.property_signoff_requests
     set revoked_at = now()
   where property_id = p_property_id and item_key = 'b4' and revoked_at is null;
end
$$;
revoke execute on function public.cancel_price_statement_approval(uuid, text, text) from public, anon, authenticated;

-- Watches the three cards the approval rests on (a4, a4c, d3).
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

drop trigger if exists property_items_price_statement_watch on public.property_items;
create trigger property_items_price_statement_watch
  after insert or update on public.property_items
  for each row execute function public.watch_price_statement_inputs();

-- ── 7. Cancelling the file sign-off ───────────────────────────────────────
-- Both signatures go into the history and back to open, the file goes back
-- to not sent and not generated, every sign-off link stops counting (a
-- signed one is the signature just cancelled), and waiting requests to
-- reopen are answered.
create or replace function public.cancel_file_signoff(p_property_id uuid, p_because_item_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.property_items;
begin
  for v_row in
    select * from public.property_items
     where property_id = p_property_id and item_key in ('sign_licensee', 'sign_agent') and status = 'done'
     for update
  loop
    insert into public.listing_signoff_cancellations
      (agency_id, property_id, item_key, card, cancelled_by, because_item_key, because)
    values (v_row.agency_id, p_property_id, v_row.item_key, to_jsonb(v_row), auth.uid(),
            p_because_item_key, case when p_because_item_key = v_row.item_key then 'withdrawn' else 'file_reopened' end);

    update public.property_items
       set status = 'open', completed_by = null, event_date = null,
           data = jsonb_build_object('reopenedBy', auth.uid(), 'reopenedAt', now(),
                                     'reopenedBecause', p_because_item_key, 'reopenedWhy', 'file_reopened')
     where id = v_row.id;
  end loop;

  update public.property_items
     set status = 'open', completed_by = null,
         data = coalesce(data, '{}'::jsonb)
                || jsonb_build_object('reopenedBy', auth.uid(), 'reopenedAt', now(),
                                      'reopenedBecause', p_because_item_key, 'reopenedWhy', 'file_reopened')
   where property_id = p_property_id and item_key in ('send_licensee', 'f2') and status <> 'open';

  update public.property_signoff_requests
     set revoked_at = now()
   where property_id = p_property_id and item_key = 'sign_licensee' and revoked_at is null;

  update public.listing_reopen_requests
     set status = 'reopened', answered_by = auth.uid(), answered_at = now()
   where property_id = p_property_id and status = 'waiting';
end
$$;
revoke execute on function public.cancel_file_signoff(uuid, text) from public, anon, authenticated;

-- ── 8. Reopening a card ───────────────────────────────────────────────────
-- What the app calls. The ordinary Reopen button on a checklist card still
-- saves through the app as before; the triggers above apply to it as well.
--   p_cancel_signoff: the licensee has confirmed "Reopening this card cancels
--   the file sign-off. The file will need signing off again."
create or replace function public.reopen_listing_card(
  p_property_id uuid, p_item_key text, p_cancel_signoff boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me public.profiles;
  v_property public.properties;
  v_row public.property_items;
  v_licensee boolean;
begin
  select * into v_me from public.profiles where id = auth.uid() and archived_at is null;
  if not found then
    raise exception 'Sign in again to reopen this card.';
  end if;
  select * into v_property from public.properties where id = p_property_id;
  if not found or v_property.agency_id is distinct from v_me.agency_id or not public.can_see_property(p_property_id) then
    raise exception 'This listing isn''t one you can work on.';
  end if;
  v_licensee := v_me.is_licensee_in_charge;

  if p_item_key = 'f2' then
    raise exception 'The finalised file goes back to not generated when the file sign-off is cancelled.';
  end if;
  if p_item_key in ('b4', 'sign_licensee') and not v_licensee then
    raise exception 'Only the licensee in charge can reopen a licensee sign-off.';
  end if;
  if v_me.is_assistant and p_item_key in ('b4', 'sign_agent', 'sign_licensee') then
    raise exception 'An assistant can''t reopen a signature or approval.';
  end if;

  if public.listing_signed_off(p_property_id) then
    if not v_licensee then
      raise exception 'Only the licensee can reopen a signed-off file.';
    end if;
    if not p_cancel_signoff then
      raise exception 'Reopening this card cancels the file sign-off. The file will need signing off again.';
    end if;
    perform public.cancel_file_signoff(p_property_id, p_item_key);
    if p_item_key in ('sign_licensee', 'sign_agent', 'send_licensee') then
      return 'reopened';
    end if;
  end if;

  select * into v_row from public.property_items
   where property_id = p_property_id and item_key = p_item_key for update;
  if not found or v_row.status = 'open' then
    return 'already_open';
  end if;

  if p_item_key = 'b4' then
    perform public.cancel_price_statement_approval(p_property_id, 'b4', 'withdrawn');
    return 'reopened';
  end if;

  if p_item_key = 'sign_agent' then
    if v_property.created_by is distinct from v_me.id and not v_licensee then
      raise exception 'Only the listing''s agent or the licensee in charge can reopen the agent''s signature.';
    end if;
    insert into public.listing_signoff_cancellations
      (agency_id, property_id, item_key, card, cancelled_by, because_item_key, because)
    values (v_row.agency_id, p_property_id, 'sign_agent', to_jsonb(v_row), auth.uid(), 'sign_agent', 'withdrawn');
    update public.property_items
       set status = 'open', completed_by = null, event_date = null,
           data = jsonb_build_object('reopenedBy', auth.uid(), 'reopenedAt', now())
     where id = v_row.id;
    -- The file went to the licensee on that signature: it goes again.
    update public.property_signoff_requests
       set revoked_at = now()
     where property_id = p_property_id and item_key = 'sign_licensee' and signed_at is null and revoked_at is null;
    update public.property_items set status = 'open', completed_by = null
     where property_id = p_property_id and item_key = 'send_licensee' and status <> 'open';
    return 'reopened';
  end if;

  if p_item_key = 'send_licensee' then
    update public.property_signoff_requests
       set revoked_at = now()
     where property_id = p_property_id and item_key = 'sign_licensee' and signed_at is null and revoked_at is null;
  end if;

  -- Every other card: back to open, with everything on it kept. A tick the
  -- document read gave it no longer says so.
  update public.property_items
     set status = 'open', completed_by = null, data = coalesce(data, '{}'::jsonb) #- '{aiDraft,autoCompleted}'
   where id = v_row.id;
  return 'reopened';
end
$$;
revoke execute on function public.reopen_listing_card(uuid, text, boolean) from public, anon;
grant execute on function public.reopen_listing_card(uuid, text, boolean) to authenticated;

-- ── 9. Asking the licensee to reopen a signed-off file ────────────────────
create or replace function public.request_listing_reopen(p_property_id uuid, p_item_key text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me public.profiles;
  v_property public.properties;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id uuid;
begin
  select * into v_me from public.profiles where id = auth.uid() and archived_at is null;
  if not found then
    raise exception 'Sign in again to ask.';
  end if;
  select * into v_property from public.properties where id = p_property_id;
  if not found or v_property.agency_id is distinct from v_me.agency_id or not public.can_see_property(p_property_id) then
    raise exception 'This listing isn''t one you can work on.';
  end if;
  if not public.listing_signed_off(p_property_id) then
    raise exception 'This file isn''t signed off. You can reopen the card yourself.';
  end if;
  if v_me.is_licensee_in_charge then
    raise exception 'You can reopen it yourself.';
  end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then
    raise exception 'Say why it needs reopening, in up to 500 characters.';
  end if;
  if not exists (select 1 from public.property_items i
                  where i.property_id = p_property_id and i.item_key = p_item_key) then
    raise exception 'Choose a card on this listing.';
  end if;
  if exists (select 1 from public.listing_reopen_requests r
              where r.property_id = p_property_id and r.item_key = p_item_key and r.status = 'waiting') then
    raise exception 'You''ve already asked the licensee to reopen this card.';
  end if;

  insert into public.listing_reopen_requests (agency_id, property_id, item_key, reason, requested_by)
  values (v_property.agency_id, p_property_id, p_item_key, v_reason, v_me.id)
  returning id into v_id;
  return v_id;
end
$$;
revoke execute on function public.request_listing_reopen(uuid, text, text) from public, anon;
grant execute on function public.request_listing_reopen(uuid, text, text) to authenticated;

create or replace function public.decline_listing_reopen(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.listing_reopen_requests;
begin
  select * into v_request from public.listing_reopen_requests where id = p_request_id for update;
  if not found or v_request.agency_id is distinct from public.current_agency_id() then
    raise exception 'That request isn''t there any more.';
  end if;
  if not exists (select 1 from public.profiles me
                  where me.id = auth.uid() and me.agency_id = v_request.agency_id
                    and me.is_licensee_in_charge and me.archived_at is null) then
    raise exception 'Only the licensee in charge can answer a request to reopen.';
  end if;
  if v_request.status <> 'waiting' then
    return;
  end if;
  update public.listing_reopen_requests
     set status = 'declined', answered_by = auth.uid(), answered_at = now()
   where id = p_request_id;
end
$$;
revoke execute on function public.decline_listing_reopen(uuid) from public, anon;
grant execute on function public.decline_listing_reopen(uuid) to authenticated;

-- ── 10. The 7-year activity record ────────────────────────────────────────
-- build_activity_record is 0071's, word for word, plus (0100) cancelled
-- approvals and sign-offs and requests to reopen. Identifiers and dates
-- only, never the reasons or the words approved.
create or replace function public.build_activity_record(p_agency_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.build_activity_record_0058(p_agency_id) || jsonb_build_object(
    'send_backs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'listing', s.property_id, 'by', s.sent_back_by,
        'via', case when s.sent_back_by is null then 'link' else 'app' end,
        'at', s.sent_back_at,
        'cards', coalesce((select jsonb_agg(jsonb_build_object(
            'card', i.item_key, 'may_be_breach', i.may_be_breach,
            'cleared_by', i.cleared_by, 'cleared_at', i.cleared_at) order by i.item_key)
          from public.listing_send_back_items i where i.send_back_id = s.id), '[]'))
        order by s.sent_back_at)
      from public.listing_send_backs s where s.agency_id = p_agency_id), '[]'),
    'superseded_agent_signatures', coalesce((select jsonb_agg(jsonb_build_object(
        'listing', g.property_id, 'signer', g.signed_by, 'signed_at', g.signed_at,
        'superseded_at', g.superseded_at, 'send_back', g.send_back_id) order by g.superseded_at)
      from public.superseded_agent_signatures g where g.agency_id = p_agency_id), '[]'),
    'licensee_contact_changes', coalesce((select jsonb_agg(jsonb_build_object(
        'by', c.changed_by, 'at', c.changed_at) order by c.changed_at)
      from public.licensee_contact_changes c where c.agency_id = p_agency_id), '[]'),
    'sg_read_confirmations', coalesce((select jsonb_agg(jsonb_build_object(
        'by', r.confirmed_by, 'version', r.annexure_version, 'at', r.confirmed_at) order by r.confirmed_at)
      from public.sg_read_confirmations r where r.agency_id = p_agency_id), '[]'),
    'agency_name_changes', coalesce((select jsonb_agg(jsonb_build_object(
        'name', n.name_kind, 'via', n.via, 'by', n.changed_by, 'at', n.changed_at) order by n.changed_at)
      from public.agency_name_changes n where n.agency_id = p_agency_id), '[]'),
    'agent_acknowledgements', coalesce((select jsonb_agg(jsonb_build_object(
        'by', k.profile_id, 'version', k.wording_version, 'at', k.confirmed_at,
        'document', k.signoff_document_id) order by k.confirmed_at)
      from public.agent_acknowledgements k where k.agency_id = p_agency_id), '[]'),
    'signoff_cancellations', coalesce((select jsonb_agg(jsonb_build_object(
        'listing', x.property_id, 'card', x.item_key,
        'given_by', coalesce(x.card ->> 'completed_by', x.card -> 'data' ->> 'signedBy'),
        'given_at', x.card -> 'data' ->> 'signedAt',
        'via', case when x.card -> 'data' ->> 'signedVia' = 'link' then 'link' else 'app' end,
        'cancelled_by', x.cancelled_by, 'cancelled_at', x.cancelled_at,
        'because_card', x.because_item_key, 'because', x.because) order by x.cancelled_at)
      from public.listing_signoff_cancellations x where x.agency_id = p_agency_id), '[]'),
    'reopen_requests', coalesce((select jsonb_agg(jsonb_build_object(
        'listing', q.property_id, 'card', q.item_key, 'by', q.requested_by, 'at', q.requested_at,
        'status', q.status, 'answered_by', q.answered_by, 'answered_at', q.answered_at) order by q.requested_at)
      from public.listing_reopen_requests q where q.agency_id = p_agency_id), '[]'));
$$;
revoke execute on function public.build_activity_record(uuid) from public, anon, authenticated;
grant execute on function public.build_activity_record(uuid) to service_role;

-- What it shows when it has run: true, true, true, true.
select to_regclass('public.listing_signoff_cancellations') is not null
         and to_regclass('public.listing_reopen_requests') is not null as history_tables_ready,
       has_table_privilege('authenticated', 'public.listing_signoff_cancellations', 'select')
         and not has_table_privilege('authenticated', 'public.listing_signoff_cancellations', 'insert')
         and not has_table_privilege('authenticated', 'public.listing_reopen_requests', 'insert') as read_only_to_the_app,
       has_function_privilege('authenticated', 'public.reopen_listing_card(uuid, text, boolean)', 'execute')
         and not has_function_privilege('anon', 'public.reopen_listing_card(uuid, text, boolean)', 'execute') as only_signed_in,
       exists (select 1 from pg_trigger where tgname = 'property_items_signed_off_lock')
         and exists (select 1 from pg_trigger where tgname = 'property_items_price_statement_watch') as rules_in_place;
