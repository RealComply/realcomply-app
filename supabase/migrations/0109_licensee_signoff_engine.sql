-- ===== 0109: Licensee sign-off: the monthly pack, signed in the app =====
--
-- Monthly licensee sign-off pack, part 3 (Adam, 3 Nov 2026). Run after 0108.
--
-- WHY. In larger offices the licensee in charge doesn't sign each item as it
-- comes in: the office manager brings them everything once a month.
--
-- WHAT. One engine signs the items waiting for the licensee in charge, and
-- signing through it does EXACTLY what signing each item on its own does
-- (Adam: "This is the main rule"), plus the record of how it was signed:
--   * sales file      the final sign-off (sign_licensee), as submit_signoff
--   * trust recon.    the licensee's signature on the newest upload for the month
--   * trust audit     the licensee's confirmation of the details entered (Adam,
--                     3 Nov 2026: the office manager enters, the licensee confirms)
--   * SG Manual       the licensee's own signature on the newest version
--   * training plan   the principal's signature, once the staff member has signed
--   * complaint       the sign-off of a resolved complaint (0108)
--   * gift            the review of a gift over the limit (0108)
-- Property management has no licensee sign-off, so nothing of it is waiting.
--
-- The licensee in charge signs the pack in the app, logged in, through
-- licensee_sign_pack() (server only). How each item was signed is recorded
-- on every kind (signed_via: app, or pack). A licensee with no login signs
-- nothing through this file: their links are a separate change (Master,
-- 4 Nov 2026: part 2 waits for the terms email), so an office whose licensee
-- isn't on RealComply can't choose "Monthly pack" yet.
--
-- THE PACK. The office manager (or the licensee) sends the month's pack;
-- once sent it is fixed, and anything that comes in afterwards goes into the
-- next month's. The licensee signs it with one tick, holding back any item
-- with a short note: a held-back item goes back to the office manager and
-- into next month's pack. The office profile setting ("As items come in" or
-- "Monthly pack") changes reminders only.
--
-- New tables with their grants in this file. Safe to run twice.

begin;

-- ── 1. How each kind records how it was signed ───────────────────────
alter table public.signoff_signatures add column if not exists signed_via text;
alter table public.signoff_signatures drop constraint if exists signoff_signatures_signed_via_check;
alter table public.signoff_signatures add constraint signoff_signatures_signed_via_check
  check (signed_via is null or signed_via in ('app', 'pack'));

alter table public.trust_audits add column if not exists entered_by uuid references public.profiles (id) on delete set null;
alter table public.trust_audits add column if not exists entered_by_name text;
alter table public.trust_audits add column if not exists entered_at timestamptz;
alter table public.trust_audits add column if not exists confirmed_name text;
alter table public.trust_audits add column if not exists confirmed_via text;
alter table public.trust_audits drop constraint if exists trust_audits_confirmed_via_check;
alter table public.trust_audits add constraint trust_audits_confirmed_via_check
  check (confirmed_via is null or confirmed_via in ('app', 'pack'));

alter table public.training_plans add column if not exists principal_signed_via text;
alter table public.training_plans drop constraint if exists training_plans_principal_signed_via_check;
alter table public.training_plans add constraint training_plans_principal_signed_via_check
  check (principal_signed_via is null or principal_signed_via in ('app', 'pack'));

alter table public.complaints add column if not exists signed_off_via text;
alter table public.complaints drop constraint if exists complaints_signed_off_via_check;
alter table public.complaints add constraint complaints_signed_off_via_check
  check (signed_off_via is null or signed_off_via in ('app', 'pack'));

alter table public.gifts add column if not exists reviewed_via text;
alter table public.gifts drop constraint if exists gifts_reviewed_via_check;
alter table public.gifts add constraint gifts_reviewed_via_check
  check (reviewed_via is null or reviewed_via in ('app', 'pack'));

-- The trust audit: entered by the office manager or the licensee, confirmed
-- by the licensee (Adam, 3 Nov 2026). Runs as the caller, so current_user
-- tells RealComply's own code from someone signed in.
create or replace function public.guard_trust_audit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_name text;
  v_details_changed boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  select coalesce(nullif(btrim(full_name), ''), email) into v_name from public.profiles where id = auth.uid();
  v_details_changed := tg_op = 'INSERT'
    or row(new.period_end, new.auditor_name, new.report_received_on, new.file_path, new.file_name, new.notes)
       is distinct from row(old.period_end, old.auditor_name, old.report_received_on, old.file_path, old.file_name, old.notes);
  if v_details_changed then
    new.entered_by := auth.uid(); new.entered_by_name := v_name; new.entered_at := now();
  else
    new.entered_by := old.entered_by; new.entered_by_name := old.entered_by_name; new.entered_at := old.entered_at;
  end if;

  if public.acts_as_licensee() then
    if new.confirmed_at is null then
      new.confirmed_by := null; new.confirmed_name := null; new.confirmed_via := null;
    elsif tg_op = 'INSERT' or old.confirmed_at is null then
      new.confirmed_by := auth.uid(); new.confirmed_name := v_name; new.confirmed_at := now(); new.confirmed_via := 'app';
    else
      new.confirmed_by := old.confirmed_by; new.confirmed_name := old.confirmed_name;
      new.confirmed_at := old.confirmed_at; new.confirmed_via := old.confirmed_via;
    end if;
  elsif tg_op = 'INSERT' or (v_details_changed and old.confirmed_at is not null) then
    -- Someone else enters the details. They never confirm, and details changed
    -- after the licensee confirmed them need confirming again.
    new.confirmed_by := null; new.confirmed_name := null; new.confirmed_at := null; new.confirmed_via := null;
  else
    new.confirmed_by := old.confirmed_by; new.confirmed_name := old.confirmed_name;
    new.confirmed_at := old.confirmed_at; new.confirmed_via := old.confirmed_via;
  end if;
  return new;
end
$$;
drop trigger if exists trust_audits_entry_guard on public.trust_audits;
create trigger trust_audits_entry_guard before insert or update on public.trust_audits
  for each row execute function public.guard_trust_audit();

-- ── 2. The office's setting: "As items come in" or "Monthly pack" ─────
alter table public.agencies add column if not exists licensee_signoff_mode text not null default 'as_they_come';
alter table public.agencies drop constraint if exists agencies_licensee_signoff_mode_check;
alter table public.agencies add constraint agencies_licensee_signoff_mode_check
  check (licensee_signoff_mode in ('as_they_come', 'monthly'));
alter table public.agencies add column if not exists licensee_signoff_mode_set_by_name text;
alter table public.agencies add column if not exists licensee_signoff_mode_set_at timestamptz;

create or replace function public.guard_licensee_signoff_mode()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  new.licensee_signoff_mode := old.licensee_signoff_mode;
  new.licensee_signoff_mode_set_by_name := old.licensee_signoff_mode_set_by_name;
  new.licensee_signoff_mode_set_at := old.licensee_signoff_mode_set_at;
  return new;
end
$$;
drop trigger if exists agencies_licensee_signoff_mode_guard on public.agencies;
create trigger agencies_licensee_signoff_mode_guard before update on public.agencies
  for each row execute function public.guard_licensee_signoff_mode();

create or replace function public.set_licensee_signoff_mode(p_mode text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if auth.uid() is null or not public.runs_office() then
    raise exception 'Only the licensee in charge or the office manager can change this.' using errcode = '42501';
  end if;
  if p_mode not in ('as_they_come', 'monthly') then
    raise exception 'Choose "As items come in" or "Monthly pack".' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.agencies where id = public.current_agency_id() and left(plan, 6) = 'agent_') then
    raise exception 'An agent on their own plan signs as items come in.' using errcode = 'P0001';
  end if;
  -- The pack is signed in the app, so the licensee needs a login (Master,
  -- 4 Nov 2026). Until then their files keep going to them by email as before.
  if p_mode = 'monthly' and not exists (
       select 1 from public.profiles p
        where p.agency_id = public.current_agency_id() and p.is_licensee_in_charge and p.archived_at is null) then
    raise exception 'Your licensee needs to be on RealComply to sign a monthly pack.' using errcode = 'P0001';
  end if;
  select coalesce(nullif(btrim(full_name), ''), email) into v_name from public.profiles where id = auth.uid();
  update public.agencies
     set licensee_signoff_mode = p_mode, licensee_signoff_mode_set_by_name = v_name, licensee_signoff_mode_set_at = now()
   where id = public.current_agency_id();
end
$$;
revoke execute on function public.set_licensee_signoff_mode(text) from public, anon;
grant execute on function public.set_licensee_signoff_mode(text) to authenticated, service_role;

-- ── 3. The month's pack ───────────────────────────────────────────────
create table if not exists public.signoff_packs (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies (id) on delete cascade,
  -- The month it is for: the first of the month.
  month         date not null check (extract(day from month) = 1),
  sent_at       timestamptz,
  sent_by       uuid references public.profiles (id) on delete set null,
  sent_by_name  text,
  signed_at     timestamptz,
  signed_by     uuid references public.profiles (id) on delete set null,
  signed_name   text,
  signed_via    text check (signed_via is null or signed_via = 'app'),
  -- The signed PDF, filed in Sign-offs too.
  signed_file_path text,
  signed_file_name text,
  -- The monthly reminders, so each goes once: the 1st-of-the-month reminder to
  -- send it, and the licensee's after 7 days unsigned.
  office_reminded_at   timestamptz,
  licensee_reminded_at timestamptz,
  created_at    timestamptz not null default now(),
  unique (agency_id, month)
);
alter table public.signoff_packs add column if not exists office_reminded_at timestamptz;
alter table public.signoff_packs add column if not exists licensee_reminded_at timestamptz;
comment on table public.signoff_packs is
  'The monthly licensee sign-off pack (0109, Adam 3 Nov 2026). Fixed once sent; signed with one tick.';

create table if not exists public.signoff_pack_items (
  id            uuid primary key default gen_random_uuid(),
  pack_id       uuid not null references public.signoff_packs (id) on delete cascade,
  agency_id     uuid not null references public.agencies (id) on delete cascade,
  item_type     text not null check (item_type in
                  ('sales_file', 'trust_reconciliation', 'trust_audit', 'sg_manual', 'training_plan', 'complaint', 'gift')),
  item_id       uuid not null,
  grp           text not null check (grp in ('sales', 'pm', 'trust', 'office')),
  -- What the licensee was shown, as it was when the pack was sent.
  title         text not null,
  details       text,
  flagged       boolean not null default false,
  flag_text     text,
  note          text,
  note_by_name  text,
  held_back_at  timestamptz,
  held_back_note text,
  signed_at     timestamptz,
  unique (pack_id, item_type, item_id)
);
create index if not exists signoff_pack_items_item on public.signoff_pack_items (agency_id, item_type, item_id);

-- Notes the office manager adds before sending; the licensee sees them.
create table if not exists public.signoff_item_notes (
  agency_id     uuid not null references public.agencies (id) on delete cascade,
  item_type     text not null,
  item_id       uuid not null,
  note          text not null check (char_length(note) <= 1000),
  noted_by      uuid references public.profiles (id) on delete set null,
  noted_by_name text,
  noted_at      timestamptz not null default now(),
  primary key (agency_id, item_type, item_id)
);

alter table public.signoff_packs enable row level security;
alter table public.signoff_pack_items enable row level security;
alter table public.signoff_item_notes enable row level security;
drop policy if exists "signoff_packs: the office reads its packs" on public.signoff_packs;
create policy "signoff_packs: the office reads its packs" on public.signoff_packs
  for select using (agency_id = public.current_agency_id() and public.runs_office());
drop policy if exists "signoff_pack_items: the office reads its packs" on public.signoff_pack_items;
create policy "signoff_pack_items: the office reads its packs" on public.signoff_pack_items
  for select using (agency_id = public.current_agency_id() and public.runs_office());
drop policy if exists "signoff_item_notes: the office reads its notes" on public.signoff_item_notes;
create policy "signoff_item_notes: the office reads its notes" on public.signoff_item_notes
  for select using (agency_id = public.current_agency_id() and public.runs_office());

-- Data API grants. The office reads; RealComply's own code (the functions
-- below and the server's key) writes.
revoke all on table public.signoff_packs from public, anon, authenticated;
revoke all on table public.signoff_pack_items from public, anon, authenticated;
revoke all on table public.signoff_item_notes from public, anon, authenticated;
grant select on public.signoff_packs to authenticated;
grant select on public.signoff_pack_items to authenticated;
grant select on public.signoff_item_notes to authenticated;
grant select, insert, update, delete on public.signoff_packs, public.signoff_pack_items, public.signoff_item_notes
  to service_role;
grant select (signed_via) on public.signoff_signatures to authenticated;
grant select (entered_by, entered_by_name, entered_at, confirmed_name, confirmed_via) on public.trust_audits to authenticated;
grant select (principal_signed_via) on public.training_plans to authenticated;
grant select (signed_off_via) on public.complaints to authenticated;
grant select (reviewed_via) on public.gifts to authenticated;
grant select (licensee_signoff_mode, licensee_signoff_mode_set_by_name, licensee_signoff_mode_set_at)
  on public.agencies to authenticated;

-- ── 5. What is waiting for the licensee, and signing it ──────────────
-- Whether an item is waiting for the licensee in charge's signature now.
-- The single definition, used when a pack is sent and again when it is
-- signed, so an item signed some other way in between is not signed twice.
create or replace function public.licensee_item_waiting(p_agency uuid, p_type text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_type
    when 'sales_file' then exists (
      select 1 from public.property_signoff_requests r
       where r.id = p_id and r.agency_id = p_agency and coalesce(r.item_key, 'sign_licensee') = 'sign_licensee'
         and r.signed_at is null and r.revoked_at is null)
    when 'trust_reconciliation' then exists (
      select 1 from public.signoff_documents d
       where d.id = p_id and d.agency_id = p_agency and d.category = 'trust_reconciliation'
         -- The newest upload for its month is the one that counts.
         and not exists (select 1 from public.signoff_documents n
                          where n.agency_id = d.agency_id and n.category = d.category
                            and n.trust_account_id is not distinct from d.trust_account_id
                            and n.period_month = d.period_month and n.created_at > d.created_at)
         and not exists (select 1 from public.signoff_signatures s
                          where s.document_id = d.id and s.signed_at is not null))
    when 'sg_manual' then exists (
      select 1 from public.signoff_documents d
       where d.id = p_id and d.agency_id = p_agency and d.category = 'sg_manual'
         and not exists (select 1 from public.signoff_documents n
                          where n.agency_id = d.agency_id and n.category = 'sg_manual' and n.created_at > d.created_at)
         and not exists (select 1 from public.signoff_signatures s
                          left join public.profiles p on p.id = s.signer_id
                          where s.document_id = d.id and s.signed_at is not null
                            and (s.signer_id is null or p.is_licensee_in_charge)))
    when 'trust_audit' then exists (
      select 1 from public.trust_audits a
       where a.id = p_id and a.agency_id = p_agency and a.entered_at is not null and a.confirmed_at is null)
    when 'training_plan' then exists (
      select 1 from public.training_plans t
       where t.id = p_id and t.agency_id = p_agency and t.staff_signed_at is not null and t.principal_signed_at is null)
    when 'complaint' then exists (
      select 1 from public.complaints c
       where c.id = p_id and c.agency_id = p_agency and c.status = 'resolved' and c.signed_off_at is null)
    when 'gift' then exists (
      select 1 from public.gifts g
       where g.id = p_id and g.agency_id = p_agency and g.status = 'flagged')
    else false
  end;
$$;
revoke execute on function public.licensee_item_waiting(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.licensee_item_waiting(uuid, text, uuid) to service_role;

-- Signs one item exactly as signing it on its own does, plus how it was
-- signed. p_signer is the licensee's profile: always a login (a licensee with
-- no login signs nothing here). Returns true if it signed it now, false if it
-- was no longer waiting. Never called by the browser.
create or replace function public.licensee_sign_item(
  p_agency uuid, p_type text, p_id uuid, p_signer uuid, p_name text, p_via text, p_pack uuid default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_req public.property_signoff_requests%rowtype;
  v_rows integer;
begin
  if p_signer is null then
    raise exception 'Only the licensee in charge, logged in, signs here.' using errcode = '42501';
  end if;
  if v_name = '' or char_length(v_name) > 200 or p_via not in ('app', 'pack') then
    raise exception 'A name is needed to sign.' using errcode = 'P0001';
  end if;
  if not public.licensee_item_waiting(p_agency, p_type, p_id) then
    return false;
  end if;

  if p_type = 'sales_file' then
    -- As submit_signoff (0066): the request, then the licensee signature card.
    update public.property_signoff_requests
       set signed_at = now(), signed_name = v_name
     where id = p_id and signed_at is null and revoked_at is null
    returning * into v_req;
    insert into public.property_items (agency_id, property_id, item_key, status, data)
    values (v_req.agency_id, v_req.property_id, 'sign_licensee', 'done',
            jsonb_strip_nulls(jsonb_build_object('signedName', v_req.signed_name, 'signedVia', p_via,
                                                 'signoffRequestId', v_req.id, 'packId', p_pack)))
    on conflict (property_id, item_key) do update
      set status = 'done',
          data = case when public.property_items.status = 'done' then public.property_items.data
                      else public.property_items.data - array['typedName', 'signedAt', 'signedBy']
                 end || excluded.data,
          completed_by = case when public.property_items.status = 'done' then public.property_items.completed_by end,
          event_date = case when public.property_items.status = 'done' then public.property_items.event_date end;

  elsif p_type in ('trust_reconciliation', 'sg_manual') then
    update public.signoff_signatures
       set signed_at = now(), typed_name = v_name, signed_via = p_via
     where document_id = p_id and signer_id = p_signer and signed_at is null;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      insert into public.signoff_signatures (document_id, agency_id, signer_id, typed_name, signed_at, signed_via)
      values (p_id, p_agency, p_signer, v_name, now(), p_via)
      on conflict (document_id, signer_id) do nothing;
    end if;

  elsif p_type = 'trust_audit' then
    update public.trust_audits
       set confirmed_by = p_signer, confirmed_name = v_name, confirmed_at = now(), confirmed_via = p_via,
           updated_at = now()
     where id = p_id and confirmed_at is null;

  elsif p_type = 'training_plan' then
    update public.training_plans
       set principal_signed_name = v_name, principal_signed_at = now(), principal_signed_via = p_via, updated_at = now()
     where id = p_id and principal_signed_at is null;

  elsif p_type = 'complaint' then
    update public.complaints
       set signed_off_by = p_signer, signed_off_name = v_name, signed_off_at = now(), signed_off_via = p_via
     where id = p_id and signed_off_at is null;

  elsif p_type = 'gift' then
    update public.gifts
       set status = 'reviewed', reviewed_by = p_signer, reviewed_by_name = v_name, reviewed_at = now(), reviewed_via = p_via
     where id = p_id and status = 'flagged';
  end if;
  return true;
end
$$;
revoke execute on function public.licensee_sign_item(uuid, text, uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.licensee_sign_item(uuid, text, uuid, uuid, text, text, uuid) to service_role;

-- The pack is signed: every item not held back, each in its own place; the
-- held-back ones are marked with the licensee's note; the pack records who,
-- when and how. One transaction: all of it, or none.
create or replace function public.licensee_sign_pack(
  p_pack uuid, p_signer uuid, p_name text, p_via text, p_hold jsonb default '[]'::jsonb)
returns table (signed integer, held integer, skipped integer)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_pack public.signoff_packs%rowtype;
  v_item record;
  v_note text;
  v_signed integer := 0;
  v_held integer := 0;
  v_skipped integer := 0;
begin
  if p_signer is null or p_via is distinct from 'app' then
    raise exception 'Only the licensee in charge, logged in, signs the pack.' using errcode = '42501';
  end if;
  select * into v_pack from public.signoff_packs where id = p_pack for update;
  if v_pack.id is null or v_pack.sent_at is null then
    raise exception 'That pack hasn''t been sent yet.' using errcode = 'P0001';
  end if;
  if v_pack.signed_at is not null then
    raise exception 'That pack is already signed.' using errcode = 'P0001';
  end if;
  for v_item in select * from public.signoff_pack_items where pack_id = p_pack order by grp, title loop
    select nullif(btrim(h ->> 'note'), '') into v_note
      from jsonb_array_elements(coalesce(p_hold, '[]'::jsonb)) h where (h ->> 'id')::uuid = v_item.id;
    if found then
      if v_note is null then
        raise exception 'Add a short note to each item you hold back.' using errcode = 'P0001';
      end if;
      update public.signoff_pack_items set held_back_at = now(), held_back_note = left(v_note, 500) where id = v_item.id;
      v_held := v_held + 1;
    elsif public.licensee_sign_item(v_item.agency_id, v_item.item_type, v_item.item_id, p_signer, p_name,
                                     'pack', p_pack) then
      update public.signoff_pack_items set signed_at = now() where id = v_item.id;
      v_signed := v_signed + 1;
    else
      -- Signed some other way since the pack was sent: nothing to do.
      v_skipped := v_skipped + 1;
    end if;
  end loop;
  update public.signoff_packs
     set signed_at = now(), signed_by = p_signer, signed_name = btrim(p_name), signed_via = p_via
   where id = p_pack;
  return query select v_signed, v_held, v_skipped;
end
$$;
revoke execute on function public.licensee_sign_pack(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.licensee_sign_pack(uuid, uuid, text, text, jsonb) to service_role;

commit;

-- ── Check ──────────────────────────────────────────────────────────────
-- One row, every value true.
select
  (select is_nullable = 'NO' from information_schema.columns
    where table_schema = 'public' and table_name = 'signoff_signatures' and column_name = 'signer_id') as signs_with_a_login,
  to_regclass('public.signoff_packs') is not null and to_regclass('public.signoff_pack_items') is not null
    and to_regclass('public.signoff_item_notes') is not null as pack_tables,
  position('needs to be on RealComply' in pg_get_functiondef('public.set_licensee_signoff_mode(text)'::regprocedure)) > 0
    as monthly_needs_a_login,
  not has_function_privilege('authenticated', 'public.licensee_sign_item(uuid, text, uuid, uuid, text, text, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.licensee_sign_pack(uuid, uuid, text, text, jsonb)', 'execute')
    as signing_server_only,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'agencies'
      and column_name = 'licensee_signoff_mode') = 1 as setting_added,
  exists (select 1 from pg_trigger where tgname = 'trust_audits_entry_guard') as audit_guard_on;
