-- ===== 0112: The licensee email confirms first =====
--
-- Master, 4 Nov 2026 (Adam's decision: the onus stays with the office; no
-- manual check by Adam). Legal's privacy check of office manager access
-- (3 Nov) found that the licensee email on the Office profile is typed by
-- the office and nothing checks it is the licensee's. Approval, invite and
-- sign-off links go to it, so whoever typed it could point them at an inbox
-- of their own.
--
-- NOW
--   1. Confirm first. The first email to a licensee address only asks
--      "Confirm you're the licensee in charge at [office]", one button, no
--      records. Until the address confirms, no approval, invite or sign-off
--      link goes to it: the database refuses to make one. Changing the
--      licensee email starts it again, and links already out to the old
--      address stop working.
--   2. An address that is the login of the office's licensee in charge
--      needs no confirming: signing up already proved that inbox.
--   3. Every link sent to the licensee shows on the Office profile: "last
--      sent to [address] on [date]" (licensee_link_sends()).
--   4. Existing offices: each current licensee address that isn't a
--      licensee's login gets the confirm email once, from the daily job
--      (pending_licensee_confirmations()), then carries on as normal after
--      the click.
--
-- WHICH LINKS (as they are on main, 4 Nov 2026)
--   * The file sign-off link (property_signoff_requests, 0014/0104).
--   * The office manager approval request (office_manager_requests, 0093),
--     checked when it is made and again when it is approved.
--   * The licensee in charge invite (agency_invites, 0095). RealComply
--     doesn't email it, but it is made for that address, so it waits too.
--   * The SG annexure link for a new office (sg_annexure_links 'new_office',
--     0067), made by the server: it waits for the click and goes after it.
--
-- One new table, with its grants. Safe to run twice.

begin;

-- Order check.
do $$
begin
  if to_regclass('public.office_manager_requests') is null
     or to_regclass('public.sg_annexure_links') is null
     or to_regprocedure('public.guard_agency_invite_roles()') is null then
    raise exception 'Run 0093, 0095 and 0107 before this one. Nothing was changed.';
  end if;
end $$;

-- ── 1. Confirmations ─────────────────────────────────────────────────────
create table if not exists public.licensee_email_confirmations (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references public.agencies (id) on delete cascade,
  -- Lower case, trimmed: the licensee email as it was when this was made.
  email           text not null check (email = lower(btrim(email)) and email <> ''),
  -- The confirm link's credential. Never readable by anyone signed in.
  token           uuid not null default gen_random_uuid() unique,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  last_sent_at    timestamptz,
  send_count      integer not null default 0,
  last_send_error text,
  confirmed_at    timestamptz,
  confirmed_ip    text check (confirmed_ip is null or char_length(confirmed_ip) <= 100),
  -- Set when the office's licensee email changes away from this address.
  superseded_at   timestamptz
);
comment on table public.licensee_email_confirmations is
  'Whether the licensee email on the Office profile confirmed it belongs to the licensee in charge (0112, Master 4 Nov 2026). One current row per office and address; superseded when the address changes.';
create unique index if not exists licensee_email_confirmations_one_current
  on public.licensee_email_confirmations (agency_id, email) where superseded_at is null;
create index if not exists licensee_email_confirmations_agency_idx
  on public.licensee_email_confirmations (agency_id, created_at);

alter table public.licensee_email_confirmations enable row level security;
drop policy if exists "licensee_email_confirmations: the office can view" on public.licensee_email_confirmations;
create policy "licensee_email_confirmations: the office can view" on public.licensee_email_confirmations
  for select to authenticated
  using (agency_id = public.current_agency_id());

revoke all on table public.licensee_email_confirmations from public, anon, authenticated;
grant select (id, agency_id, email, created_by, created_at, last_sent_at, send_count, last_send_error,
              confirmed_at, superseded_at)
  on public.licensee_email_confirmations to authenticated;
grant select, insert, update, delete on public.licensee_email_confirmations to service_role;

-- ── 2. Is this address all right to send a link to? ─────────────────────
-- Yes when it is the login of the office's licensee in charge (the login,
-- never the profile's email, which a member can type), or when it is the
-- office's licensee email now and has confirmed.
create or replace function public.licensee_address_ok(p_agency uuid, p_address text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select nullif(lower(btrim(coalesce(p_address, ''))), '') is not null
     and (
       exists (select 1
                 from public.profiles p
                 join auth.users u on u.id = p.id
                where p.agency_id = p_agency and p.is_licensee_in_charge and p.archived_at is null
                  and lower(btrim(u.email)) = lower(btrim(p_address)))
       or exists (select 1
                    from public.agencies a
                    join public.licensee_email_confirmations c
                      on c.agency_id = a.id and c.email = lower(btrim(a.licensee_email))
                   where a.id = p_agency
                     and lower(btrim(a.licensee_email)) = lower(btrim(p_address))
                     and c.confirmed_at is not null and c.superseded_at is null));
$$;

-- The office's licensee email, as the Office profile shows it.
create or replace function public.licensee_email_confirmed(p_agency uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.licensee_address_ok(p_agency, (select a.licensee_email from public.agencies a where a.id = p_agency));
$$;

-- The words used wherever a link is refused for this reason.
create or replace function public.licensee_confirm_first_message(p_agency uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select format('Waiting for %s to confirm they''re the licensee in charge. You can send the confirmation again from Office profile.',
                coalesce(nullif(lower(btrim(a.licensee_email)), ''), 'your licensee'))
    from public.agencies a where a.id = p_agency;
$$;

revoke execute on function public.licensee_address_ok(uuid, text) from public, anon;
revoke execute on function public.licensee_email_confirmed(uuid) from public, anon;
revoke execute on function public.licensee_confirm_first_message(uuid) from public, anon;
grant execute on function public.licensee_address_ok(uuid, text) to authenticated, service_role;
grant execute on function public.licensee_email_confirmed(uuid) to authenticated, service_role;
grant execute on function public.licensee_confirm_first_message(uuid) to authenticated, service_role;

-- ── 3. Asking, sending, confirming ──────────────────────────────────────
-- Anyone in the office asks (Office profile, "Send again"). Returns the
-- current row for the licensee email, made if needed, or null when there is
-- nothing to confirm (no email, or it is the licensee's own login, or it has
-- confirmed). Refused within 5 minutes of the last send. The app reads the
-- token with the service key to send it; the person asking never sees it.
create or replace function public.request_licensee_confirmation()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me public.profiles;
  v_agency public.agencies;
  v_email text;
  v_row public.licensee_email_confirmations;
begin
  select * into v_me from public.profiles where id = auth.uid() and archived_at is null;
  if v_me.id is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select * into v_agency from public.agencies where id = v_me.agency_id;
  if v_agency.ended_at is not null then
    raise exception 'This office''s subscription has ended.';
  end if;
  v_email := nullif(lower(btrim(v_agency.licensee_email)), '');
  if v_email is null then
    raise exception 'There''s no licensee email on the Office profile yet.';
  end if;
  if public.licensee_address_ok(v_agency.id, v_email) then
    return null;
  end if;

  select * into v_row from public.licensee_email_confirmations
   where agency_id = v_agency.id and email = v_email and superseded_at is null;
  if v_row.id is null then
    insert into public.licensee_email_confirmations (agency_id, email, created_by)
    values (v_agency.id, v_email, v_me.id)
    on conflict (agency_id, email) where superseded_at is null do nothing;
    select * into v_row from public.licensee_email_confirmations
     where agency_id = v_agency.id and email = v_email and superseded_at is null;
  elsif v_row.last_sent_at > now() - interval '5 minutes' then
    raise exception 'We sent it to % a few minutes ago. Give it a few minutes, and ask them to check their spam or junk folder.', v_email;
  end if;
  return v_row.id;
end
$$;

-- Whether the email went, recorded honestly (as 0047 and 0093 do).
create or replace function public.record_licensee_confirmation_email(p_id uuid, p_sent boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.licensee_email_confirmations
     set send_count = send_count + 1,
         last_sent_at = case when p_sent then now() else last_sent_at end,
         last_send_error = case when p_sent then null else 'The email could not be sent. Try sending it again.' end
   where id = p_id
     and (auth.uid() is null or agency_id = public.current_agency_id());
$$;

-- What the confirm page shows. Nothing for a token that never existed.
-- is_current is false once the office's licensee email has changed.
create or replace function public.licensee_confirmation_details(p_token uuid)
returns table (office_name text, email text, confirmed_at timestamptz, is_current boolean)
language sql
stable
security definer
set search_path = public
as $$
  select btrim(a.name), c.email, c.confirmed_at,
         c.superseded_at is null and c.email = lower(btrim(a.licensee_email)) and a.ended_at is null
    from public.licensee_email_confirmations c
    join public.agencies a on a.id = c.agency_id
   where c.token = p_token;
$$;

-- The click. Returns the office's id when this address is now confirmed
-- (the app then sends anything that was waiting for it), null otherwise.
create or replace function public.confirm_licensee_email(p_token uuid, p_ip text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.licensee_email_confirmations;
begin
  select c.* into v_row
    from public.licensee_email_confirmations c
    join public.agencies a on a.id = c.agency_id
   where c.token = p_token and c.superseded_at is null
     and c.email = lower(btrim(a.licensee_email)) and a.ended_at is null
   for update of c;
  if v_row.id is null then
    return null;
  end if;
  if v_row.confirmed_at is null then
    update public.licensee_email_confirmations
       set confirmed_at = now(), confirmed_ip = left(nullif(btrim(coalesce(p_ip, '')), ''), 100)
     where id = v_row.id;
  end if;
  return v_row.agency_id;
end
$$;

-- The daily job's list: offices whose licensee email has never been sent
-- the confirm email (existing offices once, and any whose first send failed
-- or that changed the address in the database). Server only. Never an agent
-- on their own plan: RealComply doesn't contact an agent's licensee unless
-- the agent asks (Adam, 14 Oct 2026); the agent sends it from Office profile
-- or when they first send a link.
create or replace function public.pending_licensee_confirmations()
returns table (agency_id uuid, office_name text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, btrim(a.name), lower(btrim(a.licensee_email))
    from public.agencies a
   where a.ended_at is null
     and left(coalesce(a.plan, ''), 6) <> 'agent_'
     and nullif(btrim(a.licensee_email), '') is not null
     and not public.licensee_address_ok(a.id, a.licensee_email)
     and not exists (select 1 from public.licensee_email_confirmations c
                      where c.agency_id = a.id and c.email = lower(btrim(a.licensee_email))
                        and c.superseded_at is null and c.last_sent_at is not null);
$$;

-- The same, for the server to make the row for one office (the daily job,
-- sign-up, and a change on the Office profile). Returns the row's id, or
-- null when there is nothing to confirm.
create or replace function public.licensee_confirmation_for(p_agency uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_id uuid;
begin
  select nullif(lower(btrim(licensee_email)), '') into v_email
    from public.agencies where id = p_agency and ended_at is null;
  if v_email is null or public.licensee_address_ok(p_agency, v_email) then
    return null;
  end if;
  insert into public.licensee_email_confirmations (agency_id, email)
  values (p_agency, v_email)
  on conflict (agency_id, email) where superseded_at is null do nothing;
  select id into v_id from public.licensee_email_confirmations
   where agency_id = p_agency and email = v_email and superseded_at is null;
  return v_id;
end
$$;

revoke execute on function public.request_licensee_confirmation() from public, anon;
revoke execute on function public.record_licensee_confirmation_email(uuid, boolean) from public, anon;
revoke execute on function public.licensee_confirmation_details(uuid) from public;
revoke execute on function public.confirm_licensee_email(uuid, text) from public;
revoke execute on function public.pending_licensee_confirmations() from public, anon, authenticated;
revoke execute on function public.licensee_confirmation_for(uuid) from public, anon, authenticated;
grant execute on function public.request_licensee_confirmation() to authenticated;
grant execute on function public.record_licensee_confirmation_email(uuid, boolean) to authenticated, service_role;
grant execute on function public.licensee_confirmation_details(uuid) to anon, authenticated, service_role;
grant execute on function public.confirm_licensee_email(uuid, text) to anon, authenticated, service_role;
grant execute on function public.pending_licensee_confirmations() to service_role;
grant execute on function public.licensee_confirmation_for(uuid) to service_role;

-- ── 4. No link to an address that hasn't confirmed ──────────────────────
-- Each runs after the table's own guards: triggers run in name order, hence
-- "zz" in the names. So the address it checks is the one those guards wrote,
-- and their own refusals (an agent plan, an ended office) come first.

-- The file sign-off link: sent_to is the licensee email (0104).
create or replace function public.guard_signoff_request_confirmed()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if not public.licensee_address_ok(new.agency_id, new.sent_to) then
    raise exception '%', public.licensee_confirm_first_message(new.agency_id);
  end if;
  return new;
end
$$;
revoke execute on function public.guard_signoff_request_confirmed() from public, anon, authenticated;
drop trigger if exists property_signoff_requests_zz_licensee_confirmed on public.property_signoff_requests;
create trigger property_signoff_requests_zz_licensee_confirmed
  before insert on public.property_signoff_requests
  for each row execute function public.guard_signoff_request_confirmed();

-- The office manager approval request: made only by request_office_manager()
-- (security definer), so this checks every insert, whoever makes it. And
-- approved only while the address it went to is still the confirmed
-- licensee email (an approval link to an old address stops working).
create or replace function public.guard_office_manager_request_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not public.licensee_address_ok(new.agency_id, new.sent_to) then
      raise exception '%', public.licensee_confirm_first_message(new.agency_id);
    end if;
  elsif new.approved_at is not null and old.approved_at is null then
    if not public.licensee_address_ok(new.agency_id, old.sent_to) then
      raise exception 'This link is no longer valid. Ask the person who asked to send a new one.';
    end if;
  end if;
  return new;
end
$$;
revoke execute on function public.guard_office_manager_request_confirmed() from public, anon, authenticated;
drop trigger if exists office_manager_requests_zz_licensee_confirmed on public.office_manager_requests;
create trigger office_manager_requests_zz_licensee_confirmed
  before insert or update on public.office_manager_requests
  for each row execute function public.guard_office_manager_request_confirmed();

-- The licensee in charge invite: its address is the licensee email (0095).
create or replace function public.guard_licensee_invite_confirmed()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.is_licensee_in_charge and not public.licensee_address_ok(new.agency_id, new.email) then
    raise exception '%', public.licensee_confirm_first_message(new.agency_id);
  end if;
  return new;
end
$$;
revoke execute on function public.guard_licensee_invite_confirmed() from public, anon, authenticated;
drop trigger if exists agency_invites_zz_licensee_confirmed on public.agency_invites;
create trigger agency_invites_zz_licensee_confirmed
  before insert on public.agency_invites
  for each row execute function public.guard_licensee_invite_confirmed();

-- The SG annexure link for a new office: made by the server. Its address is
-- a licensee's login, or the licensee email once confirmed.
create or replace function public.guard_annexure_link_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.purpose = 'new_office' and not public.licensee_address_ok(new.agency_id, new.sent_to) then
    raise exception '%', public.licensee_confirm_first_message(new.agency_id);
  end if;
  return new;
end
$$;
revoke execute on function public.guard_annexure_link_confirmed() from public, anon, authenticated;
drop trigger if exists sg_annexure_links_zz_licensee_confirmed on public.sg_annexure_links;
create trigger sg_annexure_links_zz_licensee_confirmed
  before insert on public.sg_annexure_links
  for each row execute function public.guard_annexure_link_confirmed();

-- ── 5. A new licensee email starts again ────────────────────────────────
-- The old address's confirmation is set aside, and links still out to it
-- stop working: the file sign-off link is withdrawn, the office manager
-- request cancelled, an unused annexure link expired.
create or replace function public.licensee_email_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new text := nullif(lower(btrim(new.licensee_email)), '');
begin
  if v_new is not distinct from nullif(lower(btrim(old.licensee_email)), '') then
    return new;
  end if;
  update public.licensee_email_confirmations
     set superseded_at = now()
   where agency_id = new.id and superseded_at is null and email is distinct from v_new;
  update public.property_signoff_requests
     set revoked_at = now()
   where agency_id = new.id and signed_at is null and revoked_at is null
     and lower(btrim(sent_to)) is distinct from v_new
     and not public.licensee_address_ok(new.id, sent_to);
  update public.office_manager_requests
     set cancelled_at = now()
   where agency_id = new.id and approved_at is null and cancelled_at is null
     and lower(btrim(sent_to)) is distinct from v_new;
  update public.sg_annexure_links
     set expires_at = least(expires_at, now())
   where agency_id = new.id and used_at is null
     and lower(btrim(sent_to)) is distinct from v_new
     and not public.licensee_address_ok(new.id, sent_to);
  return new;
end
$$;
revoke execute on function public.licensee_email_changed() from public, anon, authenticated;
drop trigger if exists agencies_licensee_email_changed on public.agencies;
create trigger agencies_licensee_email_changed
  after update of licensee_email on public.agencies
  for each row execute function public.licensee_email_changed();

-- ── 6. What has been sent to the licensee ───────────────────────────────
-- For the Office profile: each kind of link, the address it last went to and
-- when. Anyone in the office, so whoever is waiting on a signature can spot a
-- wrong address. Only kinds, addresses and dates; never a link.
create or replace function public.licensee_link_sends()
returns table (kind text, sent_to text, sent_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (select public.current_agency_id() as id)
  select * from (
    (select 'confirm'::text, c.email, c.last_sent_at
       from public.licensee_email_confirmations c, mine
      where c.agency_id = mine.id and c.last_sent_at is not null
      order by c.last_sent_at desc limit 1)
    union all
    (select 'file_signoff', lower(btrim(r.sent_to)), r.email_sent_at
       from public.property_signoff_requests r, mine
      where r.agency_id = mine.id and r.item_key = 'sign_licensee' and r.email_sent_at is not null
      order by r.email_sent_at desc limit 1)
    union all
    (select 'office_manager', lower(btrim(r.sent_to)), r.email_sent_at
       from public.office_manager_requests r, mine
      where r.agency_id = mine.id and r.email_sent_at is not null
      order by r.email_sent_at desc limit 1)
    union all
    (select 'annexure', lower(btrim(l.sent_to)), l.email_sent_at
       from public.sg_annexure_links l, mine
      where l.agency_id = mine.id and l.purpose = 'new_office' and l.email_sent_at is not null
      order by l.email_sent_at desc limit 1)
    union all
    (select 'licensee_invite', lower(btrim(i.email)), i.created_at
       from public.agency_invites i, mine
      where i.agency_id = mine.id and i.is_licensee_in_charge
      order by i.created_at desc limit 1)
  ) s;
$$;
revoke execute on function public.licensee_link_sends() from public, anon;
grant execute on function public.licensee_link_sends() to authenticated, service_role;

commit;

-- ── Check ──────────────────────────────────────────────────────────────
-- One row. Every true/false value true. offices_to_confirm is how many
-- offices the daily job will send the confirm email to once.
select
  to_regclass('public.licensee_email_confirmations') is not null
    and has_column_privilege('authenticated', 'public.licensee_email_confirmations', 'email', 'select')
    and not has_column_privilege('authenticated', 'public.licensee_email_confirmations', 'token', 'select')
    and not has_table_privilege('anon', 'public.licensee_email_confirmations', 'select')
    and not has_table_privilege('authenticated', 'public.licensee_email_confirmations', 'insert') as confirmations_ready,
  has_function_privilege('anon', 'public.confirm_licensee_email(uuid, text)', 'execute')
    and has_function_privilege('authenticated', 'public.request_licensee_confirmation()', 'execute')
    and not has_function_privilege('authenticated', 'public.pending_licensee_confirmations()', 'execute')
    and has_function_privilege('authenticated', 'public.licensee_link_sends()', 'execute') as functions_ready,
  (select count(*) from pg_trigger where tgname in ('property_signoff_requests_zz_licensee_confirmed',
      'office_manager_requests_zz_licensee_confirmed', 'agency_invites_zz_licensee_confirmed',
      'sg_annexure_links_zz_licensee_confirmed', 'agencies_licensee_email_changed')) = 5 as guards_on,
  (select count(*) from public.pending_licensee_confirmations()) as offices_to_confirm;
