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
--      delete it, so the vendor's licence or passport copy isn't kept.
--      (Section G2)
--   3. Starting checkout records the agency's Stripe customer, so a second
--      attempt doesn't make a second customer. (Section G3)
--   4. Someone who joins after an SG Manual version is published is asked to
--      sign it; a trust account can say when it opened. (Section G4b)
--
-- Nothing here touches Cass Property's data. The one data change (clearing a
-- stored refusal) matches a single row, on Comply Real Estate.
--
-- Tests: supabase/tests/check_fixes.sql.

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
 where licence_read -> 'lastRead' ->> 'status' in ('name_mismatch', 'not_a_licence');

update public.agencies
   set corporation_licence_read = jsonb_set(corporation_licence_read, '{lastRead}', 'null'::jsonb)
 where corporation_licence_read -> 'lastRead' ->> 'status' in ('name_mismatch', 'not_a_licence');

-- ======================================================================
-- Section G2
-- ======================================================================
-- ===== Pending (G2): the person who uploaded an ID document RealComply refused can delete it, 10 October 2026 =====
--
-- Run after 0059. Safe to run more than once. Changes nothing else.
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
--   - and it is not attached to the card.
-- Anything attached, anything older, anyone else's file and every other
-- folder stay the licensee's to delete, as 0058 has them. The delete is
-- written to deletion_log like any other (0058, section 12).
--
-- Until this has run, the app says the copy could not be deleted rather than
-- saying it was.

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
  return not exists (select 1 from public.property_items i
                      where i.property_id = v_seg[2]::uuid
                        and i.evidence_path = p_name);
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
--   - only while the agency has no customer id yet. If it already has one,
--     nothing changes and that id comes back, so a second person who started
--     at the same moment carries on with the first person's customer;
--   - only something shaped like a Stripe customer id.
-- The billing guard keeps refusing everything else from signed-in users.
-- It lets this one change through only inside the function: the function
-- sets a flag for the length of its own statement, and the guard accepts a
-- change to stripe_customer_id alone, from empty, while the flag is set. A
-- signed-in user cannot set that flag themselves (the API runs no SET).
--
-- WHAT IT DOES NOT DO. The app still never shows a customer id to anyone, so
-- someone would have to know another agency's id to put it on their own row,
-- and could do it once at most. The webhook and the master switch are
-- unchanged: the service key and platform admins pass the guard as before.
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
  -- from empty, and nothing else.
  if current_setting('realcomply.set_stripe_customer', true) = 'on'
     and old.stripe_customer_id is null
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

  -- Locked, so two people starting checkout at once cannot both write.
  select stripe_customer_id into v_existing
    from public.agencies
   where id = v_agency
   for update;

  if v_existing is not null then
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

commit;
