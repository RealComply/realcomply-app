-- ===== 0104: The price statement card (b4) is an agent's tick (Adam, 2 Nov 2026) =====
--
-- REVERSAL.
-- WAS (0058, 0062, 0066, 0100): b4 was the licensee in charge's own card. Only
--   an active licensee in charge could mark it done, in the app, or the
--   licensee signed an approval link sent by email (property_signoff_requests,
--   item_key 'b4'). Once done it couldn't be changed, only the licensee could
--   reopen it, and an assistant never could.
-- NOW: any agent on the listing ticks it, to confirm the licensee in charge
--   approved the price statement. No link, no name, no date, no upload. It
--   works the same on every plan, including an office whose licensee has no
--   login. The licensee can still tick it if they're the one on the listing.
--   It reopens like any other card.
-- WHY: the Act doesn't require the licensee's sign-off at this point. The
--   licensee already signs the whole file off before it's filed (that sign-off,
--   'sign_licensee', is unchanged here), and Adam wants no extra steps that
--   slow agents down.
--
-- WHAT IS KEPT:
--   * Every approval given before this change, as it was. A done b4 from
--     before it carries no 'tickedAt' (every tick from now on does), and stays
--     exactly as the licensee left it: nobody signed in can change it. Reopening
--     it moves it into the card's history (listing_signoff_cancellations), as
--     since 0100, and the card starts again as an ordinary tick.
--   * The rows in property_signoff_requests, untouched. No new b4 link can be
--     made (none was waiting on 2 Nov 2026).
--   * When the ESP the statement rests on changes, b4 still goes back to open
--     and the earlier tick is kept in the card's history (0100's rule), so the
--     new price statement is ticked again.
--
-- WHO AND WHEN ON A TICK. Stamped here from the login and the clock, never
-- from the browser: completed_by, data.tickedBy and data.tickedAt, the way the
-- sign-off cards were stamped. The file and the audit record read "Ticked by
-- [name], [date]" from them (src/lib/rules/price-statement.ts). The marks of a
-- licensee's approval (signedVia, signedName, signoffRequestId, sentTo,
-- typedName, signedAt, signedBy) can't be written by anyone signed in, so a
-- tick can never read as one.
--
-- No new tables. Functions only, each replaced whole. Safe to run twice.

begin;

-- ── 1. The sign-off cards' guard, without b4 ─────────────────────────────
-- 0066's guard for sign_licensee and sign_agent is unchanged. b4 has its own
-- short branch first.
create or replace function public.guard_listing_signoff()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_agent uuid;
  v_file_before text;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- b4, the agent's tick (0104).
  if new.item_key = 'b4' then
    -- The licensee's approval from before 2 Nov 2026 stays as it was.
    if tg_op = 'UPDATE' and old.status = 'done' and not (coalesce(old.data, '{}'::jsonb) ? 'tickedAt') then
      raise exception 'This approval was given by the licensee in charge before 2 November 2026 and can''t be changed. Reopen the card to tick it again.';
    end if;
    new.data := coalesce(new.data, '{}'::jsonb)
                - array['signedVia', 'signedName', 'signoffRequestId', 'sentTo', 'typedName', 'signedAt', 'signedBy',
                        'tickedBy', 'tickedAt'];
    if new.status = 'done' then
      if tg_op = 'UPDATE' and old.status = 'done' then
        -- Still ticked: who ticked it, and when, stay.
        new.completed_by := old.completed_by;
        new.data := new.data || jsonb_build_object('tickedBy', old.data -> 'tickedBy', 'tickedAt', old.data -> 'tickedAt');
      else
        new.completed_by := auth.uid();
        new.data := new.data || jsonb_build_object('tickedBy', auth.uid(), 'tickedAt', now());
      end if;
    end if;
    return new;
  end if;

  if new.item_key not in ('sign_licensee', 'sign_agent') then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'done' then
    raise exception 'This sign-off is already recorded and can''t be changed.';
  end if;

  -- 0066: the app only ever writes these three. Any other spelling, such as
  -- 'Done', would skip the signer check below and still print as done in
  -- the pack and on the summary.
  if new.status not in ('open', 'done', 'flagged') then
    raise exception 'This card can only be open, done or flagged.';
  end if;

  -- 0066: when the card went on the file is the database's time.
  if tg_op = 'INSERT' then
    new.recorded_at := now();
  else
    new.recorded_at := old.recorded_at;
  end if;

  -- 0066: what the emailed link records (submit_signoff) never comes from
  -- the browser, even on a card that is not done yet. Nor a name, time,
  -- completer or date on a card nobody has signed.
  if new.item_key = 'sign_licensee' then
    new.data := coalesce(new.data, '{}'::jsonb) - array['signedVia', 'signedName', 'signoffRequestId', 'sentTo'];
    if new.status is distinct from 'done' then
      new.data := new.data - array['typedName', 'signedAt', 'signedBy'];
      new.completed_by := null;
      new.event_date := null;
    end if;

    -- A file on the licensee's card comes from the licensee in charge.
    if new.evidence_path is not null then
      if tg_op = 'UPDATE' then
        v_file_before := old.evidence_path;
      else
        select i.evidence_path into v_file_before from public.property_items i
         where i.property_id = new.property_id and i.item_key = new.item_key;
      end if;
      if new.evidence_path is distinct from v_file_before
         and not exists (select 1 from public.profiles me
                          where me.id = auth.uid() and me.agency_id = new.agency_id
                            and me.is_licensee_in_charge and me.archived_at is null) then
        raise exception 'Only the licensee in charge can attach a file to this card.';
      end if;
    end if;
  end if;

  if new.status = 'done' then
    if public.listing_has_open_send_back(new.property_id) then
      raise exception 'Some cards the licensee flagged are not marked "Changes made" yet.';
    end if;
    if new.item_key = 'sign_licensee' then
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

-- ── 2. No new price statement links ──────────────────────────────────────
-- 0066's guard for issuing a link, for the final sign-off only. A b4 link is
-- refused before anything else (0104).
create or replace function public.guard_signoff_request_insert()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_agency_name text;
  v_licensee_name text;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- What the link is for. Without one it is the final sign-off.
  new.item_key := coalesce(new.item_key, 'sign_licensee');
  if new.item_key = 'b4' then
    raise exception 'The price statement isn''t sent to the licensee any more. Tick it on its card once they have approved it.';
  end if;

  if public.listing_has_open_send_back(new.property_id) then
    raise exception 'Some cards your licensee flagged are not marked "Changes made" yet.';
  end if;
  select a.licensee_email, a.name, a.licensee_name
    into new.sent_to, v_agency_name, v_licensee_name
    from public.agencies a where a.id = new.agency_id;
  if new.sent_to is null or btrim(new.sent_to) = '' then
    raise exception 'Add the licensee''s email before sending a sign-off link.';
  end if;
  new.created_by := auth.uid();
  new.signed_at := null;
  new.signed_name := null;
  -- The link's credential and lifetime come from the database, never the browser.
  new.token := gen_random_uuid();
  new.created_at := now();
  new.expires_at := now() + interval '30 days';
  new.revoked_at := null;
  new.email_sent_at := null;
  new.email_attempts := 0;
  new.email_error := null;
  new.price_statement := null;
  new.esp_low := null;
  new.esp_high := null;

  -- One live link per listing. The lock makes a second click wait for the
  -- first to finish, then see its link.
  perform pg_advisory_xact_lock(hashtextextended('signoff_request:' || new.property_id::text || ':' || new.item_key, 0));
  if exists (select 1 from public.property_signoff_requests r
              where r.property_id = new.property_id and r.item_key = new.item_key
                and r.signed_at is null and r.revoked_at is null and r.expires_at > now()) then
    raise exception 'A request is already out for this. Send it again, or withdraw it first.';
  end if;

  return new;
end
$$;
revoke execute on function public.guard_signoff_request_insert() from public, anon, authenticated;

-- ── 3. When the ESP changes: a tick goes into the history too ────────────
-- 0100's function, with the tick's own marks taken off the card as well.
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
                    - array['signedVia', 'signedName', 'signoffRequestId', 'sentTo', 'typedName', 'signedAt', 'signedBy',
                            'tickedBy', 'tickedAt'])
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

-- ── 4. Reopening: b4 like any other card ─────────────────────────────────
-- 0100's function. b4 is no longer the licensee's alone, nor closed to an
-- assistant. A licensee's approval from before 2 Nov 2026 goes into the
-- card's history, as before; a tick reopens like any other card.
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
  if p_item_key = 'sign_licensee' and not v_licensee then
    raise exception 'Only the licensee in charge can reopen a licensee sign-off.';
  end if;
  if v_me.is_assistant and p_item_key in ('sign_agent', 'sign_licensee') then
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

  -- The licensee's approval from before 2 Nov 2026: kept in the history.
  if p_item_key = 'b4' and v_row.status = 'done' and not (coalesce(v_row.data, '{}'::jsonb) ? 'tickedAt') then
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

  -- Every other card, a b4 tick among them: back to open, with everything on
  -- it kept. A tick the document read gave it no longer says so.
  update public.property_items
     set status = 'open', completed_by = null, data = coalesce(data, '{}'::jsonb) #- '{aiDraft,autoCompleted}'
   where id = v_row.id;
  return 'reopened';
end
$$;
revoke execute on function public.reopen_listing_card(uuid, text, boolean) from public, anon;
grant execute on function public.reopen_listing_card(uuid, text, boolean) to authenticated;

commit;

-- ── Check ──────────────────────────────────────────────────────────────
-- One row, every value true: the four functions are the 0104 versions.
select
  position('tickedAt' in pg_get_functiondef('public.guard_listing_signoff()'::regprocedure)) > 0
    as b4_is_a_tick,
  position('isn''''t sent to the licensee any more' in pg_get_functiondef('public.guard_signoff_request_insert()'::regprocedure)) > 0
    as no_new_b4_links,
  position('tickedAt' in pg_get_functiondef('public.cancel_price_statement_approval(uuid, text, text)'::regprocedure)) > 0
    as esp_change_keeps_the_tick,
  position('p_item_key = ''sign_licensee'' and not v_licensee' in pg_get_functiondef('public.reopen_listing_card(uuid, text, boolean)'::regprocedure)) > 0
    as b4_reopens_like_any_card;
