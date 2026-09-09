-- ===== RUN THIS ONE. Migration 0044, RealComply master account, 9 September 2026 =====
--
-- MIGRATION 0044 — a master account, and a lock on the billing columns
-- 9 September 2026
--
-- WHY. Adam, 9 Sep 2026: "Am I going to have to do this every time I want to
-- test it? Is there a way we can make it accessible from my account only?
-- Let's call my account the RealComply Master account."
--
-- Putting an agency on a trial to test checkout, and putting it back to free
-- afterwards, has been two SQL scripts pasted into the Supabase editor. That
-- was fine as a one-off and is wrong as a routine: it needs the database
-- console open, it is easy to run the wrong half, and comping a real design
-- partner later would be the same manual dance on a live account. This adds
-- the platform-admin concept the product has never had — the most senior role
-- until now was licensee in charge, which is scoped to one agency, and
-- changing another agency's plan is not an agency-level act.
--
-- AND IT CLOSES SOMETHING FOUND WHILE BUILDING IT, which matters more.
--
-- 0004 gave the licensee in charge a policy to update their own agency row, so
-- they could record PI insurance details. That policy is row-level: it grants
-- the whole row. Nothing stopped a licensee updating `status` to 'comped' on
-- their own agency and using the product free — not through the interface,
-- which offers no such control, but through the Supabase client they already
-- hold a session for. A billing system whose entitlement columns are writable
-- by the customer is not a billing system.
--
-- The trigger below closes that. The billing columns may only change when the
-- caller is a platform admin, or when there is no authenticated user at all —
-- which is the Stripe webhook, running with the service key, and is the only
-- thing that should be writing these columns in normal operation.
--
-- SAFE TO RUN TWICE.

-- ── 1. The flag ───────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists is_platform_admin boolean not null default false;

comment on column public.profiles.is_platform_admin is
  'RealComply staff. Cross-agency: may set any agency plan/status and comp an account. Deliberately not settable from the interface — granted here only.';

-- Adam. Matched on email rather than an id typed in by hand, so this cannot
-- silently grant the wrong person if it is ever re-run on another database.
update public.profiles
set is_platform_admin = true
where lower(email) = 'adam@cassproperty.com.au';

-- ── 2. The helper ─────────────────────────────────────────────────────────

create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false);
$$;

grant execute on function public.is_platform_admin() to authenticated;

-- ── 3. The lock on the billing columns ────────────────────────────────────
--
-- Raises rather than silently ignoring the change. A refused write that looks
-- like a successful one is how migration 0042 wasted an afternoon.

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

  if new.plan is distinct from old.plan
     or new.status is distinct from old.status
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.comped_by is distinct from old.comped_by
     or new.comped_reason is distinct from old.comped_reason
     or new.comped_until is distinct from old.comped_until then
    raise exception
      'Only a RealComply platform admin can change an agency plan or status.'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'agencies_guard_billing_columns'
      and tgrelid = 'public.agencies'::regclass
  ) then
    create trigger agencies_guard_billing_columns
      before update on public.agencies
      for each row execute function public.guard_agency_billing_columns();
  end if;
end $$;

-- ── Verify. One row. Each number should match its column name. ────────────
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'is_platform_admin')                     as flag_column_expect_1,
  (select count(*) from public.profiles where is_platform_admin) as masters_expect_1,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_platform_admin') as helper_expect_1,
  (select count(*) from pg_trigger
    where tgname = 'agencies_guard_billing_columns')             as trigger_expect_1;
