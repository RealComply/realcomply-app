-- ===== RUN THIS ONE. Migration 0065, price statement approval by email, 12 October 2026 =====
--
-- MIGRATION 0065 — the licensee approves the price statement (b4) by email
--
-- b4, "Licensee approved the price statement before publication", is the
-- licensee in charge's own card. In an office whose licensee does not use
-- RealComply (an office plan whose founder answered "No, someone else", or an
-- agent on their own plan) nobody could complete it, so every listing there
-- stopped at Pre-market. Adam chose option (a): b4 goes to the licensee by
-- an emailed link, the same way as the final sign-off, and they approve the
-- exact price statement there. The approval stays the licensee's
-- own. The final sign-off link works exactly as before.
--
--   1. Each link says what it is for (item_key). A b4 link fixes the price
--      statement and the ESP the licensee was shown. Existing links read as
--      'sign_licensee' through the column default; no existing row changes.
--   2. Every new link's token, expiry and email status still come from the
--      database (0064's lines, kept as they are).
--   3. A b4 link is refused when the office has an active licensee in charge,
--      when the licensee email on file is the login of someone in this
--      office, on a practice listing, and once b4 is approved. The statement
--      the licensee reads is built here, never by the browser.
--   4. One live link per listing and purpose, even with two clicks at once.
--   5. A withdrawn link can't be brought back; a signed one can't be withdrawn.
--   6. The browser can't put the link's keys on b4 or sign_licensee, nor a
--      name, time, completer or date on either card while it is not done.
--      Only the licensee in charge can put a file on either card. On the
--      three sign-off cards the status is open, done or flagged, and the
--      time the card was recorded is the database's.
--   7. get_signoff_request_v3 for the public page. v1 and v2, which older
--      app builds read, now return final sign-off links only. submit_signoff
--      completes b4 for a b4 link; its sign_licensee half is 0014's, except
--      that a name, time, completer or date already on an open card is
--      dropped.
--   8. send_back_by_token (0062) takes final sign-off links only. A b4 link is
--      exempt from 0062's flagged-card lock, so a flagged b4 can be approved
--      again and its flag cleared.
--   9. Only the licensee (or the agent on their own plan), or the account
--      holder of an office with no licensee in charge, can change the
--      licensee's details. Nobody signed in can make themselves licensee in
--      charge. Every change is logged.
--  10. The 7-year record says what each link was for, and when the
--      licensee's details changed (ids and dates only).
--
-- Safe while the app now live is in use: it creates final sign-off links
-- only, without an item_key, and reads them through get_signoff_request_v2,
-- which still returns every one of them.
--
-- Run after 0064. SAFE TO RUN TWICE. One transaction.
--
-- Tests: supabase/tests/price_statement_link.sql.

begin;

-- ── 0. Order ────────────────────────────────────────────────────────────
-- 0062 and 0063 (send back) and 0064 (the database chooses the token).
do $$
begin
  if to_regprocedure('public.send_back_by_token(uuid, jsonb)') is null
     or not exists (select 1 from pg_trigger where tgname = 'property_items_clear_send_back')
     or position('new.token := gen_random_uuid()' in
                 pg_get_functiondef('public.guard_signoff_request_insert()'::regprocedure)) = 0 then
    raise exception 'Run 0062, 0063 and 0064 before 0065.';
  end if;
end
$$;

-- ── 1. What a link is for ───────────────────────────────────────────────
-- A constant default only changes the catalogue: no row is rewritten.
alter table public.property_signoff_requests
  add column if not exists item_key text not null default 'sign_licensee',
  add column if not exists price_statement text,
  add column if not exists esp_low numeric,
  add column if not exists esp_high numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'property_signoff_requests_kind_check') then
    alter table public.property_signoff_requests add constraint property_signoff_requests_kind_check check (
         (item_key = 'sign_licensee' and price_statement is null and esp_low is null and esp_high is null)
      or (item_key = 'b4' and price_statement is not null and char_length(price_statement) between 1 and 300));
  end if;
end
$$;

comment on column public.property_signoff_requests.item_key is
  'What the link is for: sign_licensee (the final sign-off on the file) or b4 (the licensee''s approval of the price statement, 0065).';
comment on column public.property_signoff_requests.price_statement is
  'b4 only: the exact words the licensee approves, set when the link was sent. Never changed afterwards.';
comment on column public.property_signoff_requests.esp_low is
  'b4 only: the estimated selling price on the file when the link was sent. If the ESP changes, the link stops working.';
comment on column public.property_signoff_requests.esp_high is
  'b4 only: see esp_low.';

create index if not exists property_signoff_requests_property_item_idx
  on public.property_signoff_requests (property_id, item_key);

-- Readable by whoever can see the listing, like the other columns (0058).
-- Still no token. Not updatable: 0058's update grant names its four columns.
grant select (item_key, price_statement, esp_low, esp_high) on public.property_signoff_requests to authenticated;

-- ── 2. Helpers ──────────────────────────────────────────────────────────

-- A number from jsonb: a number, or a string of digits. Anything else is null.
create or replace function public.jsonb_to_numeric(j jsonb)
returns numeric
language sql
immutable
set search_path = public
as $fn$
  select case jsonb_typeof(j)
           when 'number' then (j #>> '{}')::numeric
           when 'string' then case when btrim(j #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$'
                                   then btrim(j #>> '{}')::numeric end
         end;
$fn$;

-- The ESP on foot: d3's revised figures when both are there, otherwise a4's.
-- Same rule as src/lib/data/effective-esp.ts. Runs as the caller, so a
-- signed-in person only reads listings they can see.
create or replace function public.listing_effective_esp(p_property_id uuid, out esp_low numeric, out esp_high numeric)
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_low numeric;
  v_high numeric;
begin
  select public.jsonb_to_numeric(d.data -> 'revisedEspLow'), public.jsonb_to_numeric(d.data -> 'revisedEspHigh')
    into v_low, v_high
    from public.property_items d where d.property_id = p_property_id and d.item_key = 'd3';
  if v_low is not null and v_high is not null then
    esp_low := v_low;
    esp_high := v_high;
    return;
  end if;
  select public.jsonb_to_numeric(a.data -> 'espLow'), public.jsonb_to_numeric(a.data -> 'espHigh')
    into esp_low, esp_high
    from public.property_items a where a.property_id = p_property_id and a.item_key = 'a4';
end
$fn$;

-- What the licensee reads. Built here so the browser can't word it. Adapts
-- the final sign-off statement (src/lib/signoff/statement.ts), including its
-- liability sentence, which is with Natalie Melia for review. Changing the
-- words is a one-function migration.
--
-- The address, agency name and licensee name are each put on one line, the
-- same way as the ruleset name. Any agent who can see the listing can edit
-- its address, line breaks included, and a line break there could put a
-- made-up ESP or price statement line above the real ones.
create or replace function public.price_statement_text(
  p_address text, p_agency text, p_licensee text, p_price text,
  p_low numeric, p_high numeric, p_ruleset text, p_on date)
returns text
language sql
stable
set search_path = public
as $fn$
  select concat_ws(E'\n',
    'Property: ' || coalesce(nullif(btrim(regexp_replace(coalesce(p_address, ''), '\s+', ' ', 'g')), ''),
                             'not recorded in the file'),
    'Agency: ' || coalesce(nullif(btrim(regexp_replace(coalesce(p_agency, ''), '\s+', ' ', 'g')), ''),
                           'not recorded in the file'),
    'Licensee in charge: ' || coalesce(nullif(btrim(regexp_replace(coalesce(p_licensee, ''), '\s+', ' ', 'g')), ''),
                                       'not recorded in the file'),
    'Estimated selling price on the file: ' || case
      when p_low is null or p_high is null then 'not recorded in the file'
      when p_low = p_high then '$' || to_char(p_low, 'FM999,999,999,990')
      else '$' || to_char(p_low, 'FM999,999,999,990') || ' to $' || to_char(p_high, 'FM999,999,999,990')
    end,
    '',
    'Price statement to be advertised:',
    p_price,
    '',
    'By approving below I confirm that I am the licensee in charge responsible for supervising this sale, that I have checked the price statement above against the estimated selling price on the file, and that I approve it for use in advertising this property.',
    '',
    'This is only the price statement. It is not the sign-off on the sales file, which is asked for separately.',
    '',
    'This approval is my own assessment. RealComply organises the file and flags what is outstanding; it does not decide whether this price statement complies, does not give legal advice, and has formed no view in my place. Responsibility for this decision is mine.',
    '',
    'Ruleset: ' || coalesce(nullif(btrim(p_ruleset), ''), 'not recorded'),
    'Requested: ' || to_char(p_on, 'FMDD FMMonth YYYY'));
$fn$;

-- Whether the signed-in person's office has an active licensee in charge.
-- Owner's rights: since 0058 an agent can't read colleagues' profiles. Same
-- test as may_change_agency_details() and the app's priceStatementByEmail().
create or replace function public.office_has_active_licensee()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (select 1 from public.profiles p
                  where p.agency_id = public.current_agency_id()
                    and p.is_licensee_in_charge and p.archived_at is null);
$fn$;

-- Whether the licensee email on file is the login of someone in this
-- office who is not an active licensee in charge, past members included:
-- an archived person's inbox still works.
--
-- The login only, not the profile's email. Any member can type any address
-- into their own profile, so matching it let one member stop b4 by email
-- for the whole office. It never showed whose inbox it was either. A login
-- can't be changed without the new inbox confirming it.
create or replace function public.licensee_email_is_a_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
      from public.agencies a
      join public.profiles p on p.agency_id = a.id
      join auth.users u on u.id = p.id
     where a.id = public.current_agency_id()
       and nullif(btrim(a.licensee_email), '') is not null
       and not (p.is_licensee_in_charge and p.archived_at is null)
       and lower(btrim(u.email)) = lower(btrim(a.licensee_email)));
$fn$;

-- Whether a b4 request can still be approved: b4 not approved yet, the ESP
-- reasoning card (a4c) still done, and the ESP on foot the one the licensee
-- was shown. If the price moved after the link went out, the licensee would
-- be approving against a figure that is no longer the file's.
create or replace function public.price_request_current(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
      from public.property_signoff_requests r
      cross join lateral public.listing_effective_esp(r.property_id) e
     where r.id = p_request_id and r.item_key = 'b4'
       and e.esp_low is not distinct from r.esp_low
       and e.esp_high is not distinct from r.esp_high
       and exists (select 1 from public.property_items g
                    where g.property_id = r.property_id and g.item_key = 'a4c' and g.status = 'done')
       and not exists (select 1 from public.property_items i
                        where i.property_id = r.property_id and i.item_key = 'b4' and i.status = 'done'));
$fn$;

revoke execute on function public.jsonb_to_numeric(jsonb) from public, anon;
revoke execute on function public.listing_effective_esp(uuid) from public, anon;
revoke execute on function public.price_statement_text(text, text, text, text, numeric, numeric, text, date) from public, anon;
revoke execute on function public.office_has_active_licensee() from public, anon;
revoke execute on function public.licensee_email_is_a_member() from public, anon;
revoke execute on function public.price_request_current(uuid) from public, anon, authenticated;
-- The insert guard runs as the caller, so the caller needs these.
grant execute on function public.jsonb_to_numeric(jsonb) to authenticated;
grant execute on function public.listing_effective_esp(uuid) to authenticated;
grant execute on function public.price_statement_text(text, text, text, text, numeric, numeric, text, date) to authenticated;
grant execute on function public.office_has_active_licensee() to authenticated;
grant execute on function public.licensee_email_is_a_member() to authenticated;

-- ── 3. Issuing a link: 0064's guard, with the lines marked 0065 ─────────
create or replace function public.guard_signoff_request_insert()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_agency_name text;
  v_licensee_name text;
  v_address text;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- 0065: what the link is for. Without one it is the final sign-off.
  new.item_key := coalesce(new.item_key, 'sign_licensee');

  -- 0062's lock, now for the final sign-off only (0065). A b4 the licensee
  -- flagged must be approvable again, or its flag could never clear.
  if new.item_key = 'sign_licensee' and public.listing_has_open_send_back(new.property_id) then
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

  -- 0065: the price statement. Only when the licensee can't approve it in the
  -- app, only to an outside address, never on a practice listing, and the
  -- statement and ESP come from here.
  if new.item_key = 'b4' then
    if public.office_has_active_licensee() then
      raise exception 'Your licensee in charge uses RealComply, so they approve the price statement in the app.';
    end if;
    if public.licensee_email_is_a_member() then
      raise exception 'The licensee email on file belongs to someone in this office. It has to be your licensee in charge''s own address.';
    end if;
    if exists (select 1 from public.properties p where p.id = new.property_id and p.test_mode) then
      raise exception 'This is a practice listing, so nothing is sent to your licensee.';
    end if;
    if exists (select 1 from public.property_items i
                where i.property_id = new.property_id and i.item_key = 'b4' and i.status = 'done') then
      raise exception 'The price statement on this listing is already approved.';
    end if;
    -- One line, as it will be advertised: runs of spaces and line breaks
    -- become one space, then the ends are trimmed.
    new.price_statement := nullif(btrim(regexp_replace(coalesce(new.price_statement, ''), '\s+', ' ', 'g')), '');
    if new.price_statement is null or char_length(new.price_statement) > 300 then
      raise exception 'Type the price statement, up to 300 characters.';
    end if;
    -- The ruleset name also goes into the statement, so it gets the same
    -- treatment and a short limit: it can't add lines of its own.
    new.ruleset_version := left(nullif(btrim(regexp_replace(coalesce(new.ruleset_version, ''), '\s+', ' ', 'g')), ''), 80);
    select e.esp_low, e.esp_high into new.esp_low, new.esp_high
      from public.listing_effective_esp(new.property_id) e;
    select p.address into v_address from public.properties p where p.id = new.property_id;
    new.statement := public.price_statement_text(v_address, v_agency_name, v_licensee_name,
      new.price_statement, new.esp_low, new.esp_high, new.ruleset_version,
      (now() at time zone 'Australia/Sydney')::date);
  else
    new.price_statement := null;
    new.esp_low := null;
    new.esp_high := null;
  end if;

  -- 0065: one live link per listing and purpose. The lock makes a second
  -- click wait for the first to finish, then see its link.
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
-- The 0058 trigger property_signoff_requests_insert_guard already calls it.

-- ── 4. Withdrawing goes one way ─────────────────────────────────────────
-- Withdrawing a link that is already withdrawn keeps the first time, so a
-- second click in another tab is not an error.
create or replace function public.guard_signoff_request_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.revoked_at is distinct from old.revoked_at then
    if old.revoked_at is not null then
      if new.revoked_at is null then
        raise exception 'A withdrawn link can''t be brought back. Send a new one.';
      end if;
      new.revoked_at := old.revoked_at;
    elsif old.signed_at is not null then
      raise exception 'That link has already been signed, so it can''t be withdrawn.';
    else
      new.revoked_at := now();
    end if;
  end if;
  return new;
end
$$;
revoke execute on function public.guard_signoff_request_update() from public, anon, authenticated;
drop trigger if exists property_signoff_requests_update_guard on public.property_signoff_requests;
create trigger property_signoff_requests_update_guard
  before update on public.property_signoff_requests
  for each row execute function public.guard_signoff_request_update();

-- ── 5. Listing sign-offs: 0062's guard, plus the 0065 lines ────────────
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
  if new.item_key not in ('sign_licensee', 'sign_agent', 'b4') then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'done' then
    raise exception 'This sign-off is already recorded and can''t be changed.';
  end if;

  -- 0065: the app only ever writes these three. Any other spelling, such as
  -- 'Done', would skip the signer check below and still print as done in
  -- the pack and on the summary.
  if new.status not in ('open', 'done', 'flagged') then
    raise exception 'This card can only be open, done or flagged.';
  end if;

  -- 0065: when the card went on the file is the database's time. 0001 says
  -- recorded_at is set by the server and never changed; the app never
  -- writes it. On these cards it sits in the 7-year record beside who
  -- signed, so nobody else writes it either.
  if tg_op = 'INSERT' then
    new.recorded_at := now();
  else
    new.recorded_at := old.recorded_at;
  end if;

  -- 0065: what the emailed link records (submit_signoff) never comes from
  -- the browser, even on a card that is not done yet.
  if new.item_key in ('sign_licensee', 'b4') then
    new.data := coalesce(new.data, '{}'::jsonb) - array['signedVia', 'signedName', 'signoffRequestId', 'sentTo'];
    -- Nor a name or time on a card nobody has signed. The file reads
    -- typedName before the link's name and signedAt before the link's time
    -- (src/lib/rules/listing-signature.ts), so a name typed onto the open
    -- card would stand in for the licensee's once they signed by link.
    -- Signing in the app writes typedName with status done in one write,
    -- and the lines below stamp signedAt and signedBy, so nothing real is
    -- lost.
    --
    -- Nor a completer or a date. The emailed link keeps the columns it
    -- doesn't set, so the 7-year record and the end-of-subscription export
    -- would name an agent as completing the licensee's own card, and the
    -- pack would print a date the agent chose as the approval date. b4
    -- takes no date, and signing in the app stamps completed_by below.
    if new.status is distinct from 'done' then
      new.data := new.data - array['typedName', 'signedAt', 'signedBy'];
      new.completed_by := null;
      new.event_date := null;
    end if;

    -- A file on either card comes from the licensee in charge, as in
    -- uploadEvidence. An emailed approval keeps a file already on the card,
    -- so an agent's file would sit under the licensee's approval as if it
    -- were part of it. Taking a file off is not refused here. An upsert
    -- that carries the card's own file forward is not a new file.
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

-- ── 6. The public page reads v3; v1 and v2 read final links only ───────
-- An older app build reads v2 (and before that v1) and words whatever comes
-- back as the final sign-off. Say the app is rolled back after a b4 link
-- has gone out: the licensee would be shown the b4 link as the sign-off on
-- the whole file. So v1 and v2 now return final sign-off links only. Same
-- columns as before, so the grants stay. Every link the live app makes is a
-- final sign-off link, so it sees no change.
create or replace function public.get_signoff_request(p_token uuid)
returns table (
  request_id uuid,
  statement text,
  ruleset_version text,
  property_address text,
  agency_name text,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select r.id, r.statement, r.ruleset_version, p.address, a.name, r.expires_at
  from public.property_signoff_requests r
  join public.properties p on p.id = r.property_id
  join public.agencies a on a.id = r.agency_id
  where r.token = p_token
    and r.signed_at is null
    and r.revoked_at is null
    and r.expires_at > now()
    and r.item_key = 'sign_licensee';
$$;

create or replace function public.get_signoff_request_v2(p_token uuid)
returns table (
  request_id uuid,
  statement text,
  ruleset_version text,
  property_address text,
  agency_name text,
  requested_by_name text,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select r.id, r.statement, r.ruleset_version, p.address, a.name,
         nullif(trim(coalesce(pr.full_name, '')), ''),
         r.expires_at
  from public.property_signoff_requests r
  join public.properties p on p.id = r.property_id
  join public.agencies a on a.id = r.agency_id
  left join public.profiles pr on pr.id = r.created_by
  where r.token = p_token
    and r.signed_at is null
    and r.revoked_at is null
    and r.expires_at > now()
    and r.item_key = 'sign_licensee';
$$;

-- A b4 link that can no longer be approved (approved already, the ESP
-- changed, or the ESP reasoning reopened) reads as no longer valid.
create or replace function public.get_signoff_request_v3(p_token uuid)
returns table (
  request_id uuid,
  item_key text,
  statement text,
  price_statement text,
  esp_low numeric,
  esp_high numeric,
  ruleset_version text,
  property_address text,
  agency_name text,
  requested_by_name text,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select r.id, r.item_key, r.statement, r.price_statement, r.esp_low, r.esp_high, r.ruleset_version,
         p.address, a.name, nullif(trim(coalesce(pr.full_name, '')), ''), r.expires_at
    from public.property_signoff_requests r
    join public.properties p on p.id = r.property_id
    join public.agencies a on a.id = r.agency_id
    left join public.profiles pr on pr.id = r.created_by
   where r.token = p_token
     and r.signed_at is null and r.revoked_at is null and r.expires_at > now()
     and (r.item_key = 'sign_licensee' or public.price_request_current(r.id));
$$;
revoke execute on function public.get_signoff_request_v3(uuid) from public;
grant execute on function public.get_signoff_request_v3(uuid) to anon, authenticated;

-- ── 7. Signing. Same signature, so the 0014 grants stay ────────────────
create or replace function public.submit_signoff(p_token uuid, p_typed_name text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.property_signoff_requests;
  v_rows integer;
begin
  if p_typed_name is null or btrim(p_typed_name) = '' then
    return false;
  end if;

  select * into v_request from public.property_signoff_requests
   where token = p_token and signed_at is null and revoked_at is null and expires_at > now()
   for update;
  if v_request.id is null then
    return false;
  end if;

  -- 0065: the price statement. This runs with the owner's rights, so
  -- guard_listing_signoff doesn't run; its rules for b4 are kept here: b4
  -- only, never over an approval already recorded, and who, when and what
  -- come from the request row, never the browser. The card's data is
  -- replaced, keeping only the name of a file already attached. b4 takes
  -- no date, so a date already on the open card (the guard let one through
  -- before 0065) goes too, or it would print as the approval date.
  if v_request.item_key = 'b4' then
    if char_length(btrim(p_typed_name)) > 200 or not public.price_request_current(v_request.id) then
      return false;
    end if;
    update public.property_signoff_requests
       set signed_at = now(), signed_name = btrim(p_typed_name)
     where id = v_request.id
    returning * into v_request;
    insert into public.property_items (agency_id, property_id, item_key, status, data, completed_by)
    values (v_request.agency_id, v_request.property_id, 'b4', 'done',
            jsonb_build_object('note', v_request.price_statement,
                               'signedName', v_request.signed_name,
                               'signedVia', 'link',
                               'signoffRequestId', v_request.id,
                               'signedAt', v_request.signed_at,
                               'sentTo', v_request.sent_to),
            null)
    on conflict (property_id, item_key) do update
      set status = 'done',
          completed_by = null,
          event_date = null,
          data = excluded.data || jsonb_strip_nulls(jsonb_build_object(
                   'evidenceFileName', public.property_items.data -> 'evidenceFileName'))
      where public.property_items.status is distinct from 'done';
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      -- Approved in the app a moment ago. Undo the claim on the request too.
      raise exception 'The price statement on this listing is already approved.';
    end if;
    return true;
  end if;

  -- The final sign-off: 0014, except for the lines marked 0065.
  update public.property_signoff_requests
     set signed_at = now(),
         signed_name = btrim(p_typed_name)
   where token = p_token
     and signed_at is null
     and revoked_at is null
     and expires_at > now()
  returning * into v_request;

  if v_request.id is null then
    return false;
  end if;

  insert into public.property_items (agency_id, property_id, item_key, status, data)
  values (
    v_request.agency_id,
    v_request.property_id,
    'sign_licensee',
    'done',
    jsonb_build_object(
      'signedName', v_request.signed_name,
      'signedVia', 'link',
      'signoffRequestId', v_request.id
    )
  )
  -- 0065: a name, time, completer or date put on the card while it was
  -- open (before 0065 the guard let them through) would read as the
  -- licensee's. Dropped here, so cards already holding one are covered. A
  -- card already signed in the app keeps its signature, as before.
  on conflict (property_id, item_key) do update
    set status = 'done',
        data = case when public.property_items.status = 'done' then public.property_items.data
                    else public.property_items.data - array['typedName', 'signedAt', 'signedBy']
               end || excluded.data,
        completed_by = case when public.property_items.status = 'done' then public.property_items.completed_by end,
        event_date = case when public.property_items.status = 'done' then public.property_items.event_date end;

  return true;
end;
$$;

-- ── 8. A b4 link can't send the file back (0062's body + item_key) ─────
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
   where token = p_token and item_key = 'sign_licensee'
     and signed_at is null and revoked_at is null and expires_at > now();
  if v_request.id is null then
    raise exception 'This link is no longer valid.';
  end if;
  return public.send_back_listing_core(v_request.agency_id, v_request.property_id, p_items, null, v_request.id);
end
$$;

-- ── 9. Who can name the licensee, or become one ────────────────────────
-- Was (0058): any member of an office with no licensee in charge, assistants
-- included, so anyone there could point the link at an inbox of their own.
-- Now the account holder (not an assistant) of such an office. Sign-up
-- still works: the founder is the account holder. The licensee in charge,
-- and the agent on their own plan, are unchanged.
create or replace function public.may_change_agency_details()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_agency_id() is not null
     and (public.acts_as_licensee()
          or (public.is_account_holder() and not public.is_assistant()
              and not exists (select 1 from public.profiles p
                               where p.agency_id = public.current_agency_id()
                                 and p.is_licensee_in_charge and p.archived_at is null)));
$$;

-- 0029's way to correct the sign-up answer. Nothing in src/ calls it (checked
-- 12 Oct 2026), and in an office with no licensee in charge it let anyone,
-- assistants included, make themselves licensee in charge and approve b4 in
-- the app. RealComply support can still change it in the database itself.
revoke execute on function public.set_licensee_in_charge(boolean) from authenticated;

create table if not exists public.licensee_contact_changes (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  old_name    text,
  new_name    text,
  old_email   text,
  new_email   text,
  -- Null when changed by RealComply itself (the database's own rights).
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);
create index if not exists licensee_contact_changes_agency_idx
  on public.licensee_contact_changes (agency_id, changed_at);
comment on table public.licensee_contact_changes is
  'Every change to the agency''s licensee name or email, and who made it (0065). Agency data; deleted with the agency. Only ids and dates go into the activity record.';
alter table public.licensee_contact_changes enable row level security;
-- Read: the licensee (or the agent on their own plan) and the account holder.
-- Write: only the trigger below.
drop policy if exists "licensee_contact_changes: licensee or account holder can view" on public.licensee_contact_changes;
create policy "licensee_contact_changes: licensee or account holder can view" on public.licensee_contact_changes
  for select using (agency_id = public.current_agency_id()
                    and (public.acts_as_licensee() or public.is_account_holder()));
revoke all on public.licensee_contact_changes from anon, authenticated;
grant select on public.licensee_contact_changes to authenticated;
grant all on public.licensee_contact_changes to service_role;

create or replace function public.log_licensee_contact_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.licensee_email is distinct from old.licensee_email
     or new.licensee_name is distinct from old.licensee_name then
    insert into public.licensee_contact_changes (agency_id, old_name, new_name, old_email, new_email, changed_by)
    values (new.id, old.licensee_name, new.licensee_name, old.licensee_email, new.licensee_email, auth.uid());
  end if;
  return new;
end
$$;
revoke execute on function public.log_licensee_contact_change() from public, anon, authenticated;
drop trigger if exists agencies_licensee_contact_log on public.agencies;
create trigger agencies_licensee_contact_log
  after update of licensee_email, licensee_name on public.agencies
  for each row execute function public.log_licensee_contact_change();

-- ── 10. The 7-year record ──────────────────────────────────────────────
-- Both builders are replaced in full, not renamed and wrapped again.
--
-- build_activity_record_core is 0054's builder under the name 0058 gave it,
-- word for word, with one change (0065): each sign-off link says what it was
-- for ('item').
create or replace function public.build_activity_record_core(p_agency_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'agency', (select jsonb_build_object(
        'id', a.id, 'created_at', a.created_at, 'plan', a.plan, 'status', a.status,
        'ended_at', a.ended_at)
      from agencies a where a.id = p_agency_id),
    'users', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'created_at', p.created_at, 'is_agent', p.is_agent,
        'is_licensee_in_charge', p.is_licensee_in_charge, 'is_assistant', p.is_assistant,
        'licence_type', p.licence_type, 'archived_at', p.archived_at) order by p.created_at)
      from profiles p where p.agency_id = p_agency_id), '[]'),
    'listings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'created_by', x.created_by, 'created_at', x.created_at, 'stage', x.stage,
        'test_mode', x.test_mode, 'sale_method', x.sale_method,
        'review_requested_at', x.review_requested_at, 'review_requested_by', x.review_requested_by,
        'attributes_confirmed_at', x.attributes_confirmed_at,
        'attributes_confirmed_by', x.attributes_confirmed_by) order by x.created_at)
      from properties x where x.agency_id = p_agency_id), '[]'),
    'checklist', coalesce((select jsonb_agg(jsonb_build_object(
        'listing', i.property_id, 'item', i.item_key, 'status', i.status,
        'event_date', i.event_date, 'recorded_at', i.recorded_at,
        'completed_by', i.completed_by, 'created_at', i.created_at,
        'had_document', i.evidence_path is not null) order by i.created_at)
      from property_items i where i.agency_id = p_agency_id), '[]'),
    'listing_transfers', coalesce((select jsonb_agg(jsonb_build_object(
        'listing', t.property_id, 'from', t.from_agent, 'to', t.to_agent,
        'by', t.moved_by, 'at', t.moved_at) order by t.moved_at)
      from property_transfers t where t.agency_id = p_agency_id), '[]'),
    'licensee_signoff_links', coalesce((select jsonb_agg(jsonb_build_object(
        'listing', r.property_id, 'item', r.item_key,
        'created_by', r.created_by, 'created_at', r.created_at,
        'ruleset_version', r.ruleset_version, 'signed_at', r.signed_at,
        'revoked_at', r.revoked_at) order by r.created_at)
      from property_signoff_requests r where r.agency_id = p_agency_id), '[]'),
    'document_signoffs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'category', d.category, 'period_month', d.period_month,
        'trust_account', d.trust_account_id, 'signer_scope', d.signer_scope,
        'uploaded_by', d.uploaded_by, 'created_at', d.created_at,
        'signed', d.signed_file_path is not null) order by d.created_at)
      from signoff_documents d where d.agency_id = p_agency_id), '[]'),
    'signatures', coalesce((select jsonb_agg(jsonb_build_object(
        'document', s.document_id, 'signer', s.signer_id, 'signed_at', s.signed_at)
        order by s.signed_at)
      from signoff_signatures s where s.agency_id = p_agency_id), '[]'),
    'gifts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'date', g.gift_date, 'direction', g.direction, 'status', g.status,
        'value', g.value, 'agent', g.profile_id, 'listing', g.property_id,
        'created_by', g.created_by, 'created_at', g.created_at) order by g.created_at)
      from gifts g where g.agency_id = p_agency_id), '[]'),
    'complaints', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'received', c.received_date, 'status', c.status,
        'resolved', c.resolved_date, 'agent', c.agent_id, 'listing', c.property_id,
        'created_by', c.created_by, 'created_at', c.created_at) order by c.created_at)
      from complaints c where c.agency_id = p_agency_id), '[]'),
    'breaches', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'identified', b.identified_date, 'category', b.category,
        'severity', b.severity, 'notifiable', b.notifiable, 'notified', b.notified_date,
        'corrective_action_date', b.corrective_action_date, 'status', b.status,
        'closed', b.closed_date, 'agent', b.agent_id, 'listing', b.property_id,
        'created_by', b.created_by, 'created_at', b.created_at) order by b.created_at)
      from breaches b where b.agency_id = p_agency_id), '[]'),
    'cpd', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'person', c.profile_id, 'category', c.category, 'hours', c.hours,
        'completed', c.completed_date, 'from_session', c.source_session_id,
        'had_document', c.evidence_path is not null,
        'created_by', c.created_by, 'created_at', c.created_at) order by c.created_at)
      from cpd_records c where c.agency_id = p_agency_id), '[]'),
    'cpd_year_signoffs', coalesce((select jsonb_agg(jsonb_build_object(
        'person', y.profile_id, 'year_start', y.cpd_year_start,
        'confirmed_by', y.confirmed_by, 'confirmed_at', y.confirmed_at) order by y.created_at)
      from cpd_year_signoffs y where y.agency_id = p_agency_id), '[]'),
    'training_sessions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'date', t.session_date, 'cpd_eligible', t.is_cpd_eligible,
        'cpd_hours', t.cpd_hours, 'external', t.is_external,
        'attended_by', (select coalesce(jsonb_agg(a.profile_id), '[]')
                          from training_attendance a where a.session_id = t.id),
        'created_by', t.created_by, 'created_at', t.created_at) order by t.created_at)
      from training_sessions t where t.agency_id = p_agency_id), '[]'),
    'training_plans', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'person', t.profile_id, 'year_start', t.cpd_year_start,
        'valid_from', t.valid_from, 'valid_to', t.valid_to,
        'consultation_date', t.consultation_date, 'required_hours', t.required_hours,
        'staff_signed_at', t.staff_signed_at, 'principal_signed_at', t.principal_signed_at,
        'items', (select coalesce(jsonb_agg(jsonb_build_object(
                    'classification', pi.classification, 'hours', pi.training_hours,
                    'due', pi.due_date, 'completed', pi.completed_date,
                    'counts_toward_cpd', pi.counts_toward_cpd)), '[]')
                  from training_plan_items pi where pi.plan_id = t.id),
        'created_by', t.created_by, 'created_at', t.created_at) order by t.created_at)
      from training_plans t where t.agency_id = p_agency_id), '[]'),
    'trust_accounts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'created_at', t.created_at, 'archived_at', t.archived_at)
        order by t.created_at)
      from trust_accounts t where t.agency_id = p_agency_id), '[]'),
    'trust_audits', coalesce((select jsonb_agg(jsonb_build_object(
        'trust_account', t.trust_account_id, 'period_end', t.period_end,
        'report_received', t.report_received_on, 'confirmed_by', t.confirmed_by,
        'confirmed_at', t.confirmed_at) order by t.created_at)
      from trust_audits t where t.agency_id = p_agency_id), '[]'),
    'licence_changes', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', h.subject_kind, 'person', h.profile_id, 'source', h.source,
        'changed_by', h.changed_by, 'changed_at', h.changed_at) order by h.changed_at)
      from licence_history h where h.agency_id = p_agency_id), '[]'),
    'reminders_sent', jsonb_build_object(
      'licence', coalesce((select jsonb_agg(jsonb_build_object(
          'kind', r.subject_kind, 'person', r.profile_id, 'expiry', r.expiry_date,
          'threshold_days', r.threshold_days, 'sent_at', r.sent_at) order by r.sent_at)
        from licence_reminders r where r.agency_id = p_agency_id), '[]'),
      'trust', coalesce((select jsonb_agg(jsonb_build_object(
          'kind', r.kind, 'period', r.period, 'stage', r.stage,
          'trust_account', r.trust_account_id, 'sent_at', r.sent_at) order by r.sent_at)
        from trust_reminders r where r.agency_id = p_agency_id), '[]')),
    'pm_properties', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'manager', p.manager_id, 'origin', p.origin, 'group', p.grp,
        'management_ended_on', p.management_ended_on,
        'created_by', p.created_by, 'created_at', p.created_at) order by p.created_at)
      from pm_properties p where p.agency_id = p_agency_id), '[]'),
    'pm_tenancies', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'property', t.property_id, 'seq', t.seq, 'before_stages', t.before_stages,
        'move_in', t.move_in_date, 'vacate', t.vacate_date, 'move_out', t.move_out_date,
        'ended_by', t.ended_by, 'created_at', t.created_at) order by t.created_at)
      from pm_tenancies t where t.agency_id = p_agency_id), '[]'),
    'pm_ticks', coalesce((select jsonb_agg(jsonb_build_object(
        'property', e.property_id, 'tenancy', e.tenancy_id, 'item', e.item_key,
        'state', e.state, 'by', e.changed_by, 'at', e.changed_at) order by e.changed_at)
      from pm_item_events e where e.agency_id = p_agency_id), '[]'),
    'pm_group_moves', coalesce((select jsonb_agg(jsonb_build_object(
        'property', m.property_id, 'tenancy', m.tenancy_id, 'from', m.from_grp,
        'to', m.to_grp, 'date', m.event_date, 'by', m.moved_by, 'at', m.moved_at)
        order by m.moved_at)
      from pm_group_moves m where m.agency_id = p_agency_id), '[]'),
    'pm_records', coalesce((select jsonb_agg(jsonb_build_object(
        'property', r.property_id, 'tenancy', r.tenancy_id, 'kind', r.kind,
        'by', r.recorded_by, 'at', r.recorded_at,
        'response_by', r.response_given_by, 'response_at', r.response_given_at)
        order by r.recorded_at)
      from pm_records r where r.agency_id = p_agency_id), '[]')
  );
$$;

-- build_activity_record is 0062's, word for word, plus (0065) who changed
-- the licensee's details and when. Never the names or addresses.
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
      from public.licensee_contact_changes c where c.agency_id = p_agency_id), '[]'));
$$;
revoke execute on function public.build_activity_record_core(uuid) from public, anon, authenticated;
revoke execute on function public.build_activity_record(uuid) from public, anon, authenticated;
grant execute on function public.build_activity_record(uuid) to service_role;

commit;

-- ── Verify. One row, all true. ──────────────────────────────────────────
select
  exists (select 1 from pg_constraint where conname = 'property_signoff_requests_kind_check')       as kind_check,
  not has_column_privilege('authenticated', 'public.property_signoff_requests', 'token', 'SELECT')    as token_still_hidden,
  position('new.token := gen_random_uuid()' in
           pg_get_functiondef('public.guard_signoff_request_insert()'::regprocedure)) > 0             as token_still_forced,
  has_function_privilege('anon', 'public.get_signoff_request_v3(uuid)', 'execute')                   as v3_public,
  not has_function_privilege('authenticated', 'public.set_licensee_in_charge(boolean)', 'execute')   as no_self_promotion,
  exists (select 1 from pg_trigger where tgname = 'property_signoff_requests_update_guard')          as update_guard,
  exists (select 1 from pg_trigger where tgname = 'agencies_licensee_contact_log')                  as contact_log,
  position('''b4''' in pg_get_functiondef('public.submit_signoff(uuid, text)'::regprocedure)) > 0    as submit_knows_b4,
  position('sign_licensee' in pg_get_functiondef('public.send_back_by_token(uuid, jsonb)'::regprocedure)) > 0 as send_back_final_only,
  position('sign_licensee' in pg_get_functiondef('public.get_signoff_request(uuid)'::regprocedure)) > 0
    and position('sign_licensee' in pg_get_functiondef('public.get_signoff_request_v2(uuid)'::regprocedure)) > 0 as v1_v2_final_only,
  position('new.completed_by := null' in pg_get_functiondef('public.guard_listing_signoff()'::regprocedure)) > 0
    and position('event_date = case' in pg_get_functiondef('public.submit_signoff(uuid, text)'::regprocedure)) > 0 as open_card_fields_dropped,
  position('attach a file to this card' in pg_get_functiondef('public.guard_listing_signoff()'::regprocedure)) > 0
    and position('new.recorded_at := old.recorded_at' in pg_get_functiondef('public.guard_listing_signoff()'::regprocedure)) > 0 as sign_cards_guarded,
  position('p.email' in pg_get_functiondef('public.licensee_email_is_a_member()'::regprocedure)) = 0 as member_login_only,
  position('''item'', r.item_key' in
           pg_get_functiondef('public.build_activity_record_core(uuid)'::regprocedure)) > 0          as record_says_what_for;
