-- ===== RUN THIS ONE. Migration 0062, licensee review and send back, 12 October 2026 =====
--
-- MIGRATION 0062 — the licensee reviews the file, and can send it back
--
-- Found testing PR #22 on 12 Oct 2026: the licensee's sign-off page showed a
-- short statement and a box to type a name. They could not see the file they
-- were signing. Adam, 12 Oct 2026:
--
--   * The licensee reviews the audit pack (the app, not this file) before
--     signing.
--   * They can flag any card on any stage and send the file back to the agent
--     for changes, with a note, and tick "This may be a breach".
--   * The agent fixes each flagged card, marks it "Changes made", then SIGNS
--     AGAIN. The first agent signature is superseded.
--   * The audit pack shows only the final file and final signatures. The
--     send-back and the superseded signature go only into RealComply's own
--     7-year activity record, by internal id. Never the notes: they can
--     mention names or addresses, so they stay with the agency's data and are
--     deleted with it (DPA cl 4.9, pseudonymised record, settled 9 Oct).
--
-- What this adds:
--
--   1. listing_send_backs: one row per time a file was sent back.
--   2. listing_send_back_items: the flagged cards, each with its note, the
--      "may be a breach" tick, and when and by whom it was cleared.
--   3. superseded_agent_signatures: the agent signature a send-back replaced.
--   4. send_back_listing(): the licensee in charge, signed in.
--      send_back_by_token(): the licensee with the emailed link, no account.
--      Both, in one transaction: record the flags, revoke the outstanding
--      sign-off link, mark "Send to licensee" not done, and supersede the
--      agent's signature. They run as the database owner because a signed
--      agent signature is locked to everyone else (0058).
--   5. clear_send_back_item(): the agent (or the licensee) marks one flagged
--      card "Changes made", with an optional reply.
--   6. Locks while any flagged card is not cleared: no new sign-off link, no
--      agent signature, no licensee signature.
--   7. build_activity_record() also copies the send-backs and superseded
--      signatures, ids and dates only.
--
-- No existing row is changed. SAFE TO RUN TWICE. One transaction.

begin;

-- ── 1–3. Tables ─────────────────────────────────────────────────────────

create table if not exists public.listing_send_backs (
  id                 uuid primary key default gen_random_uuid(),
  agency_id          uuid not null references public.agencies(id) on delete cascade,
  property_id        uuid not null references public.properties(id) on delete cascade,
  -- Null when sent back through the emailed link by a licensee with no account.
  sent_back_by       uuid,
  signoff_request_id uuid references public.property_signoff_requests(id) on delete set null,
  sent_back_at       timestamptz not null default now()
);
create index if not exists listing_send_backs_property_idx on public.listing_send_backs(property_id, sent_back_at);
create index if not exists listing_send_backs_agency_idx on public.listing_send_backs(agency_id);

create table if not exists public.listing_send_back_items (
  id            uuid primary key default gen_random_uuid(),
  send_back_id  uuid not null references public.listing_send_backs(id) on delete cascade,
  agency_id     uuid not null references public.agencies(id) on delete cascade,
  property_id   uuid not null references public.properties(id) on delete cascade,
  item_key      text not null,
  note          text not null check (char_length(btrim(note)) between 1 and 1000),
  may_be_breach boolean not null default false,
  cleared_at    timestamptz,
  cleared_by    uuid,
  reply         text check (reply is null or char_length(reply) <= 1000)
);
create index if not exists listing_send_back_items_open_idx
  on public.listing_send_back_items(property_id) where cleared_at is null;
create index if not exists listing_send_back_items_agency_idx on public.listing_send_back_items(agency_id);

create table if not exists public.superseded_agent_signatures (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies(id) on delete cascade,
  property_id   uuid not null references public.properties(id) on delete cascade,
  send_back_id  uuid references public.listing_send_backs(id) on delete set null,
  signed_by     uuid,
  signed_at     timestamptz,
  superseded_at timestamptz not null default now()
);
create index if not exists superseded_agent_signatures_agency_idx on public.superseded_agent_signatures(agency_id);

comment on table public.listing_send_backs is
  'Each time a licensee sent a listing file back to the agent for changes (0062). Not shown in the audit pack. Ids and dates go into the activity record.';
comment on table public.listing_send_back_items is
  'The cards a licensee flagged when sending a file back, with their note and the agent''s reply (0062). The notes are agency data and are never copied into the activity record.';
comment on table public.superseded_agent_signatures is
  'An agent signature replaced because the file was sent back and the agent signed again (0062). Not shown in the audit pack.';

alter table public.listing_send_backs enable row level security;
alter table public.listing_send_back_items enable row level security;
alter table public.superseded_agent_signatures enable row level security;

-- Read: whoever can see the listing. Write: only through the functions below.
drop policy if exists "listing_send_backs: whoever sees the listing can view" on public.listing_send_backs;
create policy "listing_send_backs: whoever sees the listing can view" on public.listing_send_backs
  for select using (agency_id = public.current_agency_id() and public.can_see_property(property_id));
drop policy if exists "listing_send_back_items: whoever sees the listing can view" on public.listing_send_back_items;
create policy "listing_send_back_items: whoever sees the listing can view" on public.listing_send_back_items
  for select using (agency_id = public.current_agency_id() and public.can_see_property(property_id));
drop policy if exists "superseded_agent_signatures: whoever sees the listing can view" on public.superseded_agent_signatures;
create policy "superseded_agent_signatures: whoever sees the listing can view" on public.superseded_agent_signatures
  for select using (agency_id = public.current_agency_id() and public.can_see_property(property_id));

-- Data API grants: every new table states who may read it.
revoke all on public.listing_send_backs, public.listing_send_back_items, public.superseded_agent_signatures
  from anon, authenticated;
grant select on public.listing_send_backs, public.listing_send_back_items, public.superseded_agent_signatures
  to authenticated;
grant all on public.listing_send_backs, public.listing_send_back_items, public.superseded_agent_signatures
  to service_role;

-- ── 4. Sending back ─────────────────────────────────────────────────────

-- The shared half. p_items is a JSON array of
--   {"item_key": "...", "note": "...", "may_be_breach": true|false}.
-- Returns the new send-back id. Raises with a plain message when refused.
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

-- The licensee in charge, signed in.
create or replace function public.send_back_listing(p_property_id uuid, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid;
begin
  select p.agency_id into v_agency from public.properties p where p.id = p_property_id;
  if v_agency is null or not exists (
       select 1 from public.profiles me
        where me.id = auth.uid() and me.agency_id = v_agency
          and me.is_licensee_in_charge and me.archived_at is null) then
    raise exception 'Only the licensee in charge can send a file back.';
  end if;
  return public.send_back_listing_core(v_agency, p_property_id, p_items, auth.uid(), null);
end
$$;
revoke execute on function public.send_back_listing(uuid, jsonb) from public, anon;
grant execute on function public.send_back_listing(uuid, jsonb) to authenticated;

-- The licensee with the emailed link. The token is the only credential, the
-- same as submit_signoff (0014): a live, unsigned, unrevoked, unexpired link.
create or replace function public.send_back_by_token(p_token uuid, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.property_signoff_requests;
begin
  select * into v_request from public.property_signoff_requests
   where token = p_token and signed_at is null and revoked_at is null and expires_at > now();
  if v_request.id is null then
    raise exception 'This link is no longer valid.';
  end if;
  return public.send_back_listing_core(v_request.agency_id, v_request.property_id, p_items, null, v_request.id);
end
$$;
revoke execute on function public.send_back_by_token(uuid, jsonb) from public;
grant execute on function public.send_back_by_token(uuid, jsonb) to anon, authenticated;

-- ── 5. Clearing a flagged card ──────────────────────────────────────────

-- Whoever can see the listing in that office: the agent, normally, or the
-- licensee. Who and when come from the login, never from the browser.
create or replace function public.clear_send_back_item(p_item_id uuid, p_reply text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.listing_send_back_items;
begin
  select * into v_row from public.listing_send_back_items where id = p_item_id;
  if v_row.id is null
     or v_row.agency_id is distinct from public.current_agency_id()
     or not public.can_see_property(v_row.property_id) then
    raise exception 'You can''t change this card.';
  end if;
  if p_reply is not null and char_length(p_reply) > 1000 then
    raise exception 'Keep the reply under 1,000 characters.';
  end if;
  update public.listing_send_back_items
     set cleared_at = now(), cleared_by = auth.uid(), reply = nullif(btrim(coalesce(p_reply, '')), '')
   where id = p_item_id and cleared_at is null;
  return found;
end
$$;
revoke execute on function public.clear_send_back_item(uuid, text) from public, anon;
grant execute on function public.clear_send_back_item(uuid, text) to authenticated;

-- Whether a listing still has flagged cards to fix. Used by the locks below
-- and by the app.
create or replace function public.listing_has_open_send_back(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.listing_send_back_items
                  where property_id = p_property_id and cleared_at is null);
$$;
revoke execute on function public.listing_has_open_send_back(uuid) from public, anon;
grant execute on function public.listing_has_open_send_back(uuid) to authenticated;

-- ── 6. Locks while a flagged card is not cleared ────────────────────────

-- No new sign-off link. Same function as 0058, with the check added.
create or replace function public.guard_signoff_request_insert()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if public.listing_has_open_send_back(new.property_id) then
    raise exception 'Some cards your licensee flagged are not marked "Changes made" yet.';
  end if;
  select a.licensee_email into new.sent_to from public.agencies a where a.id = new.agency_id;
  if new.sent_to is null or btrim(new.sent_to) = '' then
    raise exception 'Add the licensee''s email before sending a sign-off link.';
  end if;
  new.created_by := auth.uid();
  new.signed_at := null;
  new.signed_name := null;
  return new;
end
$$;
revoke execute on function public.guard_signoff_request_insert() from public, anon, authenticated;

-- No agent or licensee signature. Same function as 0058, with the check added.
create or replace function public.guard_listing_signoff()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_agent uuid;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.item_key not in ('sign_licensee', 'sign_agent', 'b4') then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'done' then
    raise exception 'This sign-off is already recorded and can''t be changed.';
  end if;

  if new.status = 'done' then
    if new.item_key in ('sign_licensee', 'sign_agent') and public.listing_has_open_send_back(new.property_id) then
      raise exception 'Some cards the licensee flagged are not marked "Changes made" yet.';
    end if;
    if new.item_key in ('sign_licensee', 'b4') then
      if not exists (select 1 from public.profiles me
                      where me.id = auth.uid() and me.agency_id = new.agency_id
                        and me.is_licensee_in_charge and me.archived_at is null) then
        raise exception 'Only the licensee in charge can sign this.';
      end if;
    else
      select p.created_by into v_agent from public.properties p where p.id = new.property_id;
      if v_agent is distinct from auth.uid() then
        raise exception 'Only the listing''s agent can sign this.';
      end if;
    end if;
    -- Who and when come from the login, never from the browser.
    new.completed_by := auth.uid();
    new.data := coalesce(new.data, '{}'::jsonb)
                || jsonb_build_object('signedAt', now(), 'signedBy', auth.uid());
  end if;

  return new;
end
$$;
revoke execute on function public.guard_listing_signoff() from public, anon, authenticated;

-- ── 7. Into the 7-year record: ids and dates only ───────────────────────

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'build_activity_record_0058') then
    alter function public.build_activity_record(uuid) rename to build_activity_record_0058;
  end if;
end
$$;

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
      from public.superseded_agent_signatures g where g.agency_id = p_agency_id), '[]'));
$$;
revoke execute on function public.build_activity_record_0058(uuid) from public, anon, authenticated;
revoke execute on function public.build_activity_record(uuid) from public, anon, authenticated;
grant execute on function public.build_activity_record(uuid) to service_role;

commit;

-- ── Verify. One row, all true. ──────────────────────────────────────────
select
  to_regclass('public.listing_send_backs') is not null           as send_backs_table,
  to_regclass('public.listing_send_back_items') is not null      as items_table,
  to_regclass('public.superseded_agent_signatures') is not null  as superseded_table,
  exists (select 1 from pg_proc where proname = 'send_back_by_token')       as link_send_back,
  exists (select 1 from pg_proc where proname = 'build_activity_record_0058') as record_extended,
  not has_function_privilege('anon', 'public.send_back_listing(uuid, jsonb)', 'execute') as signed_in_only;
