-- ===== RUN THIS ONE. Migration 0063, send back: mark done to clear, 12 October 2026 =====
--
-- MIGRATION 0063 — one button per card
--
-- Adam, 12 Oct 2026, testing 0062 on the preview: a card the licensee sent
-- back had its own "Changes made" button and reply box beside the card's
-- usual Mark done, and both had to be pressed. "It's confusing having two
-- buttons on the same card." Now:
--
--   1. Sending a file back also sets each flagged card back to not done.
--   2. Marking a flagged card done the normal way clears the licensee's flag
--      (a trigger), recording who and when, exactly as "Changes made" did.
--
-- The locks from 0062 are unchanged: nothing is signed or resent while a
-- flagged card is open. clear_send_back_item() stays, unused by the app.
--
-- Run after 0062. Changes no existing row. SAFE TO RUN TWICE. One transaction.

begin;

-- ── 1. Sending back reopens the flagged cards ──────────────────────────

create or replace function public.send_back_listing_core(
  p_agency_id uuid,
  p_property_id uuid,
  p_items jsonb,
  p_by uuid,
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_item jsonb;
  v_count int := 0;
  v_agent public.property_items;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Flag at least one card, with a note saying what needs changing.';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'Too many cards in one send-back.';
  end if;

  if exists (select 1 from public.property_items i
              where i.property_id = p_property_id and i.item_key = 'sign_licensee' and i.status = 'done') then
    raise exception 'This file is already signed off by the licensee.';
  end if;

  insert into public.listing_send_backs (agency_id, property_id, sent_back_by, signoff_request_id)
  values (p_agency_id, p_property_id, p_by, p_request_id)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if coalesce(btrim(v_item->>'item_key'), '') = '' or coalesce(btrim(v_item->>'note'), '') = '' then
      raise exception 'Every flagged card needs a note saying what needs changing.';
    end if;
    insert into public.listing_send_back_items (send_back_id, agency_id, property_id, item_key, note, may_be_breach)
    values (v_id, p_agency_id, p_property_id, btrim(v_item->>'item_key'), btrim(v_item->>'note'),
            coalesce((v_item->>'may_be_breach')::boolean, false));
    v_count := v_count + 1;
  end loop;

  -- A flagged card goes back to not done (Adam, 12 Oct 2026): the agent fixes
  -- it and marks it done the normal way, which clears the flag (below).
  update public.property_items i
     set status = 'open'
    from public.listing_send_back_items f
   where f.send_back_id = v_id and i.property_id = p_property_id
     and i.item_key = f.item_key and i.status = 'done';

  -- The link in the licensee's inbox stops working: the file it pointed at is
  -- about to change.
  update public.property_signoff_requests
     set revoked_at = now()
   where property_id = p_property_id and signed_at is null and revoked_at is null;

  -- "Send to licensee" is to be done again once the changes are made.
  update public.property_items
     set status = 'open'
   where property_id = p_property_id and item_key = 'send_licensee';

  -- The agent signs again. The first signature is kept here, out of the pack.
  select * into v_agent from public.property_items
   where property_id = p_property_id and item_key = 'sign_agent' and status = 'done';
  if v_agent.id is not null then
    insert into public.superseded_agent_signatures (agency_id, property_id, send_back_id, signed_by, signed_at)
    values (p_agency_id, p_property_id, v_id,
            coalesce(v_agent.completed_by, nullif(v_agent.data->>'signedBy', '')::uuid),
            nullif(v_agent.data->>'signedAt', '')::timestamptz);
    update public.property_items
       set status = 'open', data = '{}'::jsonb, completed_by = null
     where id = v_agent.id;
  end if;

  return v_id;
end
$$;
revoke execute on function public.send_back_listing_core(uuid, uuid, jsonb, uuid, uuid) from public, anon, authenticated;

-- ── 2. Marking a flagged card done clears its flag ──────────────────────

create or replace function public.clear_send_back_on_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    update public.listing_send_back_items
       set cleared_at = now(), cleared_by = auth.uid()
     where property_id = new.property_id and item_key = new.item_key and cleared_at is null;
  end if;
  return new;
end
$$;
revoke execute on function public.clear_send_back_on_done() from public, anon, authenticated;
drop trigger if exists property_items_clear_send_back on public.property_items;
create trigger property_items_clear_send_back
  after insert or update of status on public.property_items
  for each row execute function public.clear_send_back_on_done();

commit;

-- ── Verify. One row, both true. ─────────────────────────────────────────
select
  exists (select 1 from pg_trigger where tgname = 'property_items_clear_send_back') as clears_on_done,
  position('set status = ''open''' in pg_get_functiondef('public.send_back_listing_core(uuid, uuid, jsonb, uuid, uuid)'::regprocedure)) > 0 as reopens_cards;
