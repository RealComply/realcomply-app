-- ===== 0060: fixes from the full function check, 10 October 2026 =====
--
-- Adam asked for "a full check of every function" after the agent access
-- build. The check found these needed the database to change; the app half of
-- each is in the same branch (claude/check-fixes). One transaction: if any
-- statement fails, nothing changes. Safe to run more than once.
--
--   1. An agent or assistant can remove their own refused licence upload
--      (someone else's licence), and the refusals already stored with another
--      person's name are cleared. (Section G1a)
--   2. The person who uploaded an ID document that RealComply refused can
--      delete it, so the vendor's licence or passport copy isn't kept. Only a
--      file that was never on a record. (Section G2)
--   3. Starting checkout records the agency's Stripe customer, so a second
--      attempt doesn't make a second customer. A customer recorded on one
--      agency can't be put on another. (Section G3)
--   4. Someone who joins after an SG Manual version is published is asked to
--      sign it; a trust account can say when it opened. (Section G4b)
--   5. Someone can add their own sign-off row only to a document they may
--      sign. (Section H4a)
--   6. my_profile_is_archived(), for the screen a removed person sees.
--      (Section H4b)
--   7. Only the licensee moves or overwrites a filed document; anyone else
--      moves only their own unsaved upload into its new listing. (Section H6)
--   8. A checklist card or a CPD record can only name a file in its own
--      folder, and a card cannot be moved to another listing. (Section H7)
--
-- Nothing here touches Cass Property's data. The only data changes are the
-- two that clear stored refusals (section G1a), and both leave Cass Property
-- out, by its id and by its name, so they cannot touch it even if Cass
-- stores a refusal before this runs (10 Oct 2026). When this was checked they matched a single row,
-- on Comply Real Estate. Everything else adds or replaces rules, functions
-- and a column, and changes no rows.
--
-- Safe to run while the app now live is in use: it only refuses what that
-- app never does.
--
-- Tests: supabase/tests/check_fixes.sql and supabase/tests/refused_id_upload.sql.

begin;

-- ======================================================================
-- Section G1a
-- ======================================================================
-- ===== Pending (G1a): licence uploads that were refused, 10 October 2026 =====
--
-- Not yet run anywhere. Safe to run more than once. Run after 0058 and 0059.
-- Everything is in one transaction: if any statement fails, nothing changes.
--
-- 1. A refused licence upload can be removed by the person who uploaded it.
--
--    Since 10 Oct an agent or assistant has their own licence card back on
--    Registers (it was hidden from them by the agent access change, while the
--    reminder emails kept sending them there to upload the renewal). When
--    they upload a document that turns out to be someone else's licence, or
--    not a licence at all, nothing is saved and the app removes the file
--    straight away: it is usually somebody else's personal document
--    (lib/actions/licences.ts, discardUpload).
--
--    0058 lets only the licensee delete files, so for an agent that removal
--    is quietly refused and the other person's licence stays in
--    {agency}/_licences/{agent}/. This allows exactly that one delete and
--    nothing else:
--      - in the person's own _licences folder,
--      - a file they uploaded themselves, in the last hour,
--      - that is not their licence document on record, and never was (no
--        licence_history row names it).
--    A licence document that is or was on the record stays the licensee's to
--    delete, the same as every other compliance record. The delete is still
--    written to deletion_log by the 0058 trigger on storage.objects.
--
-- 2. Refusals already stored are cleared.
--
--    Until 10 Oct a refused upload was also written to the record's
--    licence_read, with the name printed on the document: another person's
--    name kept in this person's record. The app no longer saves a refusal
--    (the warning is shown once, in the browser that uploaded it). This
--    clears the ones already saved, the same way a typed correction clears
--    them (recordTypedChanges in lib/licence-read.ts): lastRead goes back to
--    null and the rest of the read state is untouched.
--
--    Cass Property is left out (10 Oct 2026). Cass gets no data changes from
--    any SQL, and until the new app is live the old one still stores a
--    refusal whenever someone uploads the wrong licence, at Cass as anywhere.
--    By the id 0054 protects, which survives a rename, and by name as well,
--    so a mistake in either one still leaves Cass out.


drop policy if exists "compliance-evidence: own refused licence upload can be removed" on storage.objects;
create policy "compliance-evidence: own refused licence upload can be removed" on storage.objects
  for delete using (
    bucket_id = 'compliance-evidence'
    and (storage.foldername(name))[1] = public.current_agency_id()::text
    and (storage.foldername(name))[2] = '_licences'
    and (storage.foldername(name))[3] = auth.uid()::text
    and owner_id = auth.uid()::text
    and created_at > now() - interval '1 hour'
    and not exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.licence_document_path = objects.name)
    and not exists (
      select 1 from public.licence_history h
       where h.profile_id = auth.uid()
         and (h.before ->> 'documentPath' = objects.name or h.after ->> 'documentPath' = objects.name)));

update public.profiles
   set licence_read = jsonb_set(licence_read, '{lastRead}', 'null'::jsonb)
 where licence_read -> 'lastRead' ->> 'status' in ('name_mismatch', 'not_a_licence')
   and agency_id is distinct from 'b4763dfb-b33e-43bb-94ca-702a7e989a27'::uuid  -- Cass Property
   and not exists (select 1 from public.agencies cass
                    where cass.id = profiles.agency_id and cass.name = 'Cass Property');

update public.agencies
   set corporation_licence_read = jsonb_set(corporation_licence_read, '{lastRead}', 'null'::jsonb)
 where corporation_licence_read -> 'lastRead' ->> 'status' in ('name_mismatch', 'not_a_licence')
   and id <> 'b4763dfb-b33e-43bb-94ca-702a7e989a27'::uuid  -- Cass Property
   and name is distinct from 'Cass Property';

-- ======================================================================
-- Section G2
-- ======================================================================
-- ===== Pending (G2): the person who uploaded an ID document RealComply refused can delete it, 10 October 2026 =====
--
-- Run after 0059. Safe to run more than once. Changes no rows.
--
-- Found in the check of 10 Oct. Adam, 20 Aug 2026: "if the AI can detect any
-- ID documents, then it rejects them". The browser puts the file in storage
-- first (Vercel's 4.5MB limit), then uploadEvidence reads it and, if it is a
-- licence, passport, rates notice or the like, deletes it and tells the agent
-- "it hasn't been attached and has been deleted".
--
-- Since 0058 only the licensee deletes files ("Make it so that only a
-- licensee can delete compliance records", Adam, 9 Oct). So when an agent or
-- an assistant uploaded the ID document, the delete quietly did nothing and
-- the copy stayed in storage, on nobody's file, until the subscription ends.
--
-- A refused upload is not a compliance record: it was never attached to
-- anything. This lets the person who uploaded it delete it, and only while
-- all of this is true:
--   - they uploaded it (the file's owner is them),
--   - in the last 15 minutes (the check runs straight after the upload; 15
--     minutes is longer than the server will ever take over it),
--   - it is in a listing's a1 folder, {agency}/{listing}/a1/..., the vendor
--     identity card, which is the only card that refuses ID documents
--     (rejectIdDocuments in src/lib/rules/nsw-sales.ts; add a card here if
--     another one gets it),
--   - they may file to that listing (evidence_path_writable, 0058),
--   - it is not attached to any card of that listing,
--   - and it never was, and it never arrived by a move (below).
-- Anything attached, anything older, anyone else's file and every other
-- folder stay the licensee's to delete, as 0058 has them. The delete is
-- written to deletion_log like any other (0058, section 12).
--
-- NEVER ON A RECORD, NOT JUST "NOT ATTACHED NOW" (10 Oct 2026). The review of
-- the first version found three ways an agent could use this to delete a
-- compliance record inside its 15 minutes:
--   - attach VOI certificate A, then B: A is kept as the replaced record
--     (finalizeEvidenceRecord's remove of A is refused for them, as it should
--     be), and was deletable straight after;
--   - clear the card's evidence_path through the API (the listing's
--     update rule allows it), then delete what was attached;
--   - detach the licensee's fresh contract from b1 and move it into a1:
--     a Storage move renames the file and makes the mover its owner.
-- So every file that leaves a card (replaced, cleared, or its row deleted)
-- and every file moved to a new name in the bucket is written down in
-- evidence_files_once_on_record, and the check refuses anything listed there.
-- A refused upload is never attached and never moved: uploadEvidence checks
-- it before anything records it, and deletes it where it landed. The a1
-- card's data holds no other file references (only the display name,
-- evidenceFileName, and the AI's draft), so the path is the whole record.
--
-- Nobody reads or writes the list but the database itself: row level
-- security on and no rules, and no grants. It holds paths, which carry file
-- names, so it goes with the agency (on delete cascade) like the files do,
-- and is never copied into the 7-year record.
--
-- Until this has run, the app says the copy could not be deleted rather than
-- saying it was.

create table if not exists public.evidence_files_once_on_record (
  name text primary key,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  recorded_at timestamptz not null default now()
);
create index if not exists evidence_files_once_on_record_agency_idx
  on public.evidence_files_once_on_record(agency_id);
alter table public.evidence_files_once_on_record enable row level security;
revoke all on table public.evidence_files_once_on_record from public, anon, authenticated;

-- A card's file replaced, cleared, or its row deleted.
create or replace function public.record_evidence_leaving_card()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.evidence_path is null
     or (tg_op = 'UPDATE' and new.evidence_path is not distinct from old.evidence_path) then
    return null;
  end if;
  -- A value that cannot name a stored file (longer than Storage allows, or
  -- not in this agency's folder) is not kept: it could never be deleted as a
  -- refused upload anyway, and a very long one would not fit the list's
  -- index and would make the card, and the listing, impossible to change or
  -- delete (review of these fixes, 10 Oct 2026).
  if length(old.evidence_path) > 1024 or not starts_with(old.evidence_path, old.agency_id::text || '/') then
    return null;
  end if;
  -- The agency's own deletion cascades through here too; by then its row is
  -- gone and there is nothing to keep.
  insert into public.evidence_files_once_on_record (name, agency_id)
  select old.evidence_path, a.id from public.agencies a where a.id = old.agency_id
  on conflict (name) do nothing;
  return null;
end
$$;
revoke execute on function public.record_evidence_leaving_card() from public, anon, authenticated;
drop trigger if exists property_items_record_evidence_leaving on public.property_items;
create trigger property_items_record_evidence_leaving
  after update of evidence_path or delete on public.property_items
  for each row execute function public.record_evidence_leaving_card();

-- A file moved to a new name in the bucket (a Storage move: one update of
-- the row's name, which keeps its created_at). Whoever did it, since the
-- Storage service makes the change itself once the person's rules allow it.
create or replace function public.record_evidence_moved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seg text[] := storage.foldername(new.name);
begin
  if new.bucket_id is distinct from 'compliance-evidence'
     or (new.name is not distinct from old.name and new.bucket_id is not distinct from old.bucket_id)
     or coalesce(v_seg[1], '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or length(new.name) > 1024 then
    return null;
  end if;
  insert into public.evidence_files_once_on_record (name, agency_id)
  select new.name, a.id from public.agencies a where a.id = v_seg[1]::uuid
  on conflict (name) do nothing;
  return null;
end
$$;
revoke execute on function public.record_evidence_moved() from public, anon, authenticated;
drop trigger if exists compliance_evidence_record_moved on storage.objects;
create trigger compliance_evidence_record_moved
  after update of name, bucket_id on storage.objects
  for each row execute function public.record_evidence_moved();

create or replace function public.evidence_refused_upload_deletable(
  p_name text,
  p_owner text,
  p_created_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_seg text[] := storage.foldername(p_name);
begin
  if auth.uid() is null or p_owner is distinct from auth.uid()::text then
    return false;
  end if;
  if p_created_at is null or p_created_at <= now() - interval '15 minutes' then
    return false;
  end if;
  if coalesce(v_seg[2], '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_seg[3] is distinct from 'a1' then
    return false;
  end if;
  if not public.evidence_path_writable(p_name) then
    return false;
  end if;
  -- Any card in the agency, not only the listing the path names: a card on
  -- another listing could point at this file (review, 10 Oct 2026).
  return not exists (select 1 from public.property_items i
                      where i.agency_id = public.current_agency_id()
                        and i.evidence_path = p_name)
     and not exists (select 1 from public.evidence_files_once_on_record r
                      where r.name = p_name);
end
$$;
revoke execute on function public.evidence_refused_upload_deletable(text, text, timestamptz) from public, anon;
grant execute on function public.evidence_refused_upload_deletable(text, text, timestamptz) to authenticated;

drop policy if exists "compliance-evidence: uploader can delete a refused ID document" on storage.objects;
create policy "compliance-evidence: uploader can delete a refused ID document" on storage.objects
  for delete using (
    bucket_id = 'compliance-evidence'
    and public.evidence_refused_upload_deletable(name, coalesce(owner_id, owner::text), created_at));

-- ======================================================================
-- Section G3
-- ======================================================================
-- ===== Pending (G3): record the agency's Stripe customer at checkout, 10 October 2026 =====
--
-- Safe to run twice: it replaces one function and adds another, and changes
-- no rows.
--
-- Changed after review, 10 Oct 2026: a customer already recorded on another
-- agency is refused, and an agency's customer can be replaced until it has a
-- subscription. See below.
--
-- THE BUG. Starting checkout creates a Stripe customer and then writes its id
-- to agencies.stripe_customer_id, so the next attempt reuses it (see
-- createCustomer in src/lib/actions/billing.ts). That write has been refused
-- every time since 0044: guard_agency_billing_columns lets nobody but a
-- platform admin change stripe_customer_id, and the app never read the
-- error. So every attempt before the first finished checkout made another
-- Stripe customer: back out and try again, two tabs, or the licensee and the
-- account holder both starting. Two customers can mean two subscriptions,
-- which is the double charge the write was there to prevent. It also means
-- the app can never ask Stripe whether a subscription already exists, which
-- the second-checkout guard in startCheckout now does.
--
-- THE FIX. set_agency_stripe_customer(p_customer_id), for the signed-in
-- person's own agency only:
--   - only someone who may set up billing: whoever acts as the licensee
--     (acts_as_licensee(), 0058/0059) or the account holder
--     (is_account_holder(), 0059), the same people the app lets start
--     checkout;
--   - only a customer that no other agency has. The id is no secret inside
--     an agency: every member can read their agency's row, assistants
--     included. Without this, someone who left an office could put that
--     office's customer on their own new agent plan and open its billing
--     page from there: cancel its subscription, change its card, read its
--     invoices. Refused, whoever asks;
--   - only until the agency has a subscription. Before that, a new customer
--     replaces the one recorded (a stale id, say one made in Stripe's test
--     mode, has to be replaceable or checkout can never start). Once the
--     webhook has recorded a subscription, nothing changes and the recorded
--     id comes back. The price: two people who start checkout in the same
--     moment, before anything is recorded, are no longer put on one
--     customer; the later one is kept;
--   - only something shaped like a Stripe customer id.
-- The billing guard keeps refusing everything else from signed-in users.
-- It lets this one change through only inside the function: the function
-- sets a flag for the length of its own statement, and the guard accepts a
-- change to stripe_customer_id alone, while there is no subscription, while
-- the flag is set. A signed-in user cannot set that flag themselves (the API
-- runs no SET).
--
-- The webhook and the master switch are unchanged: the service key and
-- platform admins pass the guard as before.
--
-- The guard below is 0054's, word for word, with the one exception added.

create or replace function public.guard_agency_billing_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() is null for the service key, which is what the Stripe webhook
  -- uses and the only thing that legitimately writes these columns day to day.
  if auth.uid() is null then
    return new;
  end if;

  if public.is_platform_admin() then
    return new;
  end if;

  -- set_agency_stripe_customer() (0060, 10 Oct 2026): the customer id,
  -- before there is a subscription, and nothing else.
  if current_setting('realcomply.set_stripe_customer', true) = 'on'
     and (old.stripe_customer_id is null or old.stripe_subscription_id is null)
     and new.stripe_customer_id is not null
     and new.plan is not distinct from old.plan
     and new.status is not distinct from old.status
     and new.trial_ends_at is not distinct from old.trial_ends_at
     and new.stripe_subscription_id is not distinct from old.stripe_subscription_id
     and new.comped_by is not distinct from old.comped_by
     and new.comped_reason is not distinct from old.comped_reason
     and new.comped_until is not distinct from old.comped_until
     and new.ended_at is not distinct from old.ended_at
     and new.ended_notice_sent_at is not distinct from old.ended_notice_sent_at
     and new.ended_reminder_sent_at is not distinct from old.ended_reminder_sent_at
     and new.legal_hold is not distinct from old.legal_hold
     and new.legal_hold_reason is not distinct from old.legal_hold_reason
     and new.legal_hold_set_at is not distinct from old.legal_hold_set_at then
    return new;
  end if;

  if new.plan is distinct from old.plan
     or new.status is distinct from old.status
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.comped_by is distinct from old.comped_by
     or new.comped_reason is distinct from old.comped_reason
     or new.comped_until is distinct from old.comped_until
     or new.ended_at is distinct from old.ended_at
     or new.ended_notice_sent_at is distinct from old.ended_notice_sent_at
     or new.ended_reminder_sent_at is distinct from old.ended_reminder_sent_at
     or new.legal_hold is distinct from old.legal_hold
     or new.legal_hold_reason is distinct from old.legal_hold_reason
     or new.legal_hold_set_at is distinct from old.legal_hold_set_at then
    raise exception
      'Only a RealComply platform admin can change an agency plan or status.'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create or replace function public.set_agency_stripe_customer(p_customer_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_existing text;
  v_subscription text;
begin
  if auth.uid() is null or v_agency is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if not (public.acts_as_licensee() or public.is_account_holder()) then
    raise exception 'Only the licensee in charge or the account holder can set up billing for the agency.'
      using errcode = '42501';
  end if;

  if p_customer_id is null or p_customer_id !~ '^cus_[A-Za-z0-9]+$' then
    raise exception 'That is not a Stripe customer id.' using errcode = '22023';
  end if;

  -- Locked, so two people starting checkout at once write one after the other.
  select stripe_customer_id, stripe_subscription_id into v_existing, v_subscription
    from public.agencies
   where id = v_agency
   for update;

  -- One customer, one agency (10 Oct 2026): see above.
  if exists (select 1 from public.agencies other
              where other.stripe_customer_id = p_customer_id and other.id <> v_agency) then
    raise exception 'That Stripe customer belongs to another agency.' using errcode = '23505';
  end if;

  -- Once there is a subscription, its customer stays.
  if v_existing is not null and v_subscription is not null then
    return v_existing;
  end if;

  if v_existing is not distinct from p_customer_id then
    return v_existing;
  end if;

  perform set_config('realcomply.set_stripe_customer', 'on', true);
  update public.agencies set stripe_customer_id = p_customer_id where id = v_agency;
  perform set_config('realcomply.set_stripe_customer', 'off', true);

  return p_customer_id;
end
$$;

revoke execute on function public.set_agency_stripe_customer(text) from public, anon;
grant execute on function public.set_agency_stripe_customer(text) to authenticated;

-- ======================================================================
-- Section G4b
-- ======================================================================
-- ===== G4b: sign-offs for people who join later; when a trust account opened, 10 October 2026 =====
--
-- Two changes from the 10 Oct function check (document sign-offs and trust
-- accounts). Plain SQL, safe to run more than once. Nothing here edits or
-- removes an existing row: one adds unsigned sign-off rows for people who are
-- missing them, the other adds an empty column.
--
-- Run before merging. The app copes with the column not being there
-- yet (it reads trust_accounts with select *), but giving a new account an
-- "opened on" date needs it.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 1. Someone who joins after an SG Manual version is published is asked to
--    sign it.
-- ─────────────────────────────────────────────────────────────────────────
--
-- createSignoffDocument (src/lib/actions/signoffs.ts) makes one unsigned row
-- per person in the office at the moment a version is published, and nothing
-- ever added a row for anyone who joined afterwards. Since 0058 a person with
-- no row cannot even see the document, so a new starter's SG Manual page had
-- no sign-off on it, Sign-offs said "Nothing waiting on your signature", and
-- the licensee's card read "N of N signed" in green with the new person on
-- it nowhere.
--
-- Now: whenever someone becomes an active member of an agency (joins, moves
-- in, or is brought back after being removed), they get an unsigned row on
-- that agency's CURRENT SG Manual version — the newest one, the same version
-- the SG Manual page shows. Not on older versions: those were superseded
-- before they arrived. With the row in place, the 0058 rules already let them
-- see the document and sign their own row, and the licensee sees them as
-- outstanding.
--
-- SECURITY DEFINER because the person joining cannot see the document yet;
-- that is the problem being solved. It only ever adds an unsigned row for the
-- person whose profile row fired it, in their own agency.

create or replace function public.add_current_signoffs_for_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.agency_id is null or new.archived_at is not null then
    return new;
  end if;
  -- Only on becoming a member: a new profile, a change of agency, or being
  -- brought back. An ordinary edit to a profile changes nothing here.
  if tg_op = 'UPDATE'
     and old.agency_id is not distinct from new.agency_id
     and old.archived_at is null then
    return new;
  end if;

  insert into public.signoff_signatures (document_id, agency_id, signer_id)
  select d.id, d.agency_id, new.id
    from public.signoff_documents d
   where d.id = (
     select cur.id from public.signoff_documents cur
      where cur.agency_id = new.agency_id
        and cur.category = 'sg_manual'
        and cur.signer_scope = 'all_staff'
      order by cur.created_at desc
      limit 1)
  on conflict (document_id, signer_id) do nothing;

  return new;
end
$$;
revoke execute on function public.add_current_signoffs_for_member() from public, anon, authenticated;

drop trigger if exists profiles_add_current_signoffs on public.profiles;
create trigger profiles_add_current_signoffs
  after insert or update of agency_id, archived_at on public.profiles
  for each row execute function public.add_current_signoffs_for_member();

-- No catch-up for people who joined before this ran: it would add unsigned
-- rows in every agency, Cass Property included, and Cass gets no data
-- changes. The licensee can re-publish the current version to ask them.

-- ─────────────────────────────────────────────────────────────────────────
-- 2. When a trust account opened.
-- ─────────────────────────────────────────────────────────────────────────
--
-- A trust account added in October for an account that opened on 1 October
-- showed July, August and September as overdue straight away, and asked for
-- the audit of the year before it existed. The red badge could only be
-- cleared by filing reconciliations for months the account never had.
--
-- The date the account OPENED, given by the licensee, not created_at. They
-- differ for every agency that joins part way through a year, and for every
-- account 0032 created on 25 Aug 2026 for the agencies already here: those
-- still owed their July reconciliations and their 2025-26 audit, and reading
-- created_at would have gone quiet about both.
--
-- Null means it was already open, so every existing account carries on
-- exactly as before. Covered by the existing trust_accounts policies (the
-- licensee adds and edits accounts).

alter table public.trust_accounts
  add column if not exists opened_on date;

comment on column public.trust_accounts.opened_on is
  'The day the account opened, when it opened part way through a year. Months and audit periods that ended before it are not owed (src/lib/trust-account.ts monthBeforeOpening, auditOwed). Null: already open, everything owed.';

-- ======================================================================
-- Section H4a
-- ======================================================================
-- ===== H4a: a sign-off row of your own only on a document you may sign, 10 October 2026 =====
--
-- Found in the browser check of 10 Oct, proved on a test database. 0058 let
-- anyone add a sign-off row with themselves as the signer, on any document
-- id, signed or not. The row is what lets a person see a document (the
-- signoff_documents rule, evidence_path_readable), and lets them attach a
-- signed copy to it. So an agent could add themselves to the licensee's
-- trust reconciliation and then read it, and the file, though trust
-- accounts are the licensee's alone (Adam, 7 Oct).
--
-- Now a row of your own needs a document in your agency that you may sign:
-- one for all staff, or one for the licensee only when you act as the
-- licensee. Everything that adds rows today still works:
--   - publishing a document: the licensee adds unsigned rows for the people
--     who have to sign (unchanged);
--   - signing: signDocument (src/lib/actions/signoffs.ts) upserts the
--     signer's own row with the signature on it. Postgres checks an upsert's
--     row against this rule even when the row is already there, so a signed
--     row of your own has to stay allowed; the guard trigger (0058) still
--     sets the time and the name;
--   - someone joining: the definer trigger in section G4b;
--   - the licensee asking people who are missing a row: unsigned rows, as
--     when publishing.
-- No rows are changed. A self-added row that is already there stays; the
-- licensee can see every row and delete one.

create or replace function public.may_sign_signoff_document(p_document_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.signoff_documents d
     where d.id = p_document_id
       and d.agency_id = public.current_agency_id()
       and (d.signer_scope = 'all_staff'
            or (d.signer_scope = 'licensee_only' and public.acts_as_licensee())));
$$;
revoke execute on function public.may_sign_signoff_document(uuid) from public, anon;
grant execute on function public.may_sign_signoff_document(uuid) to authenticated;

drop policy if exists "signoff_signatures: licensee lists signers, signer signs own" on public.signoff_signatures;
create policy "signoff_signatures: licensee lists signers, signer signs own" on public.signoff_signatures
  for insert with check (
    agency_id = public.current_agency_id()
    and ((public.acts_as_licensee() and signed_at is null and public.may_sign_signoff_document(document_id))
         or (signer_id = auth.uid() and public.may_sign_signoff_document(document_id))));

-- A row cannot be moved to another document or person afterwards. Without
-- this, someone with an unsigned row on the SG Manual could repoint it at a
-- licensee-only trust reconciliation, or another office's document, and
-- then read and sign that (review of these fixes, 10 Oct 2026). Signing
-- through signDocument's upsert sends the same three values, so it passes.
-- Its own small guard, so 0058's guard_signoff_signature stays as it ran.
create or replace function public.guard_signoff_signature_keys()
returns trigger
language plpgsql
security invoker
set search_path = public
as $f$
begin
  -- Security invoker on purpose: current_user is then the caller's role.
  if current_user in ('authenticated', 'anon')
     and (new.document_id is distinct from old.document_id
          or new.agency_id is distinct from old.agency_id
          or new.signer_id is distinct from old.signer_id) then
    raise exception 'This change is not allowed.';
  end if;
  return new;
end
$f$;
revoke execute on function public.guard_signoff_signature_keys() from public, anon, authenticated;
drop trigger if exists signoff_signatures_keys_guard on public.signoff_signatures;
create trigger signoff_signatures_keys_guard
  before update on public.signoff_signatures
  for each row execute function public.guard_signoff_signature_keys();

-- ======================================================================
-- Section H4b
-- ======================================================================
-- ===== H4b: is my profile archived?, 10 October 2026 =====
--
-- For the screen someone sees after the licensee has removed them from the
-- agency. Since 0058 a removed person can read nothing, their own profile
-- included (current_agency_id() is null for them), so the app could not tell
-- "removed" from "never finished signing up" and sent them to set up a new
-- agency. This answers only that one question, only about the person asking.

create or replace function public.my_profile_is_archived()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles me
     where me.id = auth.uid() and me.archived_at is not null);
$$;
revoke execute on function public.my_profile_is_archived() from public, anon;
grant execute on function public.my_profile_is_archived() to authenticated;

-- ======================================================================
-- Section H6
-- ======================================================================
-- ===== H6: only the licensee moves or overwrites a filed document, 10 October 2026 =====
--
-- Found in the review of these fixes. Since 0058 only the licensee deletes a
-- file ("Make it so that only a licensee can delete compliance records", Adam,
-- 9 Oct). But the UPDATE rule still let anyone who may file to a folder move
-- or overwrite what is already there. Through the Storage service directly (not
-- the app), an agent could move an attached document out of its card, or
-- upload over it, which destroys the original with no deletion_log row.
--
-- The app moves a file in one place only: a new listing's uploads, staged in
-- {agency}/_pending/ before the listing exists, go to the listing's folder
-- once it does (moveStagedEvidence). It never overwrites (every upload has a
-- new name, upsert off). So the licensee keeps moving and overwriting as
-- before; everyone else may move only their own staged upload. Safe while
-- the app now live is in use: it only refuses what that app never does.
drop policy if exists "compliance-evidence: whoever may file it can update" on storage.objects;
create policy "compliance-evidence: whoever may file it can update" on storage.objects
  for update using (
    bucket_id = 'compliance-evidence'
    and public.evidence_path_writable(name)
    and (public.acts_as_licensee()
         or ((storage.foldername(name))[2] = '_pending'
             and coalesce(owner_id, owner::text) = auth.uid()::text)))
  with check (bucket_id = 'compliance-evidence' and public.evidence_path_writable(name));

-- ======================================================================
-- Section H7
-- ======================================================================
-- ===== H7: a record names only a file in its own folder, 10 October 2026 =====
--
-- Found in the review of these fixes. Only the licensee deletes files, and
-- when they delete a listing, remove a card's file, replace it, or delete a
-- CPD record, the app removes the file that record names, with the
-- licensee's own access. But the record's file path is written by whoever
-- may change the record: an agent could, through the database directly (not
-- the app), point their card or CPD record at another listing's contract or
-- someone else's licence, and the licensee's next delete would remove that
-- file instead. So:
--   - a checklist card's file must be in its own listing's folder,
--     {agency}/{listing}/..., and a card cannot be moved to another listing;
--   - a CPD record's file must be in that person's CPD folder,
--     {agency}/_cpd/{person}/...
-- The app has only ever written paths like these: on 10 Oct every one of the
-- 93 card files and both CPD files on the live database matched. Only new
-- writes are checked, and only from signed-in people; the platform's own
-- jobs are not affected. Safe while the app now live is in use: it never
-- writes anything else.

create or replace function public.guard_property_item_paths()
returns trigger
language plpgsql
security invoker
set search_path = public
as $f$
begin
  -- Security invoker on purpose: current_user is then the caller's role.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and (new.property_id is distinct from old.property_id
          or new.agency_id is distinct from old.agency_id
          or new.item_key is distinct from old.item_key) then
    raise exception 'This change is not allowed.';
  end if;
  if new.evidence_path is not null
     and (tg_op = 'INSERT' or new.evidence_path is distinct from old.evidence_path)
     and (length(new.evidence_path) > 1024
          or not starts_with(new.evidence_path, new.agency_id::text || '/' || new.property_id::text || '/')) then
    raise exception 'That file is not in this listing''s folder.';
  end if;
  return new;
end
$f$;
revoke execute on function public.guard_property_item_paths() from public, anon, authenticated;
drop trigger if exists property_items_paths_guard on public.property_items;
create trigger property_items_paths_guard
  before insert or update on public.property_items
  for each row execute function public.guard_property_item_paths();

create or replace function public.guard_cpd_record_paths()
returns trigger
language plpgsql
security invoker
set search_path = public
as $f$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.evidence_path is not null
     and (tg_op = 'INSERT' or new.evidence_path is distinct from old.evidence_path)
     and (length(new.evidence_path) > 1024
          or not starts_with(new.evidence_path, new.agency_id::text || '/_cpd/' || new.profile_id::text || '/')) then
    raise exception 'That file is not in this person''s CPD folder.';
  end if;
  return new;
end
$f$;
revoke execute on function public.guard_cpd_record_paths() from public, anon, authenticated;
drop trigger if exists cpd_records_paths_guard on public.cpd_records;
create trigger cpd_records_paths_guard
  before insert or update on public.cpd_records
  for each row execute function public.guard_cpd_record_paths();

commit;
