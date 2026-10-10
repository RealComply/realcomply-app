-- ===== Pending (G3): record the agency's Stripe customer at checkout, 10 October 2026 =====
--
-- NOT YET RUN. For Adam to run in the Supabase SQL editor, then rename into
-- the numbered sequence. Safe to run twice: it replaces one function and adds
-- another, and changes no rows.
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

  -- set_agency_stripe_customer() (pending G3, 10 Oct 2026): the customer id,
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

-- ── Verify. One row. ──────────────────────────────────────────────────────
select
  (select count(*) from pg_proc where proname = 'set_agency_stripe_customer') as function_expect_1,
  (select count(*) from pg_trigger
     where tgname = 'agencies_guard_billing_columns')                         as guard_trigger_expect_1;
