-- ===== 0113: Licensee sign-off links, for a licensee in charge with no login =====
--
-- Monthly licensee sign-off pack, part 2 (Adam, 3 Nov 2026; split out of
-- 0109 on 4 Nov 2026, Master: part 2 waits for the terms email). Run after
-- 0109, 0111 and 0112. It needs only 0109 (checked below) and changes nothing
-- 0111 or 0112 sets up.
--
-- WHY. An office whose licensee has no login (Raine & Horne Queanbeyan, for
-- one) had no way at all to sign a trust reconciliation, the SG Manual, a
-- training plan, a complaint or a gift review: a trust month just went
-- overdue. 0109 lets a licensee with a login sign the month's pack in the
-- app. This adds the two ways in for a licensee with no login, both through
-- licensee_sign_item():
--   1. An email link for ONE item, in an office set to "As items come in"
--      (Adam, 3 Nov 2026).
--   2. An email link for the MONTH'S PACK (Adam, 3 Nov 2026: "A licensee
--      without a login uses the same link, the same way they sign today").
-- Links follow the email job's rules (0107): the token is never readable from
-- the table, Copy link records who copied it, Opened only when a person
-- interacts with the page, and the signer ticks that they are the licensee
-- in charge, signing for themselves.
--
-- A SIGNATURE WITHOUT A LOGIN. signoff_signatures needed a profile to sign.
-- A licensee with no login now signs with their typed name and no profile,
-- one such signature per document, and how it was signed is recorded
-- (signed_via: app, link or pack) on every kind. "Monthly pack" can be chosen
-- whatever the licensee's login (0109 allowed it only with one).
--
-- New tables with their grants in this file. Safe to run twice.

begin;

-- Order check: 0109 (the pack) first.
do $$
begin
  if to_regclass('public.signoff_packs') is null
     or to_regprocedure('public.licensee_sign_item(uuid,text,uuid,uuid,text,text,uuid)') is null then
    raise exception 'Run 0109 before this one. Nothing was changed.';
  end if;
end $$;

-- ── 1. A signature without a login, and 'link' on every kind ──────────
do $$
begin
  alter table public.signoff_signatures alter column signer_id drop not null;
end $$;
alter table public.signoff_signatures drop constraint if exists signoff_signatures_signed_via_check;
alter table public.signoff_signatures add constraint signoff_signatures_signed_via_check
  check (signed_via is null or signed_via in ('app', 'link', 'pack'));
-- A signature with no profile is the licensee in charge with no login: it has
-- their typed name and its time, and there is at most one on a document.
alter table public.signoff_signatures drop constraint if exists signoff_signatures_named_without_login;
alter table public.signoff_signatures add constraint signoff_signatures_named_without_login
  check (signer_id is not null or (typed_name is not null and signed_at is not null));
create unique index if not exists signoff_signatures_one_without_login
  on public.signoff_signatures (document_id) where signer_id is null;

alter table public.trust_audits drop constraint if exists trust_audits_confirmed_via_check;
alter table public.trust_audits add constraint trust_audits_confirmed_via_check
  check (confirmed_via is null or confirmed_via in ('app', 'link', 'pack'));
alter table public.training_plans drop constraint if exists training_plans_principal_signed_via_check;
alter table public.training_plans add constraint training_plans_principal_signed_via_check
  check (principal_signed_via is null or principal_signed_via in ('app', 'link', 'pack'));
alter table public.complaints drop constraint if exists complaints_signed_off_via_check;
alter table public.complaints add constraint complaints_signed_off_via_check
  check (signed_off_via is null or signed_off_via in ('app', 'link', 'pack'));
alter table public.gifts drop constraint if exists gifts_reviewed_via_check;
alter table public.gifts add constraint gifts_reviewed_via_check
  check (reviewed_via is null or reviewed_via in ('app', 'link', 'pack'));
-- The pack itself: signed in the app, or through its link.
alter table public.signoff_packs drop constraint if exists signoff_packs_signed_via_check;
alter table public.signoff_packs add constraint signoff_packs_signed_via_check
  check (signed_via is null or signed_via in ('app', 'link'));

-- ── 2. "Monthly pack" with or without a licensee login ────────────────────
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
  select coalesce(nullif(btrim(full_name), ''), email) into v_name from public.profiles where id = auth.uid();
  update public.agencies
     set licensee_signoff_mode = p_mode, licensee_signoff_mode_set_by_name = v_name, licensee_signoff_mode_set_at = now()
   where id = public.current_agency_id();
end
$$;
revoke execute on function public.set_licensee_signoff_mode(text) from public, anon;
grant execute on function public.set_licensee_signoff_mode(text) to authenticated, service_role;

-- ── 3. Links: one item, or the month's pack ──────────────────────────
create table if not exists public.licensee_links (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies (id) on delete cascade,
  token         uuid not null default gen_random_uuid() unique,
  purpose       text not null check (purpose in ('item', 'pack')),
  item_type     text check (item_type is null or item_type in
                  ('trust_reconciliation', 'trust_audit', 'sg_manual', 'training_plan', 'complaint', 'gift')),
  item_id       uuid,
  pack_id       uuid references public.signoff_packs (id) on delete cascade,
  sent_to       text not null,
  licensee_name text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '30 days'),
  email_sent_at timestamptz,
  email_attempts integer not null default 0,
  email_error   text,
  opened_at     timestamptz,
  used_at       timestamptz,
  used_name     text,
  revoked_at    timestamptz,
  check ((purpose = 'item' and item_type is not null and item_id is not null and pack_id is null)
      or (purpose = 'pack' and pack_id is not null and item_type is null and item_id is null))
);
create index if not exists licensee_links_agency on public.licensee_links (agency_id, purpose);
create unique index if not exists licensee_links_one_live_per_item on public.licensee_links (item_type, item_id)
  where purpose = 'item' and used_at is null and revoked_at is null;
create unique index if not exists licensee_links_one_live_per_pack on public.licensee_links (pack_id)
  where purpose = 'pack' and used_at is null and revoked_at is null;

create table if not exists public.licensee_link_copies (
  id            uuid primary key default gen_random_uuid(),
  link_id       uuid not null references public.licensee_links (id) on delete cascade,
  agency_id     uuid not null references public.agencies (id) on delete cascade,
  copied_by     uuid references public.profiles (id) on delete set null,
  copied_by_name text not null,
  copied_at     timestamptz not null default now()
);
create index if not exists licensee_link_copies_link on public.licensee_link_copies (link_id, copied_at);

alter table public.licensee_links enable row level security;
alter table public.licensee_link_copies enable row level security;
drop policy if exists "licensee_links: the office reads its links" on public.licensee_links;
create policy "licensee_links: the office reads its links" on public.licensee_links
  for select using (agency_id = public.current_agency_id() and public.runs_office());
drop policy if exists "licensee_link_copies: the office reads them" on public.licensee_link_copies;
create policy "licensee_link_copies: the office reads them" on public.licensee_link_copies
  for select using (agency_id = public.current_agency_id() and public.runs_office());

-- Data API grants. The office reads; RealComply's own code (the functions
-- below and the server's key) writes. The token is never readable.
revoke all on table public.licensee_links from public, anon, authenticated;
revoke all on table public.licensee_link_copies from public, anon, authenticated;
grant select (id, agency_id, purpose, item_type, item_id, pack_id, sent_to, licensee_name, created_by, created_at,
              expires_at, email_sent_at, email_attempts, email_error, opened_at, used_at, used_name, revoked_at)
  on public.licensee_links to authenticated;
grant select on public.licensee_link_copies to authenticated;
grant select, insert, update, delete on public.licensee_links, public.licensee_link_copies to service_role;

-- ── 4. Signing, with no login and through a link ────────────────────────
-- Signs one item exactly as signing it on its own does, plus how it was
-- signed. p_signer is the licensee's profile, or null for a licensee with no
-- login (then p_name is the name they typed). Returns true if it signed it
-- now, false if it was no longer waiting. Never called by the browser.
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
  if v_name = '' or char_length(v_name) > 200 or p_via not in ('app', 'link', 'pack') then
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
    if p_signer is not null then
      update public.signoff_signatures
         set signed_at = now(), typed_name = v_name, signed_via = p_via
       where document_id = p_id and signer_id = p_signer and signed_at is null;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        insert into public.signoff_signatures (document_id, agency_id, signer_id, typed_name, signed_at, signed_via)
        values (p_id, p_agency, p_signer, v_name, now(), p_via)
        on conflict (document_id, signer_id) do nothing;
      end if;
    else
      insert into public.signoff_signatures (document_id, agency_id, signer_id, typed_name, signed_at, signed_via)
      values (p_id, p_agency, null, v_name, now(), p_via);
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
                                     case when p_via = 'link' then 'link' else 'pack' end, p_pack) then
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

-- A person opened a licensee link in a browser (as 0107): the first open
-- counts, not someone signed in to the same office, not once it has expired.
create or replace function public.note_licensee_link_opened(p_token uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_viewer_agency uuid := case when auth.uid() is null then null else public.current_agency_id() end;
begin
  update public.licensee_links
     set opened_at = now()
   where token = p_token and opened_at is null and revoked_at is null and expires_at > now()
     and agency_id is distinct from v_viewer_agency;
end
$$;
revoke execute on function public.note_licensee_link_opened(uuid) from public;
grant execute on function public.note_licensee_link_opened(uuid) to anon, authenticated, service_role;

-- Copy link (as 0107): the office manager or the licensee, recorded, then the token.
create or replace function public.copy_licensee_link(p_link_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_link public.licensee_links%rowtype;
  v_name text;
begin
  if auth.uid() is null or not public.runs_office() then
    raise exception 'Only the licensee in charge or the office manager can copy this link.' using errcode = '42501';
  end if;
  select * into v_link from public.licensee_links where id = p_link_id and agency_id = public.current_agency_id();
  if v_link.id is null then
    raise exception 'That link isn''t one of your office''s.' using errcode = '42501';
  end if;
  if v_link.used_at is not null or v_link.revoked_at is not null or v_link.expires_at <= now() then
    raise exception 'That link can''t be used any more. Send a new one.' using errcode = 'P0001';
  end if;
  select coalesce(nullif(btrim(full_name), ''), email) into v_name from public.profiles where id = auth.uid();
  insert into public.licensee_link_copies (link_id, agency_id, copied_by, copied_by_name)
  values (v_link.id, v_link.agency_id, auth.uid(), coalesce(v_name, 'Someone in the office'));
  return v_link.token;
end
$$;
revoke execute on function public.copy_licensee_link(uuid) from public, anon;
grant execute on function public.copy_licensee_link(uuid) to authenticated, service_role;

commit;

-- ── Check ──────────────────────────────────────────────────────────────────────
-- One row, every value true.
select
  (select is_nullable = 'YES' from information_schema.columns
    where table_schema = 'public' and table_name = 'signoff_signatures' and column_name = 'signer_id') as signs_without_login,
  to_regclass('public.licensee_links') is not null
    and not has_column_privilege('authenticated', 'public.licensee_links', 'token', 'select')
    and not has_table_privilege('anon', 'public.licensee_links', 'select') as links_token_hidden,
  not has_function_privilege('authenticated', 'public.licensee_sign_item(uuid, text, uuid, uuid, text, text, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.licensee_sign_pack(uuid, uuid, text, text, jsonb)', 'execute')
    as signing_server_only,
  has_function_privilege('anon', 'public.note_licensee_link_opened(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.copy_licensee_link(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.copy_licensee_link(uuid)', 'execute') as link_functions_ready,
  position('needs to be on RealComply' in pg_get_functiondef('public.set_licensee_signoff_mode(text)'::regprocedure)) = 0
    as monthly_without_login;
