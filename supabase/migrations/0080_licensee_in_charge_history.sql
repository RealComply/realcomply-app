-- ===== RUN THIS ONE. Migration 0080, licensee in charge history, 16 October 2026 =====
--
-- Mockup approved by Adam, 16 Oct 2026. Office profile shows the licensee in
-- charge (s31(3)): who, their licence, since when, and when Fair Trading was
-- told, with a history that is kept forever. The licensee in charge can hand
-- the role to a team member with a class 1 licence on file, and everything
-- the role has in RealComply goes with it.
--
-- REVERSAL (Adam, 16 Oct 2026). Was (Adam, 23 Aug 2026): "rather than us
-- policing it, all we'll do is have a pop up screen with that clause...";
-- RealComply did not record whether Fair Trading was told. Now the date is
-- recorded, and the new licensee in charge is reminded until it is.
--
-- What this file does:
--
--   1. licensee_in_charge_history: one line per licensee in charge of an
--      office. Who (their name and licence as they stood), from, to, the date
--      Fair Trading was told, and who recorded each and when. Nobody can add,
--      change or delete a line directly. Lines are written by the database
--      (2 and 4 below); a blank start date or Fair Trading date can be filled
--      in once, through record_licensee_history_date(), stamped by the
--      database with who and when.
--   2. A trigger on profiles records every time someone becomes or stops
--      being licensee in charge of an office, however it happens, so the
--      history can't be bypassed.
--   3. Existing offices get one line for today's licensee in charge, with
--      the start date and Fair Trading date blank to fill in. No reminder for
--      these lines.
--   4. change_licensee_in_charge(): the current licensee in charge hands the
--      role to a team member with a class 1 licence on file. In one go:
--        - the new licensee in charge takes the role; the previous one stays
--          on the team as an agent;
--        - the office's licensee name and email become the new licensee's,
--          so emailed sign-off links go to them;
--        - emailed sign-off links still out with the previous licensee are
--          withdrawn, and unused annexure links expire;
--        - licensee-only documents waiting on the previous licensee's
--          signature wait on the new one instead.
--   5. Billing follows the role: once an office has changed its licensee in
--      charge, the person who set the office up is no longer the account
--      holder for that reason alone (is_account_holder, 0059).
--   6. The new licensee in charge adopts the annexure themselves (Adam, 16
--      Oct 2026). Until they do, no new listing can be added; existing
--      listings carry on. The earlier adoption stays on file. Same wording
--      and refusal as job 7's lock (PR #47), and works whether or not that
--      has run.
--   7. Office plans only. Nothing here applies to an agent on their own plan.
--
-- Not here: emails about the change, and anything in Stripe.
--
-- Nothing existing is deleted except unsigned licensee-only signature slots
-- that move to the new licensee. Safe to run more than once. One transaction.
--
-- Tests: supabase/tests/licensee_in_charge_history.sql.

begin;

-- ── 0. Order ────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.adopt_sg_annexure(uuid, text, text, text, text)') is null
     or to_regprocedure('public.is_account_holder()') is null
     or to_regprocedure('public.guard_last_licensee()') is null
     or to_regprocedure('public.guard_agency_not_ended()') is null
     or to_regclass('public.property_signoff_requests') is null then
    raise exception 'Run 0070 before this one. Nothing was changed.';
  end if;
end $$;

-- Today's date in NSW, for "since" and "to" dates the database fills itself.
create or replace function public.sydney_today()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'Australia/Sydney')::date;
$$;
revoke execute on function public.sydney_today() from public, anon;
grant execute on function public.sydney_today() to authenticated;

-- ── 1. The history ──────────────────────────────────────────────────────
create table if not exists public.licensee_in_charge_history (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  -- The licensee as they stood when the line was written.
  licensee_name text not null,
  licence_type text,
  licence_number text,
  -- How the line came about. 'backfill': this migration, for the licensee in
  -- charge on the day it ran. 'first': an office's first licensee in charge.
  -- 'change': Change licensee in charge in Office profile. 'team': the role
  -- given some other way (Team, an invite).
  source text not null check (source in ('backfill', 'first', 'change', 'team')),
  started_on date,
  ended_on date,
  -- When the database closed the line, and who made the change that did.
  ended_at timestamptz,
  ended_by uuid references public.profiles(id) on delete set null,
  fair_trading_told_on date,
  recorded_by uuid references public.profiles(id) on delete set null,
  -- The clock, not the transaction's start, so lines written together keep
  -- their order.
  recorded_at timestamptz not null default clock_timestamp(),
  -- A blank date filled in later: who and when, stamped by the database.
  started_on_recorded_by uuid references public.profiles(id) on delete set null,
  started_on_recorded_at timestamptz,
  fair_trading_recorded_by uuid references public.profiles(id) on delete set null,
  fair_trading_recorded_at timestamptz,
  constraint licensee_history_dates_in_order check (ended_on is null or started_on is null or ended_on >= started_on),
  constraint licensee_history_ended_together check ((ended_at is null) = (ended_on is null))
);

create index if not exists licensee_history_agency_idx on public.licensee_in_charge_history (agency_id, recorded_at);
-- One open line per person per office.
create unique index if not exists licensee_history_one_open_line
  on public.licensee_in_charge_history (agency_id, profile_id) where ended_at is null;

alter table public.licensee_in_charge_history enable row level security;

-- Everyone in an office may see who their licensee in charge is and has been.
drop policy if exists "licensee history: office members can view" on public.licensee_in_charge_history;
create policy "licensee history: office members can view" on public.licensee_in_charge_history
  for select using (agency_id = public.current_agency_id());

-- No insert, update or delete policy, on purpose. Lines are written only by
-- the database (the trigger and functions below), so the history is exactly
-- what happened: nobody can leave a change out, add one that didn't happen,
-- or delete one.

-- Explicit grants. From 30 Oct 2026 Supabase stops granting new public tables
-- to the Data API automatically (RealComply-supabase-data-api-grants-30-Oct.md).
-- Authenticated may read, never write. Nothing here is for anon.
revoke all on table public.licensee_in_charge_history from public, anon;
revoke insert, update, delete on table public.licensee_in_charge_history from authenticated;
grant select on public.licensee_in_charge_history to authenticated;
grant select, insert, update, delete on public.licensee_in_charge_history to service_role;

comment on table public.licensee_in_charge_history is
  'Every licensee in charge of an office (s31(3)): from, to, when Fair Trading was told, and who recorded each and when. Written only by the database; a blank date can be filled in once. Office plans only (0080).';

-- What can change on a line, whoever asks: a blank start or Fair Trading
-- date filled in once, and the line closed once. The rest is as written. A
-- person's account removed clears their id and nothing else. Who and when
-- are the database's.
create or replace function public.guard_licensee_history()
returns trigger
language plpgsql
security invoker
set search_path = public
as $f$
begin
  if tg_op = 'INSERT' then
    new.recorded_at := clock_timestamp();
    new.recorded_by := auth.uid();
    if new.ended_on is not null then
      new.ended_at := clock_timestamp();
      new.ended_by := auth.uid();
    else
      new.ended_at := null;
      new.ended_by := null;
    end if;
    new.started_on_recorded_by := null;
    new.started_on_recorded_at := null;
    new.fair_trading_recorded_by := null;
    new.fair_trading_recorded_at := null;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.agency_id is distinct from old.agency_id
     or new.licensee_name is distinct from old.licensee_name
     or new.licence_type is distinct from old.licence_type
     or new.licence_number is distinct from old.licence_number
     or new.source is distinct from old.source
     or new.recorded_at is distinct from old.recorded_at
     or (new.profile_id is distinct from old.profile_id and new.profile_id is not null)
     or (new.recorded_by is distinct from old.recorded_by and new.recorded_by is not null)
     or (new.ended_by is distinct from old.ended_by and new.ended_by is not null and old.ended_at is not null) then
    raise exception 'This line of the licensee in charge history can''t be changed.';
  end if;

  if new.started_on is distinct from old.started_on then
    if old.started_on is not null then
      raise exception 'The start date is already recorded and can''t be changed.';
    end if;
    new.started_on_recorded_by := auth.uid();
    new.started_on_recorded_at := clock_timestamp();
  elsif (new.started_on_recorded_at is distinct from old.started_on_recorded_at)
     or (new.started_on_recorded_by is distinct from old.started_on_recorded_by and new.started_on_recorded_by is not null) then
    raise exception 'This line of the licensee in charge history can''t be changed.';
  end if;

  if new.fair_trading_told_on is distinct from old.fair_trading_told_on then
    if old.fair_trading_told_on is not null then
      raise exception 'The date Fair Trading was told is already recorded and can''t be changed.';
    end if;
    new.fair_trading_recorded_by := auth.uid();
    new.fair_trading_recorded_at := clock_timestamp();
  elsif (new.fair_trading_recorded_at is distinct from old.fair_trading_recorded_at)
     or (new.fair_trading_recorded_by is distinct from old.fair_trading_recorded_by and new.fair_trading_recorded_by is not null) then
    raise exception 'This line of the licensee in charge history can''t be changed.';
  end if;

  if new.ended_on is distinct from old.ended_on or new.ended_at is distinct from old.ended_at then
    if old.ended_at is not null then
      raise exception 'This licensee in charge''s time has already ended and can''t be changed.';
    end if;
    if new.ended_on is null then
      raise exception 'This change is not allowed.';
    end if;
    new.ended_at := clock_timestamp();
    new.ended_by := auth.uid();
  end if;
  return new;
end
$f$;
revoke execute on function public.guard_licensee_history() from public, anon, authenticated;
drop trigger if exists licensee_history_guard on public.licensee_in_charge_history;
create trigger licensee_history_guard
  before insert or update on public.licensee_in_charge_history
  for each row execute function public.guard_licensee_history();

-- ── 2. Every time someone becomes or stops being licensee in charge ─────
-- Whatever the route: Change licensee in charge, Team, an invite, archiving.
-- Change licensee in charge passes its dates in realcomply.licensee_change;
-- any other route is dated today (NSW).
create or replace function public.log_licensee_in_charge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_was boolean;
  v_is boolean;
  v_ctx jsonb := nullif(current_setting('realcomply.licensee_change', true), '')::jsonb;
  v_today date := public.sydney_today();
  v_source text;
  v_start date;
  v_ft date;
  v_end date;
begin
  select a.plan into v_plan from public.agencies a where a.id = new.agency_id;
  if left(coalesce(v_plan, ''), 6) = 'agent_' then
    return null;
  end if;
  v_was := tg_op = 'UPDATE' and old.is_licensee_in_charge and old.archived_at is null;
  v_is := coalesce(new.is_licensee_in_charge, false) and new.archived_at is null;
  if v_was = v_is then
    return null;
  end if;

  if v_is then
    if exists (select 1 from public.licensee_in_charge_history h
                where h.agency_id = new.agency_id and h.profile_id = new.id and h.ended_at is null) then
      return null;
    end if;
    if v_ctx is not null and v_ctx ->> 'new_profile' = new.id::text then
      v_source := 'change';
      v_start := (v_ctx ->> 'took_effect')::date;
      v_ft := nullif(v_ctx ->> 'fair_trading', '')::date;
    elsif exists (select 1 from public.licensee_in_charge_history h where h.agency_id = new.agency_id) then
      v_source := 'team';
      v_start := v_today;
    else
      -- An office's first licensee in charge, at sign-up: since when isn't
      -- known here, so it's left blank to fill in, like the backfill.
      v_source := 'first';
      v_start := null;
    end if;
    insert into public.licensee_in_charge_history
      (agency_id, profile_id, licensee_name, licence_type, licence_number, source, started_on, fair_trading_told_on)
    values
      (new.agency_id, new.id, coalesce(nullif(btrim(new.full_name), ''), new.email, 'Licensee in charge'),
       new.licence_type, nullif(btrim(new.licence_number), ''), v_source, v_start, v_ft);
  else
    if v_ctx is not null and v_ctx ->> 'old_profile' = new.id::text then
      v_end := (v_ctx ->> 'took_effect')::date - 1;
    else
      v_end := v_today - 1;
    end if;
    update public.licensee_in_charge_history h
       set ended_on = greatest(v_end, h.started_on)
     where h.agency_id = new.agency_id and h.profile_id = new.id and h.ended_at is null;
  end if;
  return null;
end
$$;
revoke execute on function public.log_licensee_in_charge() from public, anon, authenticated;

drop trigger if exists profiles_log_licensee_in_charge on public.profiles;
create trigger profiles_log_licensee_in_charge
  after insert or update of is_licensee_in_charge, archived_at on public.profiles
  for each row execute function public.log_licensee_in_charge();

-- ── 3. Existing offices: today's licensee in charge, dates blank ────────
insert into public.licensee_in_charge_history
  (agency_id, profile_id, licensee_name, licence_type, licence_number, source)
select p.agency_id, p.id, coalesce(nullif(btrim(p.full_name), ''), p.email, 'Licensee in charge'),
       p.licence_type, nullif(btrim(p.licence_number), ''), 'backfill'
  from public.profiles p
  join public.agencies a on a.id = p.agency_id
 where p.is_licensee_in_charge
   and p.archived_at is null
   and left(coalesce(a.plan, ''), 6) <> 'agent_'
   and not exists (select 1 from public.licensee_in_charge_history h
                    where h.agency_id = p.agency_id and h.profile_id = p.id and h.ended_at is null);

-- ── 4. Changing the licensee in charge ──────────────────────────────────
create or replace function public.change_licensee_in_charge(
  p_new_licensee uuid,
  p_took_effect date,
  p_fair_trading_told date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me public.profiles;
  v_new public.profiles;
  v_plan text;
  v_today date := public.sydney_today();
  v_mine public.licensee_in_charge_history;
  v_links integer := 0;
  v_annexure_links integer := 0;
  v_documents integer := 0;
  v_history uuid;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null or not coalesce(v_me.is_licensee_in_charge, false) or v_me.archived_at is not null then
    raise exception 'Only the licensee in charge can change the licensee in charge.';
  end if;
  select a.plan into v_plan from public.agencies a where a.id = v_me.agency_id;
  if left(coalesce(v_plan, ''), 6) = 'agent_' then
    raise exception 'Changing the licensee in charge is for offices.';
  end if;

  select * into v_new from public.profiles where id = p_new_licensee and agency_id = v_me.agency_id;
  if v_new.id is null or v_new.archived_at is not null then
    raise exception 'Choose someone on your team.';
  end if;
  if v_new.id = v_me.id then
    raise exception 'You are already the licensee in charge.';
  end if;
  if coalesce(v_new.is_assistant, false) then
    raise exception 'An assistant agent can''t be licensee in charge. Make them an agent on Team first.';
  end if;
  if v_new.licence_type is distinct from 'class_1' or nullif(btrim(v_new.licence_number), '') is null then
    raise exception 'Only someone with a class 1 licence on file can be licensee in charge.';
  end if;

  if p_took_effect is null then
    raise exception 'Enter the date the change took effect.';
  end if;
  if p_took_effect > v_today then
    raise exception 'The date the change took effect can''t be in the future.';
  end if;
  select * into v_mine from public.licensee_in_charge_history h
   where h.agency_id = v_me.agency_id and h.profile_id = v_me.id and h.ended_at is null
   order by h.recorded_at desc limit 1;
  if v_mine.started_on is not null and p_took_effect <= v_mine.started_on then
    raise exception 'The change has to take effect after you became licensee in charge on %.',
      to_char(v_mine.started_on, 'FMDD FMMonth YYYY');
  end if;
  if p_fair_trading_told is not null
     and (p_fair_trading_told > v_today or p_fair_trading_told < p_took_effect - 30) then
    raise exception 'Check the date Fair Trading was told: it can''t be in the future or long before the change.';
  end if;

  perform set_config('realcomply.licensee_change', jsonb_build_object(
    'new_profile', v_new.id, 'old_profile', v_me.id,
    'took_effect', p_took_effect, 'fair_trading', p_fair_trading_told)::text, true);

  if coalesce(v_new.is_licensee_in_charge, false) then
    -- Already a licensee in charge alongside the caller: their time so far
    -- ends, and their time as the office's licensee in charge starts now.
    update public.licensee_in_charge_history h
       set ended_on = greatest(p_took_effect - 1, h.started_on)
     where h.agency_id = v_me.agency_id and h.profile_id = v_new.id and h.ended_at is null;
    insert into public.licensee_in_charge_history
      (agency_id, profile_id, licensee_name, licence_type, licence_number, source, started_on, fair_trading_told_on)
    values
      (v_me.agency_id, v_new.id, coalesce(nullif(btrim(v_new.full_name), ''), v_new.email),
       v_new.licence_type, nullif(btrim(v_new.licence_number), ''), 'change', p_took_effect, p_fair_trading_told);
  else
    -- First the new licensee, then the caller steps down: an office always
    -- has a licensee in charge (0035).
    update public.profiles set is_licensee_in_charge = true, is_agent = true where id = v_new.id;
  end if;
  update public.profiles set is_licensee_in_charge = false, is_agent = true where id = v_me.id;

  perform set_config('realcomply.licensee_change', '', true);

  select h.id into v_history from public.licensee_in_charge_history h
   where h.agency_id = v_me.agency_id and h.profile_id = v_new.id and h.ended_at is null;

  -- The office's licensee details are the new licensee's, so the final
  -- sign-off links go to them. Logged in licensee_contact_changes (0066).
  update public.agencies
     set licensee_name = coalesce(nullif(btrim(v_new.full_name), ''), licensee_name),
         licensee_email = coalesce(nullif(lower(btrim(v_new.email)), ''), licensee_email)
   where id = v_me.agency_id;

  -- Emailed sign-off links still out with the previous licensee: withdrawn,
  -- so only the new licensee can sign from here. The agent issues them again.
  update public.property_signoff_requests r
     set revoked_at = now()
   where r.agency_id = v_me.agency_id and r.signed_at is null and r.revoked_at is null;
  get diagnostics v_links = row_count;

  -- Annexure links not yet used: they went to the previous licensee.
  update public.sg_annexure_links l
     set expires_at = now()
   where l.agency_id = v_me.agency_id and l.used_at is null and l.expires_at > now();
  get diagnostics v_annexure_links = row_count;

  -- Licensee-only documents waiting on the previous licensee wait on the new
  -- one instead. A slot the new licensee already has is kept; the previous
  -- licensee's unsigned slot on that document goes.
  update public.signoff_signatures s
     set signer_id = v_new.id
    from public.signoff_documents d
   where d.id = s.document_id
     and d.agency_id = v_me.agency_id
     and d.signer_scope = 'licensee_only'
     and s.signer_id = v_me.id
     and s.signed_at is null
     and not exists (select 1 from public.signoff_signatures s2
                      where s2.document_id = s.document_id and s2.signer_id = v_new.id);
  get diagnostics v_documents = row_count;
  delete from public.signoff_signatures s
   using public.signoff_documents d
   where d.id = s.document_id
     and d.agency_id = v_me.agency_id
     and d.signer_scope = 'licensee_only'
     and s.signer_id = v_me.id
     and s.signed_at is null;

  return jsonb_build_object(
    'history_id', v_history,
    'links_withdrawn', v_links,
    'annexure_links_expired', v_annexure_links,
    'documents_moved', v_documents);
end
$$;
revoke execute on function public.change_licensee_in_charge(uuid, date, date) from public, anon;
grant execute on function public.change_licensee_in_charge(uuid, date, date) to authenticated;

-- Filling in a blank date on a line: its start date, or when Fair Trading
-- was told. The licensee in charge of the office, once per date.
create or replace function public.record_licensee_history_date(p_line uuid, p_which text, p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.licensee_in_charge_history;
  v_today date := public.sydney_today();
begin
  if not public.is_office_licensee() then
    raise exception 'Only the licensee in charge can record this.';
  end if;
  select * into v_line from public.licensee_in_charge_history
   where id = p_line and agency_id = public.current_agency_id();
  if v_line.id is null then
    raise exception 'That line isn''t in your office''s history.';
  end if;
  if p_date is null then
    raise exception 'Enter the date.';
  end if;
  if p_date > v_today then
    raise exception 'The date can''t be in the future.';
  end if;
  if p_which = 'started' then
    if v_line.started_on is not null then
      raise exception 'The start date is already recorded and can''t be changed.';
    end if;
    if v_line.ended_on is not null and p_date > v_line.ended_on then
      raise exception 'The start date can''t be after their time ended on %.', to_char(v_line.ended_on, 'FMDD FMMonth YYYY');
    end if;
    update public.licensee_in_charge_history set started_on = p_date where id = v_line.id;
  elsif p_which = 'fair_trading' then
    if v_line.fair_trading_told_on is not null then
      raise exception 'The date Fair Trading was told is already recorded and can''t be changed.';
    end if;
    if v_line.started_on is not null and p_date < v_line.started_on - 30 then
      raise exception 'Check the date: it''s long before they became licensee in charge.';
    end if;
    update public.licensee_in_charge_history set fair_trading_told_on = p_date where id = v_line.id;
  else
    raise exception 'Unknown date.';
  end if;
end
$$;
revoke execute on function public.record_licensee_history_date(uuid, text, date) from public, anon;
grant execute on function public.record_licensee_history_date(uuid, text, date) to authenticated;

-- ── 5. Billing follows the role ─────────────────────────────────────────
-- 0059's rule (the person who set the office up), word for word, until the
-- office's licensee in charge has changed. From then on Billing is the
-- licensee in charge's (acts_as_licensee), and nobody else's.
create or replace function public.is_account_holder()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles me
     where me.id = auth.uid()
       and me.id = (select p.id
                      from public.profiles p
                     where p.agency_id = me.agency_id
                     order by p.created_at asc
                     limit 1)
       and not exists (select 1 from public.licensee_in_charge_history h
                        where h.agency_id = me.agency_id and h.source in ('change', 'team'))
  );
$$;
revoke execute on function public.is_account_holder() from public, anon;
grant execute on function public.is_account_holder() to authenticated;

-- ── 6. The new licensee in charge adopts the annexure ───────────────────
-- From when an adoption counts: the moment the current licensee in charge's
-- line was recorded, if they took over (change or team). Null when the
-- office's licensee in charge has never changed: any adoption counts.
create or replace function public.licensee_annexure_since(p_agency uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(h.recorded_at)
    from public.licensee_in_charge_history h
    join public.agencies a on a.id = h.agency_id
   where h.agency_id = p_agency
     and h.source in ('change', 'team')
     and h.ended_at is null
     and left(coalesce(a.plan, ''), 6) <> 'agent_';
$$;
revoke execute on function public.licensee_annexure_since(uuid) from public, anon, authenticated;

-- True while a new licensee in charge hasn't adopted the annexure since they
-- took over.
create or replace function public.licensee_annexure_pending(p_agency uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select s.since is not null
         and not exists (select 1 from public.sg_annexure_adoptions ad
                          where ad.agency_id = p_agency and ad.signed_at >= s.since)
    from (select public.licensee_annexure_since(p_agency) as since) s;
$$;
revoke execute on function public.licensee_annexure_pending(uuid) from public, anon, authenticated;

-- For the app: whether the signed-in person's office is waiting on its new
-- licensee in charge, who that is, and who adopted the annexure before.
create or replace function public.my_licensee_change_status()
returns table (annexure_pending boolean, licensee_name text, previous_adopter text)
language sql
stable
security definer
set search_path = public
as $$
  select public.licensee_annexure_pending(public.current_agency_id()),
         (select h.licensee_name from public.licensee_in_charge_history h
           where h.agency_id = public.current_agency_id() and h.ended_at is null
           order by h.recorded_at desc limit 1),
         (select ad.signed_name from public.sg_annexure_adoptions ad
           where ad.agency_id = public.current_agency_id()
           order by ad.signed_at desc limit 1);
$$;
revoke execute on function public.my_licensee_change_status() from public, anon;
grant execute on function public.my_licensee_change_status() to authenticated;

-- An office could adopt each version once (0067). Now once per licensee in
-- charge: the earlier adoption stays on file beside the new one.
alter table public.sg_annexure_adoptions drop constraint if exists sg_annexure_adoptions_once;

-- The signing page: 0070's function word for word, except that only an
-- adoption since the current licensee in charge took over counts.
create or replace function public.sg_annexure_link_details(p_token uuid, p_version text)
returns table (
  agency_id uuid,
  agency_name text,
  licence_number text,
  logo_path text,
  sent_to text,
  state text,
  adopted_at timestamptz,
  licensed_entity_name text
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
         ad.signed_at,
         a.licensed_entity_name
    from public.sg_annexure_links l
    join public.agencies a on a.id = l.agency_id
    left join lateral (
      select x.id, x.signed_at
        from public.sg_annexure_adoptions x
       where x.agency_id = l.agency_id
         and x.annexure_version = p_version
         and x.signed_at >= coalesce(public.licensee_annexure_since(l.agency_id), '-infinity'::timestamptz)
       order by x.signed_at desc
       limit 1
    ) ad on true
   where l.token = p_token;
$$;
revoke execute on function public.sg_annexure_link_details(uuid, text) from public;
grant execute on function public.sg_annexure_link_details(uuid, text) to anon, authenticated;

-- Adopting: 0070's function word for word, except that "already adopted"
-- means since the current licensee in charge took over.
create or replace function public.adopt_sg_annexure(
  p_token uuid,
  p_version text,
  p_signed_name text,
  p_licence_number text,
  p_licensed_entity_name text
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
  v_entity text := nullif(regexp_replace(btrim(coalesce(p_licensed_entity_name, '')), '\s+', ' ', 'g'), '');
  v_agency public.agencies;
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
  if length(v_entity) > 200 then
    raise exception 'The licensed entity name is too long.';
  end if;

  select * into v_link from public.sg_annexure_links where token = p_token for update;
  if not found or v_link.used_at is not null or v_link.expires_at <= now() then
    raise exception 'This link is no longer valid.';
  end if;
  if exists (select 1 from public.sg_annexure_adoptions
              where agency_id = v_link.agency_id and annexure_version = p_version
                and signed_at >= coalesce(public.licensee_annexure_since(v_link.agency_id), '-infinity'::timestamptz)) then
    raise exception 'This annexure has already been adopted.';
  end if;

  if p_licensed_entity_name is not null then
    perform set_config('realcomply.name_change_via', 'signing_page', true);
    perform set_config('realcomply.name_change_by_name', v_name, true);
    update public.agencies
       set licensed_entity_name = v_entity,
           licensed_entity_name_source = case when v_entity is null then null else 'typed' end
     where id = v_link.agency_id
       and licensed_entity_name is distinct from v_entity;
    perform set_config('realcomply.name_change_via', '', true);
    perform set_config('realcomply.name_change_by_name', '', true);
  end if;

  select * into v_agency from public.agencies where id = v_link.agency_id;

  insert into public.sg_annexure_adoptions
    (agency_id, annexure_version, signed_name, licence_number, sent_to, trading_name, licensed_entity_name)
  values (v_link.agency_id, p_version, v_name, v_licence, v_link.sent_to, v_agency.name, v_agency.licensed_entity_name)
  returning id into v_id;
  update public.sg_annexure_links set used_at = now() where id = v_link.id;
  return v_id;
end
$$;
revoke execute on function public.adopt_sg_annexure(uuid, text, text, text, text) from public;
grant execute on function public.adopt_sg_annexure(uuid, text, text, text, text) to anon, authenticated;

-- The lock: no new listing while the new licensee in charge hasn't adopted
-- the annexure. Existing listings carry on. Same wording as job 7's lock.
create or replace function public.guard_listing_new_licensee_annexure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Empty for the SQL editor, 'service_role' for the service key.
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
begin
  if v_role in ('', 'service_role') then
    return new;
  end if;
  if public.licensee_annexure_pending(new.agency_id) then
    raise exception 'New listings can be added once your licensee in charge has adopted RealComply''s annexure.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke execute on function public.guard_listing_new_licensee_annexure() from public, anon, authenticated;

drop trigger if exists properties_new_licensee_annexure on public.properties;
create trigger properties_new_licensee_annexure
  before insert on public.properties
  for each row execute function public.guard_listing_new_licensee_annexure();

-- ── 7. An ended subscription can't change it (0054) ─────────────────────
do $$
begin
  drop trigger if exists licensee_history_not_ended_guard on public.licensee_in_charge_history;
  create trigger licensee_history_not_ended_guard
    before insert or update or delete on public.licensee_in_charge_history
    for each row execute function public.guard_agency_not_ended();
end $$;

commit;

-- ── Verify. Expected: 1 table, 1 policy, 2 triggers on it, backfill lines for
-- each office's licensee, the profiles trigger, authenticated can read only ──
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'licensee_in_charge_history')            as tables_expect_1,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'licensee_in_charge_history')               as policies_expect_1,
  (select count(*) from pg_trigger
    where tgrelid = 'public.licensee_in_charge_history'::regclass and not tgisinternal)      as triggers_expect_2,
  (select count(*) from public.licensee_in_charge_history where source = 'backfill')         as backfill_lines,
  (select count(*) from (select agency_id from public.licensee_in_charge_history
                          where ended_at is null group by agency_id having count(*) > 1) x)  as offices_with_two_licensees,
  exists (select 1 from pg_trigger where tgname = 'profiles_log_licensee_in_charge')         as profiles_trigger,
  has_table_privilege('authenticated', 'public.licensee_in_charge_history', 'select')
    and not has_table_privilege('authenticated', 'public.licensee_in_charge_history', 'insert')
    and not has_table_privilege('authenticated', 'public.licensee_in_charge_history', 'update')
    and not has_table_privilege('authenticated', 'public.licensee_in_charge_history', 'delete') as read_only_expect_true;
