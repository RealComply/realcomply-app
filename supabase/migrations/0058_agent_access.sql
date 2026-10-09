-- ===== 0058: an agent sees only their own work, 9 October 2026 =====
--
-- Brief: claude/RealComply-agent-access-brief-8-Oct.md (updated 9 Oct).
-- Run after 0057. Everything is in one transaction: if any statement fails,
-- nothing changes.
--
-- REVERSAL (Adam, 7 Oct 2026). Was: every member of an agency could view and
-- change every listing in it (only assistants were narrowed, in 0025). Now: an
-- agent views and changes only the listings assigned to them; an assistant
-- the listings of the agents they assist; the licensee in charge everything.
-- "Each individual agent kind of has their own dashboard. The agent and their
-- assistant are the only ones that can see the listings that are assigned to
-- them. Then the licensee can see everything."
--
-- REVERSAL (Adam, 9 Oct 2026). Was: any member could delete complaint, breach
-- and gift entries, checklist items and evidence files, with no record of who.
-- Now: "Make it so that only a licensee can delete compliance records." Every
-- delete is written to deletion_log, which goes into the 7-year pseudonymised
-- activity record.
--
-- REVERSAL (Adam, 9 Oct 2026). Was: an agent on their own plan kept the
-- complaints and breaches registers. Now: complaints are the licensee in
-- charge's only, for everyone ("Complaints should go directly to a
-- licensee"). Breaches: anyone can log their own and sees only their own; the
-- licensee sees all.
--
-- ALSO 9 OCT (Adam):
--   - The licensee's name and email, the website (listings page) and the PM
--     records system are licensee only.
--   - A sign-off can only be recorded by the person signing, is stamped with
--     who and when from the login, and is locked once signed. Replacing a
--     signed document keeps the old signature on record (signoff_signature_voids).
--
-- WHO COUNTS AS "THE LICENSEE" HERE. acts_as_licensee() is true for the
-- licensee in charge, and for the one agent on an agent plan (agent_1 to
-- agent_3), who is the licensee for their own account — except for
-- complaints, which need the actual licensee in charge on an office plan.
--
-- Cass Property: no data changes. Nothing here moves or edits a listing.

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Helpers. SECURITY DEFINER for the same reason as current_agency_id():
--    they are called from policies on the tables they read.
-- ─────────────────────────────────────────────────────────────────────────

-- The licensee in charge, on any plan. Archived people are never anyone.
create or replace function public.is_licensee_in_charge()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select me.is_licensee_in_charge from public.profiles me
                    where me.id = auth.uid() and me.archived_at is null), false);
$$;

-- The licensee in charge, or the agent on an agent plan (their own account).
create or replace function public.acts_as_licensee()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((
    select me.is_licensee_in_charge or left(a.plan, 6) = 'agent_'
      from public.profiles me
      join public.agencies a on a.id = me.agency_id
     where me.id = auth.uid() and me.archived_at is null), false);
$$;

-- Complaints only: the licensee in charge of an office. Not an agent plan.
create or replace function public.is_office_licensee()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((
    select me.is_licensee_in_charge and left(a.plan, 6) <> 'agent_'
      from public.profiles me
      join public.agencies a on a.id = me.agency_id
     where me.id = auth.uid() and me.archived_at is null), false);
$$;

-- Can the caller see work assigned to this agent? The licensee sees
-- everyone's, an agent their own, an assistant the agents they assist.
create or replace function public.can_see_agent(p_agent uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.acts_as_licensee()
      or p_agent = auth.uid()
      or (public.is_assistant() and p_agent in (select public.visible_agent_ids()));
$$;

-- Can the caller see this listing? Used by everything attached to one.
create or replace function public.can_see_property(p_property uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.properties p
     where p.id = p_property
       and p.agency_id = public.current_agency_id()
       and public.can_see_agent(p.created_by));
$$;

-- Same for a property under management, keyed on its property manager.
create or replace function public.can_see_pm_property(p_property uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.pm_properties p
     where p.id = p_property
       and p.agency_id = public.current_agency_id()
       and public.can_see_agent(p.manager_id));
$$;

-- The assistants who support the caller (for an agent seeing their own
-- assistants' names and details).
create or replace function public.my_assistant_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select a.assistant_id from public.assistant_agents a where a.agent_id = auth.uid();
$$;

-- Names only, for pickers and for "who signed this". Everyone in the office
-- can see who works there and in what role; emails, licences and CPD stay
-- behind the profiles rules below.
create or replace function public.agency_people()
returns table (
  id uuid,
  full_name text,
  is_licensee_in_charge boolean,
  is_assistant boolean,
  is_agent boolean,
  archived_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.full_name, p.is_licensee_in_charge, p.is_assistant, p.is_agent, p.archived_at
    from public.profiles p
   where p.agency_id = public.current_agency_id()
   order by p.full_name;
$$;

revoke execute on function public.is_licensee_in_charge() from public, anon;
revoke execute on function public.acts_as_licensee() from public, anon;
revoke execute on function public.is_office_licensee() from public, anon;
revoke execute on function public.can_see_agent(uuid) from public, anon;
revoke execute on function public.can_see_property(uuid) from public, anon;
revoke execute on function public.can_see_pm_property(uuid) from public, anon;
revoke execute on function public.agency_people() from public, anon;
revoke execute on function public.my_assistant_ids() from public, anon;
grant execute on function public.is_licensee_in_charge() to authenticated;
grant execute on function public.acts_as_licensee() to authenticated;
grant execute on function public.is_office_licensee() to authenticated;
grant execute on function public.can_see_agent(uuid) to authenticated;
grant execute on function public.can_see_property(uuid) to authenticated;
grant execute on function public.can_see_pm_property(uuid) to authenticated;
grant execute on function public.agency_people() to authenticated;
grant execute on function public.my_assistant_ids() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Listings and everything attached to one.
-- ─────────────────────────────────────────────────────────────────────────

drop policy if exists "properties: agency members can view" on public.properties;
drop policy if exists "properties: agency members can insert" on public.properties;
drop policy if exists "properties: agency members can update" on public.properties;
drop policy if exists "properties: licensee can delete" on public.properties;

drop policy if exists "properties: own, assisted or licensee can view" on public.properties;
create policy "properties: own, assisted or licensee can view" on public.properties
  for select using (agency_id = public.current_agency_id() and public.can_see_agent(created_by));
-- A new listing belongs to its agent. A licensee or an assistant picks which
-- agent; an agent can only create their own. The agent must be a current
-- member of this agency.
drop policy if exists "properties: create for an agent you can see" on public.properties;
create policy "properties: create for an agent you can see" on public.properties
  for insert with check (
    agency_id = public.current_agency_id()
    and public.can_see_agent(created_by)
    and exists (select 1 from public.profiles p
                 where p.id = created_by and p.agency_id = public.current_agency_id()
                   and p.archived_at is null));
-- Reassigning (a change to created_by) is still refused for anyone but the
-- licensee by guard_listing_transfer (0034).
drop policy if exists "properties: own, assisted or licensee can update" on public.properties;
create policy "properties: own, assisted or licensee can update" on public.properties
  for update using (agency_id = public.current_agency_id() and public.can_see_agent(created_by))
  with check (agency_id = public.current_agency_id() and public.can_see_agent(created_by));
drop policy if exists "properties: licensee can delete" on public.properties;
create policy "properties: licensee can delete" on public.properties
  for delete using (agency_id = public.current_agency_id() and public.acts_as_licensee());

drop policy if exists "property_items: agency members can view" on public.property_items;
drop policy if exists "property_items: agency members can insert" on public.property_items;
drop policy if exists "property_items: agency members can update" on public.property_items;
drop policy if exists "property_items: agency members can delete" on public.property_items;

drop policy if exists "property_items: whoever sees the listing can view" on public.property_items;
create policy "property_items: whoever sees the listing can view" on public.property_items
  for select using (agency_id = public.current_agency_id() and public.can_see_property(property_id));
drop policy if exists "property_items: whoever sees the listing can add" on public.property_items;
create policy "property_items: whoever sees the listing can add" on public.property_items
  for insert with check (agency_id = public.current_agency_id() and public.can_see_property(property_id));
drop policy if exists "property_items: whoever sees the listing can change" on public.property_items;
create policy "property_items: whoever sees the listing can change" on public.property_items
  for update using (agency_id = public.current_agency_id() and public.can_see_property(property_id))
  with check (agency_id = public.current_agency_id() and public.can_see_property(property_id));
drop policy if exists "property_items: licensee can delete" on public.property_items;
create policy "property_items: licensee can delete" on public.property_items
  for delete using (agency_id = public.current_agency_id() and public.acts_as_licensee());

drop policy if exists "comparables: agency members" on public.property_comparables;
drop policy if exists "comparables: whoever sees the listing can view" on public.property_comparables;
create policy "comparables: whoever sees the listing can view" on public.property_comparables
  for select using (agency_id = public.current_agency_id() and public.can_see_property(property_id));
drop policy if exists "comparables: whoever sees the listing can add" on public.property_comparables;
create policy "comparables: whoever sees the listing can add" on public.property_comparables
  for insert with check (agency_id = public.current_agency_id() and public.can_see_property(property_id));
drop policy if exists "comparables: whoever sees the listing can change" on public.property_comparables;
create policy "comparables: whoever sees the listing can change" on public.property_comparables
  for update using (agency_id = public.current_agency_id() and public.can_see_property(property_id))
  with check (agency_id = public.current_agency_id() and public.can_see_property(property_id));
drop policy if exists "comparables: licensee can delete" on public.property_comparables;
create policy "comparables: licensee can delete" on public.property_comparables
  for delete using (agency_id = public.current_agency_id() and public.acts_as_licensee());

drop policy if exists "market listings: agency members" on public.property_market_listings;
drop policy if exists "market listings: whoever sees the listing can view" on public.property_market_listings;
create policy "market listings: whoever sees the listing can view" on public.property_market_listings
  for select using (agency_id = public.current_agency_id() and public.can_see_property(property_id));
drop policy if exists "market listings: whoever sees the listing can add" on public.property_market_listings;
create policy "market listings: whoever sees the listing can add" on public.property_market_listings
  for insert with check (agency_id = public.current_agency_id() and public.can_see_property(property_id));
drop policy if exists "market listings: whoever sees the listing can change" on public.property_market_listings;
create policy "market listings: whoever sees the listing can change" on public.property_market_listings
  for update using (agency_id = public.current_agency_id() and public.can_see_property(property_id))
  with check (agency_id = public.current_agency_id() and public.can_see_property(property_id));
drop policy if exists "market listings: licensee can delete" on public.property_market_listings;
create policy "market listings: licensee can delete" on public.property_market_listings
  for delete using (agency_id = public.current_agency_id() and public.acts_as_licensee());

drop policy if exists "signoff requests: agency members can view" on public.property_signoff_requests;
drop policy if exists "signoff requests: agency members can issue" on public.property_signoff_requests;
drop policy if exists "signoff requests: agency members can revoke" on public.property_signoff_requests;
drop policy if exists "signoff requests: whoever sees the listing can view" on public.property_signoff_requests;
create policy "signoff requests: whoever sees the listing can view" on public.property_signoff_requests
  for select using (agency_id = public.current_agency_id() and public.can_see_property(property_id));
drop policy if exists "signoff requests: whoever sees the listing can issue" on public.property_signoff_requests;
create policy "signoff requests: whoever sees the listing can issue" on public.property_signoff_requests
  for insert with check (agency_id = public.current_agency_id() and public.can_see_property(property_id)
                         and created_by = auth.uid());
drop policy if exists "signoff requests: whoever sees the listing can revoke" on public.property_signoff_requests;
create policy "signoff requests: whoever sees the listing can revoke" on public.property_signoff_requests
  for update using (agency_id = public.current_agency_id() and public.can_see_property(property_id))
  with check (agency_id = public.current_agency_id() and public.can_see_property(property_id));
-- The app may record a revoke and how the email went. Nothing else: the
-- signed date and name are written only by submit_signoff().
revoke update on public.property_signoff_requests from authenticated, anon;
grant update (revoked_at, email_sent_at, email_attempts, email_error)
  on public.property_signoff_requests to authenticated;

-- The link always goes to the licensee email on the agency (which only the
-- licensee can now change), whatever the browser sends.
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
drop trigger if exists property_signoff_requests_insert_guard on public.property_signoff_requests;
create trigger property_signoff_requests_insert_guard
  before insert on public.property_signoff_requests
  for each row execute function public.guard_signoff_request_insert();

drop policy if exists "property_transfers: agency members can view" on public.property_transfers;
drop policy if exists "property_transfers: whoever sees the listing can view" on public.property_transfers;
create policy "property_transfers: whoever sees the listing can view" on public.property_transfers
  for select using (agency_id = public.current_agency_id() and public.can_see_property(property_id));

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Sign-offs on a listing: only by the person signing, locked once signed.
--    sign_licensee and b4 (the licensee's approval of the price statement)
--    are the licensee in charge's; sign_agent is the listing's own agent's.
--    The outside licensee's link (submit_signoff) runs with higher rights
--    and is not affected.
-- ─────────────────────────────────────────────────────────────────────────

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
drop trigger if exists property_items_signoff_guard on public.property_items;
create trigger property_items_signoff_guard
  before insert or update on public.property_items
  for each row execute function public.guard_listing_signoff();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Office documents for sign-off (trust reconciliations, SG Manual).
-- ─────────────────────────────────────────────────────────────────────────

drop policy if exists "signoff_documents: agency members can view" on public.signoff_documents;
drop policy if exists "signoff_documents: agency members can insert" on public.signoff_documents;
drop policy if exists "signoff_documents: agency members can update" on public.signoff_documents;
drop policy if exists "signoff_documents: agency members can delete" on public.signoff_documents;

drop policy if exists "signoff_documents: licensee, uploader or signer can view" on public.signoff_documents;
create policy "signoff_documents: licensee, uploader or signer can view" on public.signoff_documents
  for select using (
    agency_id = public.current_agency_id()
    and (public.acts_as_licensee()
         or uploaded_by = auth.uid()
         or exists (select 1 from public.signoff_signatures s
                     where s.document_id = signoff_documents.id and s.signer_id = auth.uid())));
drop policy if exists "signoff_documents: licensee can add" on public.signoff_documents;
create policy "signoff_documents: licensee can add" on public.signoff_documents
  for insert with check (agency_id = public.current_agency_id() and public.acts_as_licensee());
-- A signer may attach the signed copy (signed_file_path) after signing; the
-- trigger below stops them changing anything else.
drop policy if exists "signoff_documents: licensee or signer can update" on public.signoff_documents;
create policy "signoff_documents: licensee or signer can update" on public.signoff_documents
  for update using (
    agency_id = public.current_agency_id()
    and (public.acts_as_licensee()
         or exists (select 1 from public.signoff_signatures s
                     where s.document_id = signoff_documents.id and s.signer_id = auth.uid())))
  with check (agency_id = public.current_agency_id());
drop policy if exists "signoff_documents: licensee can delete" on public.signoff_documents;
create policy "signoff_documents: licensee can delete" on public.signoff_documents
  for delete using (agency_id = public.current_agency_id() and public.acts_as_licensee());

create or replace function public.guard_signoff_document_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.acts_as_licensee() then
    return new;
  end if;
  if (to_jsonb(new) - 'signed_file_path' - 'signed_file_name')
     is distinct from (to_jsonb(old) - 'signed_file_path' - 'signed_file_name') then
    raise exception 'Only the licensee in charge can change this document.';
  end if;
  return new;
end
$$;
revoke execute on function public.guard_signoff_document_update() from public, anon, authenticated;
drop trigger if exists signoff_documents_update_guard on public.signoff_documents;
create trigger signoff_documents_update_guard
  before update on public.signoff_documents
  for each row execute function public.guard_signoff_document_update();

drop policy if exists "signoff_signatures: agency members can view" on public.signoff_signatures;
drop policy if exists "signoff_signatures: agency members can insert" on public.signoff_signatures;
drop policy if exists "signoff_signatures: signer can sign their own row" on public.signoff_signatures;

drop policy if exists "signoff_signatures: licensee or signer can view" on public.signoff_signatures;
create policy "signoff_signatures: licensee or signer can view" on public.signoff_signatures
  for select using (agency_id = public.current_agency_id()
                    and (public.acts_as_licensee() or signer_id = auth.uid()));
-- The licensee sets up who has to sign (unsigned rows); a signer may add
-- their own signed row.
drop policy if exists "signoff_signatures: licensee lists signers, signer signs own" on public.signoff_signatures;
create policy "signoff_signatures: licensee lists signers, signer signs own" on public.signoff_signatures
  for insert with check (
    agency_id = public.current_agency_id()
    and ((public.acts_as_licensee() and signed_at is null) or signer_id = auth.uid()));
drop policy if exists "signoff_signatures: signer can sign their own row" on public.signoff_signatures;
create policy "signoff_signatures: signer can sign their own row" on public.signoff_signatures
  for update using (agency_id = public.current_agency_id() and signer_id = auth.uid())
  with check (agency_id = public.current_agency_id() and signer_id = auth.uid());

create or replace function public.guard_signoff_signature()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.signed_at is not null then
    raise exception 'This signature is already recorded and can''t be changed.';
  end if;
  if new.signed_at is not null then
    if new.signer_id is distinct from auth.uid() then
      raise exception 'Only the person signing can record their signature.';
    end if;
    new.signed_at := now();
    select coalesce(nullif(btrim(me.full_name), ''), me.email) into new.typed_name
      from public.profiles me where me.id = auth.uid();
  else
    new.typed_name := null;
  end if;
  return new;
end
$$;
revoke execute on function public.guard_signoff_signature() from public, anon, authenticated;
drop trigger if exists signoff_signatures_guard on public.signoff_signatures;
create trigger signoff_signatures_guard
  before insert or update on public.signoff_signatures
  for each row execute function public.guard_signoff_signature();

-- Replacing a signed document (Adam, 9 Oct, option a): the replace still
-- works, the old signature is kept here with the file it was given on, and
-- the signer signs the new file.
create table if not exists public.signoff_signature_voids (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  document_id uuid not null,
  signer_id uuid,
  typed_name text,
  signed_at timestamptz,
  file_path text,
  file_name text,
  signed_file_path text,
  voided_by uuid,
  voided_at timestamptz not null default now()
);
alter table public.signoff_signature_voids enable row level security;
drop policy if exists "signoff_signature_voids: licensee can view" on public.signoff_signature_voids;
create policy "signoff_signature_voids: licensee can view" on public.signoff_signature_voids
  for select using (agency_id = public.current_agency_id() and public.acts_as_licensee());

create or replace function public.void_document_signatures(p_document_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.signoff_documents;
  v_count integer;
begin
  select * into v_doc from public.signoff_documents
   where id = p_document_id and agency_id = public.current_agency_id();
  if v_doc.id is null then
    raise exception 'Document not found.';
  end if;
  if not public.acts_as_licensee() then
    raise exception 'Only the licensee in charge can replace a signed document.';
  end if;

  insert into public.signoff_signature_voids
    (agency_id, document_id, signer_id, typed_name, signed_at,
     file_path, file_name, signed_file_path, voided_by)
  select s.agency_id, s.document_id, s.signer_id, s.typed_name, s.signed_at,
         v_doc.file_path, v_doc.file_name, v_doc.signed_file_path, auth.uid()
    from public.signoff_signatures s
   where s.document_id = p_document_id and s.signed_at is not null;
  get diagnostics v_count = row_count;

  update public.signoff_signatures
     set signed_at = null, typed_name = null
   where document_id = p_document_id and signed_at is not null;

  return v_count;
end
$$;
revoke execute on function public.void_document_signatures(uuid) from public, anon;
grant execute on function public.void_document_signatures(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. People. Everyone sees themselves; the licensee sees the office; an
--    assistant sees the agents they assist and an agent their assistants.
--    Names for everyone else come from agency_people().
-- ─────────────────────────────────────────────────────────────────────────

drop policy if exists "profiles: agency members can view each other" on public.profiles;
drop policy if exists "profiles: self, licensee, or assistant pair can view" on public.profiles;
create policy "profiles: self, licensee, or assistant pair can view" on public.profiles
  for select using (
    agency_id = public.current_agency_id()
    and (id = auth.uid()
         or public.acts_as_licensee()
         or (public.is_assistant() and id in (select public.visible_agent_ids()))
         or id in (select public.my_assistant_ids())));

-- The licensee's right to update people in the office, rewritten to use
-- is_licensee_in_charge() instead of reading profiles inside a profiles
-- policy (which Postgres refuses as recursion once the view rule above has
-- a sub-query of its own). Same meaning as 0004.
drop policy if exists "profiles: licensee can update agency members" on public.profiles;
create policy "profiles: licensee can update agency members" on public.profiles
  for update using (agency_id = public.current_agency_id() and public.is_licensee_in_charge());

drop policy if exists "assistant_agents: agency members can view" on public.assistant_agents;
drop policy if exists "assistant_agents: licensee or either person can view" on public.assistant_agents;
create policy "assistant_agents: licensee or either person can view" on public.assistant_agents
  for select using (agency_id = public.current_agency_id()
                    and (public.acts_as_licensee() or assistant_id = auth.uid() or agent_id = auth.uid()));

drop policy if exists "agency_invites: agency members can view" on public.agency_invites;
drop policy if exists "agency_invites: licensee can view" on public.agency_invites;
create policy "agency_invites: licensee can view" on public.agency_invites
  for select using (agency_id = public.current_agency_id() and public.acts_as_licensee());

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Registers.
-- ─────────────────────────────────────────────────────────────────────────

-- Gifts: anyone can add their own; sees the entries they logged. Licensee all.
drop policy if exists "gifts: agency members can view" on public.gifts;
drop policy if exists "gifts: agency members can insert" on public.gifts;
drop policy if exists "gifts: agency members can update" on public.gifts;
drop policy if exists "gifts: agency members can delete" on public.gifts;
drop policy if exists "gifts: licensee or whoever logged it can view" on public.gifts;
create policy "gifts: licensee or whoever logged it can view" on public.gifts
  for select using (agency_id = public.current_agency_id()
                    and (public.acts_as_licensee() or created_by = auth.uid()));
drop policy if exists "gifts: anyone can log their own" on public.gifts;
create policy "gifts: anyone can log their own" on public.gifts
  for insert with check (agency_id = public.current_agency_id() and created_by = auth.uid()
                         and (public.acts_as_licensee() or profile_id = auth.uid()));
drop policy if exists "gifts: licensee can update" on public.gifts;
create policy "gifts: licensee can update" on public.gifts
  for update using (agency_id = public.current_agency_id() and public.acts_as_licensee());
drop policy if exists "gifts: licensee can delete" on public.gifts;
create policy "gifts: licensee can delete" on public.gifts
  for delete using (agency_id = public.current_agency_id() and public.acts_as_licensee());

-- Complaints: the licensee in charge of an office only (Adam, 9 Oct).
drop policy if exists "complaints: agency members can view" on public.complaints;
drop policy if exists "complaints: agency members can insert" on public.complaints;
drop policy if exists "complaints: agency members can update" on public.complaints;
drop policy if exists "complaints: agency members can delete" on public.complaints;
drop policy if exists "complaints: licensee in charge can view" on public.complaints;
create policy "complaints: licensee in charge can view" on public.complaints
  for select using (agency_id = public.current_agency_id() and public.is_office_licensee());
drop policy if exists "complaints: licensee in charge can add" on public.complaints;
create policy "complaints: licensee in charge can add" on public.complaints
  for insert with check (agency_id = public.current_agency_id() and public.is_office_licensee());
drop policy if exists "complaints: licensee in charge can update" on public.complaints;
create policy "complaints: licensee in charge can update" on public.complaints
  for update using (agency_id = public.current_agency_id() and public.is_office_licensee());
drop policy if exists "complaints: licensee in charge can delete" on public.complaints;
create policy "complaints: licensee in charge can delete" on public.complaints
  for delete using (agency_id = public.current_agency_id() and public.is_office_licensee());

-- Breaches: anyone can log their own and sees only those they logged
-- (Adam, 9 Oct). The licensee sees and closes all; deleting is theirs only.
drop policy if exists "breaches: agency members can view" on public.breaches;
drop policy if exists "breaches: agency members can insert" on public.breaches;
drop policy if exists "breaches: agency members can update" on public.breaches;
drop policy if exists "breaches: agency members can delete" on public.breaches;
drop policy if exists "breaches: licensee or whoever logged it can view" on public.breaches;
create policy "breaches: licensee or whoever logged it can view" on public.breaches
  for select using (agency_id = public.current_agency_id()
                    and (public.acts_as_licensee() or created_by = auth.uid()));
drop policy if exists "breaches: anyone can log their own" on public.breaches;
create policy "breaches: anyone can log their own" on public.breaches
  for insert with check (agency_id = public.current_agency_id() and created_by = auth.uid()
                         and (public.acts_as_licensee() or agent_id is null or agent_id = auth.uid()));
drop policy if exists "breaches: licensee or whoever logged it can update" on public.breaches;
create policy "breaches: licensee or whoever logged it can update" on public.breaches
  for update using (agency_id = public.current_agency_id()
                    and (public.acts_as_licensee() or created_by = auth.uid()))
  with check (agency_id = public.current_agency_id()
              and (public.acts_as_licensee() or created_by = auth.uid()));
drop policy if exists "breaches: licensee can delete" on public.breaches;
create policy "breaches: licensee can delete" on public.breaches
  for delete using (agency_id = public.current_agency_id() and public.acts_as_licensee());

-- SG Manual: everyone reads; the licensee uploads and removes.
drop policy if exists "sg_manual_versions: agency members can view" on public.sg_manual_versions;
drop policy if exists "sg_manual_versions: agency members can insert" on public.sg_manual_versions;
drop policy if exists "sg_manual_versions: agency members can delete" on public.sg_manual_versions;
drop policy if exists "sg_manual_versions: agency members can view" on public.sg_manual_versions;
create policy "sg_manual_versions: agency members can view" on public.sg_manual_versions
  for select using (agency_id = public.current_agency_id());
drop policy if exists "sg_manual_versions: licensee can add" on public.sg_manual_versions;
create policy "sg_manual_versions: licensee can add" on public.sg_manual_versions
  for insert with check (agency_id = public.current_agency_id() and public.acts_as_licensee());
drop policy if exists "sg_manual_versions: licensee can delete" on public.sg_manual_versions;
create policy "sg_manual_versions: licensee can delete" on public.sg_manual_versions
  for delete using (agency_id = public.current_agency_id() and public.acts_as_licensee());

-- ─────────────────────────────────────────────────────────────────────────
-- 7. CPD, training and licences: own, or the licensee's.
-- ─────────────────────────────────────────────────────────────────────────

drop policy if exists "cpd_records: agency members can view" on public.cpd_records;
drop policy if exists "cpd_records: agency members can insert" on public.cpd_records;
drop policy if exists "cpd_records: agency members can update" on public.cpd_records;
drop policy if exists "cpd_records: agency members can delete" on public.cpd_records;
drop policy if exists "cpd_records: own or licensee can view" on public.cpd_records;
create policy "cpd_records: own or licensee can view" on public.cpd_records
  for select using (agency_id = public.current_agency_id()
                    and (public.acts_as_licensee() or profile_id = auth.uid()));
drop policy if exists "cpd_records: own or licensee can add" on public.cpd_records;
create policy "cpd_records: own or licensee can add" on public.cpd_records
  for insert with check (agency_id = public.current_agency_id()
                         and (public.acts_as_licensee() or profile_id = auth.uid()));
drop policy if exists "cpd_records: own or licensee can update" on public.cpd_records;
create policy "cpd_records: own or licensee can update" on public.cpd_records
  for update using (agency_id = public.current_agency_id()
                    and (public.acts_as_licensee() or profile_id = auth.uid()))
  with check (agency_id = public.current_agency_id()
              and (public.acts_as_licensee() or profile_id = auth.uid()));
drop policy if exists "cpd_records: licensee can delete" on public.cpd_records;
create policy "cpd_records: licensee can delete" on public.cpd_records
  for delete using (agency_id = public.current_agency_id() and public.acts_as_licensee());

drop policy if exists "cpd_year_signoffs: agency members can view" on public.cpd_year_signoffs;
drop policy if exists "cpd_year_signoffs: agency members can insert" on public.cpd_year_signoffs;
drop policy if exists "cpd_year_signoffs: agency members can delete" on public.cpd_year_signoffs;
drop policy if exists "cpd_year_signoffs: own or licensee can view" on public.cpd_year_signoffs;
create policy "cpd_year_signoffs: own or licensee can view" on public.cpd_year_signoffs
  for select using (agency_id = public.current_agency_id()
                    and (public.acts_as_licensee() or profile_id = auth.uid()));
drop policy if exists "cpd_year_signoffs: own or licensee can add" on public.cpd_year_signoffs;
create policy "cpd_year_signoffs: own or licensee can add" on public.cpd_year_signoffs
  for insert with check (agency_id = public.current_agency_id()
                         and (public.acts_as_licensee() or profile_id = auth.uid()));
drop policy if exists "cpd_year_signoffs: licensee can delete" on public.cpd_year_signoffs;
create policy "cpd_year_signoffs: licensee can delete" on public.cpd_year_signoffs
  for delete using (agency_id = public.current_agency_id() and public.acts_as_licensee());

-- Office training sessions: the licensee runs them; people see the ones
-- they attended.
drop policy if exists "training_sessions: agency members can view" on public.training_sessions;
drop policy if exists "training_sessions: agency members can insert" on public.training_sessions;
drop policy if exists "training_sessions: agency members can update" on public.training_sessions;
drop policy if exists "training_sessions: agency members can delete" on public.training_sessions;
drop policy if exists "training_sessions: licensee or attendee can view" on public.training_sessions;
create policy "training_sessions: licensee or attendee can view" on public.training_sessions
  for select using (agency_id = public.current_agency_id()
                    and (public.acts_as_licensee()
                         or exists (select 1 from public.training_attendance t
                                     where t.session_id = training_sessions.id and t.profile_id = auth.uid())));
drop policy if exists "training_sessions: licensee can add" on public.training_sessions;
create policy "training_sessions: licensee can add" on public.training_sessions
  for insert with check (agency_id = public.current_agency_id() and public.acts_as_licensee());
drop policy if exists "training_sessions: licensee can update" on public.training_sessions;
create policy "training_sessions: licensee can update" on public.training_sessions
  for update using (agency_id = public.current_agency_id() and public.acts_as_licensee());
drop policy if exists "training_sessions: licensee can delete" on public.training_sessions;
create policy "training_sessions: licensee can delete" on public.training_sessions
  for delete using (agency_id = public.current_agency_id() and public.acts_as_licensee());

drop policy if exists "training_attendance: agency members can view" on public.training_attendance;
drop policy if exists "training_attendance: agency members can insert" on public.training_attendance;
drop policy if exists "training_attendance: agency members can delete" on public.training_attendance;
drop policy if exists "training_attendance: own or licensee can view" on public.training_attendance;
create policy "training_attendance: own or licensee can view" on public.training_attendance
  for select using (agency_id = public.current_agency_id()
                    and (public.acts_as_licensee() or profile_id = auth.uid()));
drop policy if exists "training_attendance: licensee can add" on public.training_attendance;
create policy "training_attendance: licensee can add" on public.training_attendance
  for insert with check (agency_id = public.current_agency_id() and public.acts_as_licensee());
drop policy if exists "training_attendance: licensee can delete" on public.training_attendance;
create policy "training_attendance: licensee can delete" on public.training_attendance
  for delete using (agency_id = public.current_agency_id() and public.acts_as_licensee());

drop policy if exists "training_plans: agency members can view" on public.training_plans;
drop policy if exists "training_plans: agency members can insert" on public.training_plans;
drop policy if exists "training_plans: agency members can update" on public.training_plans;
drop policy if exists "training_plans: agency members can delete" on public.training_plans;
drop policy if exists "training_plans: own or licensee can view" on public.training_plans;
create policy "training_plans: own or licensee can view" on public.training_plans
  for select using (agency_id = public.current_agency_id()
                    and (public.acts_as_licensee() or profile_id = auth.uid()));
drop policy if exists "training_plans: own or licensee can add" on public.training_plans;
create policy "training_plans: own or licensee can add" on public.training_plans
  for insert with check (agency_id = public.current_agency_id()
                         and (public.acts_as_licensee() or profile_id = auth.uid()));
drop policy if exists "training_plans: own or licensee can update" on public.training_plans;
create policy "training_plans: own or licensee can update" on public.training_plans
  for update using (agency_id = public.current_agency_id()
                    and (public.acts_as_licensee() or profile_id = auth.uid()))
  with check (agency_id = public.current_agency_id()
              and (public.acts_as_licensee() or profile_id = auth.uid()));
drop policy if exists "training_plans: licensee can delete" on public.training_plans;
create policy "training_plans: licensee can delete" on public.training_plans
  for delete using (agency_id = public.current_agency_id() and public.acts_as_licensee());

-- The two signatures on a training plan are sign-offs too: the staff member
-- signs their own, the licensee signs as principal.
create or replace function public.guard_training_plan_signatures()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if (new.staff_signed_name, new.staff_signed_at)
     is distinct from (old.staff_signed_name, old.staff_signed_at)
     and new.profile_id is distinct from auth.uid()
     and not (new.staff_signed_at is null and public.acts_as_licensee()) then
    raise exception 'Only the staff member can sign their own training plan.';
  end if;
  if (new.principal_signed_name, new.principal_signed_at)
     is distinct from (old.principal_signed_name, old.principal_signed_at)
     and not public.acts_as_licensee() then
    raise exception 'Only the licensee in charge can sign as principal.';
  end if;
  return new;
end
$$;
revoke execute on function public.guard_training_plan_signatures() from public, anon, authenticated;
drop trigger if exists training_plans_signature_guard on public.training_plans;
create trigger training_plans_signature_guard
  before update on public.training_plans
  for each row execute function public.guard_training_plan_signatures();

drop policy if exists "training_plan_items: agency members can view" on public.training_plan_items;
drop policy if exists "training_plan_items: agency members can insert" on public.training_plan_items;
drop policy if exists "training_plan_items: agency members can update" on public.training_plan_items;
drop policy if exists "training_plan_items: agency members can delete" on public.training_plan_items;
drop policy if exists "training_plan_items: own plan or licensee can view" on public.training_plan_items;
create policy "training_plan_items: own plan or licensee can view" on public.training_plan_items
  for select using (agency_id = public.current_agency_id()
                    and exists (select 1 from public.training_plans tp
                                 where tp.id = plan_id
                                   and (public.acts_as_licensee() or tp.profile_id = auth.uid())));
drop policy if exists "training_plan_items: own plan or licensee can add" on public.training_plan_items;
create policy "training_plan_items: own plan or licensee can add" on public.training_plan_items
  for insert with check (agency_id = public.current_agency_id()
                         and exists (select 1 from public.training_plans tp
                                      where tp.id = plan_id
                                        and (public.acts_as_licensee() or tp.profile_id = auth.uid())));
drop policy if exists "training_plan_items: own plan or licensee can update" on public.training_plan_items;
create policy "training_plan_items: own plan or licensee can update" on public.training_plan_items
  for update using (agency_id = public.current_agency_id()
                    and exists (select 1 from public.training_plans tp
                                 where tp.id = plan_id
                                   and (public.acts_as_licensee() or tp.profile_id = auth.uid())));
drop policy if exists "training_plan_items: licensee can delete" on public.training_plan_items;
create policy "training_plan_items: licensee can delete" on public.training_plan_items
  for delete using (agency_id = public.current_agency_id() and public.acts_as_licensee());

drop policy if exists "licence history: agency members can view" on public.licence_history;
drop policy if exists "licence history: agency members can add" on public.licence_history;
drop policy if exists "licence history: own or licensee can view" on public.licence_history;
create policy "licence history: own or licensee can view" on public.licence_history
  for select using (agency_id = public.current_agency_id()
                    and (public.acts_as_licensee() or profile_id = auth.uid()));
drop policy if exists "licence history: own or licensee can add" on public.licence_history;
create policy "licence history: own or licensee can add" on public.licence_history
  for insert with check (agency_id = public.current_agency_id()
                         and (public.acts_as_licensee() or profile_id = auth.uid()));

drop policy if exists "licence_reminders: agency members can view" on public.licence_reminders;
drop policy if exists "licence_reminders: own or licensee can view" on public.licence_reminders;
create policy "licence_reminders: own or licensee can view" on public.licence_reminders
  for select using (agency_id = public.current_agency_id()
                    and (public.acts_as_licensee() or profile_id = auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Trust accounts: the licensee only.
-- ─────────────────────────────────────────────────────────────────────────

drop policy if exists "trust_accounts: agency members can view" on public.trust_accounts;
drop policy if exists "trust_accounts: licensee can view" on public.trust_accounts;
create policy "trust_accounts: licensee can view" on public.trust_accounts
  for select using (agency_id = public.current_agency_id() and public.acts_as_licensee());
drop policy if exists "trust_audits: agency members can view" on public.trust_audits;
drop policy if exists "trust_audits: licensee can view" on public.trust_audits;
create policy "trust_audits: licensee can view" on public.trust_audits
  for select using (agency_id = public.current_agency_id() and public.acts_as_licensee());
drop policy if exists "trust_reminders: agency members can view" on public.trust_reminders;
drop policy if exists "trust_reminders: licensee can view" on public.trust_reminders;
create policy "trust_reminders: licensee can view" on public.trust_reminders
  for select using (agency_id = public.current_agency_id() and public.acts_as_licensee());

-- ─────────────────────────────────────────────────────────────────────────
-- 9. Property management: by property manager.
-- ─────────────────────────────────────────────────────────────────────────

drop policy if exists "pm_properties: agency members can view" on public.pm_properties;
drop policy if exists "pm_properties: agency members can add" on public.pm_properties;
drop policy if exists "pm_properties: agency members can change" on public.pm_properties;
drop policy if exists "pm_properties: manager, assistant or licensee can view" on public.pm_properties;
create policy "pm_properties: manager, assistant or licensee can view" on public.pm_properties
  for select using (agency_id = public.current_agency_id() and public.can_see_agent(manager_id));
drop policy if exists "pm_properties: manager, assistant or licensee can add" on public.pm_properties;
create policy "pm_properties: manager, assistant or licensee can add" on public.pm_properties
  for insert with check (agency_id = public.current_agency_id() and public.can_see_agent(manager_id));
drop policy if exists "pm_properties: manager, assistant or licensee can change" on public.pm_properties;
create policy "pm_properties: manager, assistant or licensee can change" on public.pm_properties
  for update using (agency_id = public.current_agency_id() and public.can_see_agent(manager_id))
  with check (agency_id = public.current_agency_id() and public.can_see_agent(manager_id));

drop policy if exists "pm_tenancies: agency members can view" on public.pm_tenancies;
drop policy if exists "pm_tenancies: agency members can add" on public.pm_tenancies;
drop policy if exists "pm_tenancies: agency members can change" on public.pm_tenancies;
drop policy if exists "pm_tenancies: whoever sees the property can view" on public.pm_tenancies;
create policy "pm_tenancies: whoever sees the property can view" on public.pm_tenancies
  for select using (agency_id = public.current_agency_id() and public.can_see_pm_property(property_id));
drop policy if exists "pm_tenancies: whoever sees the property can add" on public.pm_tenancies;
create policy "pm_tenancies: whoever sees the property can add" on public.pm_tenancies
  for insert with check (agency_id = public.current_agency_id() and public.can_see_pm_property(property_id));
drop policy if exists "pm_tenancies: whoever sees the property can change" on public.pm_tenancies;
create policy "pm_tenancies: whoever sees the property can change" on public.pm_tenancies
  for update using (agency_id = public.current_agency_id() and public.can_see_pm_property(property_id))
  with check (agency_id = public.current_agency_id() and public.can_see_pm_property(property_id));

drop policy if exists "pm_item_states: agency members can view" on public.pm_item_states;
drop policy if exists "pm_item_states: agency members can add" on public.pm_item_states;
drop policy if exists "pm_item_states: agency members can change" on public.pm_item_states;
drop policy if exists "pm_item_states: whoever sees the property can view" on public.pm_item_states;
create policy "pm_item_states: whoever sees the property can view" on public.pm_item_states
  for select using (agency_id = public.current_agency_id() and public.can_see_pm_property(property_id));
drop policy if exists "pm_item_states: whoever sees the property can add" on public.pm_item_states;
create policy "pm_item_states: whoever sees the property can add" on public.pm_item_states
  for insert with check (agency_id = public.current_agency_id() and public.can_see_pm_property(property_id));
drop policy if exists "pm_item_states: whoever sees the property can change" on public.pm_item_states;
create policy "pm_item_states: whoever sees the property can change" on public.pm_item_states
  for update using (agency_id = public.current_agency_id() and public.can_see_pm_property(property_id))
  with check (agency_id = public.current_agency_id() and public.can_see_pm_property(property_id));

drop policy if exists "pm_item_events: agency members can view" on public.pm_item_events;
drop policy if exists "pm_item_events: whoever sees the property can view" on public.pm_item_events;
create policy "pm_item_events: whoever sees the property can view" on public.pm_item_events
  for select using (agency_id = public.current_agency_id() and public.can_see_pm_property(property_id));

drop policy if exists "pm_records: agency members can view" on public.pm_records;
drop policy if exists "pm_records: agency members can add" on public.pm_records;
drop policy if exists "pm_records: agency members can mark a response given" on public.pm_records;
drop policy if exists "pm_records: whoever sees the property can view" on public.pm_records;
create policy "pm_records: whoever sees the property can view" on public.pm_records
  for select using (agency_id = public.current_agency_id() and public.can_see_pm_property(property_id));
drop policy if exists "pm_records: whoever sees the property can add" on public.pm_records;
create policy "pm_records: whoever sees the property can add" on public.pm_records
  for insert with check (agency_id = public.current_agency_id() and public.can_see_pm_property(property_id));
drop policy if exists "pm_records: whoever sees the property can mark a response given" on public.pm_records;
create policy "pm_records: whoever sees the property can mark a response given" on public.pm_records
  for update using (agency_id = public.current_agency_id() and public.can_see_pm_property(property_id))
  with check (agency_id = public.current_agency_id() and public.can_see_pm_property(property_id));

drop policy if exists "pm_group_moves: agency members can view" on public.pm_group_moves;
drop policy if exists "pm_group_moves: agency members can add" on public.pm_group_moves;
drop policy if exists "pm_group_moves: whoever sees the property can view" on public.pm_group_moves;
create policy "pm_group_moves: whoever sees the property can view" on public.pm_group_moves
  for select using (agency_id = public.current_agency_id() and public.can_see_pm_property(property_id));
drop policy if exists "pm_group_moves: whoever sees the property can add" on public.pm_group_moves;
create policy "pm_group_moves: whoever sees the property can add" on public.pm_group_moves
  for insert with check (agency_id = public.current_agency_id() and public.can_see_pm_property(property_id));

-- ─────────────────────────────────────────────────────────────────────────
-- 10. Agency details: licensee only (Adam, 9 Oct). The one exception is an
--     office with no licensee in charge recorded yet — a brand-new sign-up
--     whose founder said they are not the licensee — so sign-up can still
--     save the licensee's name and the website. Same rule as
--     set_licensee_in_charge (0029).
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.may_change_agency_details()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_agency_id() is not null
     and (public.acts_as_licensee()
          or not exists (select 1 from public.profiles p
                          where p.agency_id = public.current_agency_id()
                            and p.is_licensee_in_charge and p.archived_at is null));
$$;
revoke execute on function public.may_change_agency_details() from public, anon;
grant execute on function public.may_change_agency_details() to authenticated;

create or replace function public.set_agency_licensee(p_name text, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.may_change_agency_details() then
    raise exception 'Only the licensee in charge can change the licensee''s details.';
  end if;
  update public.agencies
     set licensee_name = nullif(btrim(p_name), ''),
         licensee_email = nullif(btrim(p_email), '')
   where id = public.current_agency_id();
end
$$;

create or replace function public.set_agency_licensee_email(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.may_change_agency_details() then
    raise exception 'Only the licensee in charge can change the licensee''s email.';
  end if;
  update public.agencies
     set licensee_email = nullif(btrim(p_email), '')
   where id = public.current_agency_id();
end
$$;

create or replace function public.set_agency_website(p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.may_change_agency_details() then
    raise exception 'Only the licensee in charge can change the listings page.';
  end if;
  update public.agencies
     set website_url = nullif(btrim(p_url), '')
   where id = public.current_agency_id();
end
$$;

create or replace function public.set_agency_pm_records_system(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if v_agency is null then
    raise exception 'not authenticated';
  end if;
  if not public.may_change_agency_details() then
    raise exception 'Only the licensee in charge can change the records system.';
  end if;
  if v_name is not null and length(v_name) > 80 then
    raise exception 'Keep the name of the records system under 80 characters.';
  end if;
  update public.agencies set pm_records_system = v_name where id = v_agency;
end
$$;

-- None of the four is for signed-out visitors.
revoke execute on function public.set_agency_licensee(text, text) from public, anon;
revoke execute on function public.set_agency_licensee_email(text) from public, anon;
revoke execute on function public.set_agency_website(text) from public, anon;
revoke execute on function public.set_agency_pm_records_system(text) from public, anon;
grant execute on function public.set_agency_licensee(text, text) to authenticated;
grant execute on function public.set_agency_licensee_email(text) to authenticated;
grant execute on function public.set_agency_website(text) to authenticated;
grant execute on function public.set_agency_pm_records_system(text) to authenticated;

-- Direct updates to the agency row: the licensee in charge, or the agent on
-- an agent plan for their own account. Billing columns stay guarded by 0044.
drop policy if exists "agencies: licensee can update own agency" on public.agencies;
create policy "agencies: licensee can update own agency" on public.agencies
  for update using (id = public.current_agency_id() and public.acts_as_licensee());

-- ─────────────────────────────────────────────────────────────────────────
-- 11. Uploaded files (bucket compliance-evidence). Paths are
--     {agency}/{listing}/..., {agency}/_licences/{person}/...,
--     {agency}/_cpd/{person}/..., {agency}/_brand/..., {agency}/_sg-manual/...,
--     {agency}/_signoffs/..., {agency}/_pending/... (see src/lib/storage/evidence.ts).
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.evidence_path_readable(p_name text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_seg text[] := storage.foldername(p_name);
begin
  if public.current_agency_id() is null or v_seg[1] is distinct from public.current_agency_id()::text then
    return false;
  end if;
  if public.acts_as_licensee() then
    return true;
  end if;
  if v_seg[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return public.can_see_property(v_seg[2]::uuid);
  end if;
  if v_seg[2] in ('_licences', '_cpd') then
    return v_seg[3] = auth.uid()::text;
  end if;
  if v_seg[2] in ('_brand', '_sg-manual', '_pending') then
    return true;
  end if;
  if v_seg[2] = '_signoffs' then
    return exists (
      select 1 from public.signoff_documents d
       where d.agency_id = public.current_agency_id()
         and (d.file_path = p_name or d.signed_file_path = p_name)
         and (d.uploaded_by = auth.uid()
              or exists (select 1 from public.signoff_signatures s
                          where s.document_id = d.id and s.signer_id = auth.uid())));
  end if;
  return false;
end
$$;

create or replace function public.evidence_path_writable(p_name text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_seg text[] := storage.foldername(p_name);
begin
  if public.current_agency_id() is null or v_seg[1] is distinct from public.current_agency_id()::text then
    return false;
  end if;
  if public.acts_as_licensee() then
    return true;
  end if;
  if v_seg[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return public.can_see_property(v_seg[2]::uuid);
  end if;
  if v_seg[2] in ('_licences', '_cpd') then
    return v_seg[3] = auth.uid()::text;
  end if;
  -- A new listing's files are staged here before the listing exists; a
  -- signer's stamped copy of a document they signed goes in _signoffs/signed.
  if v_seg[2] = '_pending' then
    return true;
  end if;
  if v_seg[2] = '_signoffs' and v_seg[3] = 'signed' then
    return true;
  end if;
  return false;
end
$$;
revoke execute on function public.evidence_path_readable(text) from public, anon;
revoke execute on function public.evidence_path_writable(text) from public, anon;
grant execute on function public.evidence_path_readable(text) to authenticated;
grant execute on function public.evidence_path_writable(text) to authenticated;

drop policy if exists "compliance-evidence: agency members can view" on storage.objects;
drop policy if exists "compliance-evidence: agency members can upload" on storage.objects;
drop policy if exists "compliance-evidence: agency members can update" on storage.objects;
drop policy if exists "compliance-evidence: agency members can delete" on storage.objects;
drop policy if exists "compliance-evidence: whoever may see the file can view" on storage.objects;
create policy "compliance-evidence: whoever may see the file can view" on storage.objects
  for select using (bucket_id = 'compliance-evidence' and public.evidence_path_readable(name));
drop policy if exists "compliance-evidence: whoever may file it can upload" on storage.objects;
create policy "compliance-evidence: whoever may file it can upload" on storage.objects
  for insert with check (bucket_id = 'compliance-evidence' and public.evidence_path_writable(name));
drop policy if exists "compliance-evidence: whoever may file it can update" on storage.objects;
create policy "compliance-evidence: whoever may file it can update" on storage.objects
  for update using (bucket_id = 'compliance-evidence' and public.evidence_path_writable(name))
  with check (bucket_id = 'compliance-evidence' and public.evidence_path_writable(name));
drop policy if exists "compliance-evidence: licensee can delete" on storage.objects;
create policy "compliance-evidence: licensee can delete" on storage.objects
  for delete using (
    bucket_id = 'compliance-evidence'
    and (storage.foldername(name))[1] = public.current_agency_id()::text
    and public.acts_as_licensee());

-- ─────────────────────────────────────────────────────────────────────────
-- 12. Every delete is recorded (Adam, 9 Oct): what, who, when. Identifiers
--     only, never names, addresses or file names, so it can go into the
--     pseudonymised 7-year record. Deletes made by the system (the
--     end-of-subscription job, which has no signed-in user) are not logged
--     here; that job writes its own certificate.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.deletion_log (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  what text not null,
  row_id text,
  refs jsonb not null default '{}'::jsonb,
  deleted_by uuid,
  deleted_at timestamptz not null default now()
);
create index if not exists deletion_log_agency_idx on public.deletion_log(agency_id, deleted_at);
alter table public.deletion_log enable row level security;
drop policy if exists "deletion_log: licensee can view" on public.deletion_log;
create policy "deletion_log: licensee can view" on public.deletion_log
  for select using (agency_id = public.current_agency_id() and public.acts_as_licensee());

create or replace function public.log_compliance_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(old);
  v_refs jsonb;
begin
  if auth.uid() is null then
    return old;
  end if;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_refs
    from jsonb_each(v_row)
   where key in ('property_id', 'profile_id', 'agent_id', 'manager_id', 'item_key', 'status',
                 'document_id', 'signer_id', 'session_id', 'plan_id', 'category',
                 'created_by', 'uploaded_by', 'created_at', 'signed_at');
  insert into public.deletion_log (agency_id, what, row_id, refs, deleted_by)
  values ((v_row ->> 'agency_id')::uuid, tg_table_name, v_row ->> 'id', v_refs, auth.uid());
  return old;
end
$$;
revoke execute on function public.log_compliance_delete() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'properties', 'property_items', 'property_comparables', 'property_market_listings',
    'signoff_documents', 'signoff_signatures', 'gifts', 'complaints', 'breaches',
    'cpd_records', 'cpd_year_signoffs', 'training_sessions', 'training_attendance',
    'training_plans', 'training_plan_items', 'sg_manual_versions']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_delete_log', t);
    execute format(
      'create trigger %I after delete on public.%I for each row execute function public.log_compliance_delete()',
      t || '_delete_log', t);
  end loop;
end
$$;

-- Files: the folder, never the file name (which often carries a person's name).
create or replace function public.log_evidence_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seg text[] := storage.foldername(old.name);
begin
  if auth.uid() is null or old.bucket_id <> 'compliance-evidence'
     or v_seg[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return old;
  end if;
  insert into public.deletion_log (agency_id, what, row_id, refs, deleted_by)
  values (v_seg[1]::uuid, 'file', old.id::text,
          jsonb_build_object('folder', v_seg[2], 'subfolder', v_seg[3]), auth.uid());
  return old;
end
$$;
revoke execute on function public.log_evidence_delete() from public, anon, authenticated;
drop trigger if exists compliance_evidence_delete_log on storage.objects;
create trigger compliance_evidence_delete_log
  after delete on storage.objects
  for each row execute function public.log_evidence_delete();

-- Into the 7-year record. The existing builder (0054) is kept as it is under
-- a new name, and the deletions and replaced signatures are added beside it.
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'build_activity_record_core') then
    alter function public.build_activity_record(uuid) rename to build_activity_record_core;
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
  select public.build_activity_record_core(p_agency_id) || jsonb_build_object(
    'deletions', coalesce((select jsonb_agg(jsonb_build_object(
        'what', d.what, 'id', d.row_id, 'refs', d.refs,
        'by', d.deleted_by, 'at', d.deleted_at) order by d.deleted_at)
      from public.deletion_log d where d.agency_id = p_agency_id), '[]'),
    'replaced_signatures', coalesce((select jsonb_agg(jsonb_build_object(
        'document', v.document_id, 'signer', v.signer_id, 'signed_at', v.signed_at,
        'by', v.voided_by, 'at', v.voided_at) order by v.voided_at)
      from public.signoff_signature_voids v where v.agency_id = p_agency_id), '[]'));
$$;
revoke execute on function public.build_activity_record_core(uuid) from public, anon, authenticated;
revoke execute on function public.build_activity_record(uuid) from public, anon, authenticated;
grant execute on function public.build_activity_record(uuid) to service_role;

commit;
