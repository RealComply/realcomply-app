-- ===== RUN THIS ONE. Migration 0079, other insurance: two types, 16 October 2026 =====
--
-- CHANGE (Adam, 16 Oct 2026): removed Motor vehicle and Office contents and
-- business. Not Fair Trading requirements; CTP comes with car registration.
-- Offices can still add them under Other.
--
-- 0078 lets an office add other insurance under the three fixed policies, and
-- its check on insurance_policies.kind lists four types. The picker now offers
-- two: Public liability, and Other (name it). This file makes the database
-- agree, so neither removed type can be added another way.
--
-- What this file does:
--
--   1. Any policy already saved as one of the two removed types (only made-up
--      test offices have used them; the feature isn't live) becomes "Other",
--      named after its old type ("Motor vehicle", "Office contents and
--      business") unless it already had a name. Its details, certificate and
--      history are untouched.
--   2. The check on the type allows public_liability and other only.
--
-- Nothing is deleted. Safe to run more than once.

begin;

-- Order check: 0078 (the table) first.
do $$
begin
  if to_regclass('public.insurance_policies') is null then
    raise exception 'Run 0078 before this one. Nothing was changed.';
  end if;
end $$;

-- ── 1. Policies of a removed type become "Other", keeping the type as their name ──
-- Run from the SQL editor, so the guard on changing a policy's type (0078)
-- lets this through; it stops only the app's users.
update public.insurance_policies
   set name = coalesce(name, case kind when 'motor_vehicle' then 'Motor vehicle'
                                       else 'Office contents and business' end),
       kind = 'other'
 where kind in ('motor_vehicle', 'office_contents');

-- ── 2. Two types only ─────────────────────────────────────────────────────
alter table public.insurance_policies drop constraint if exists insurance_policies_kind_check;
alter table public.insurance_policies add constraint insurance_policies_kind_check
  check (kind in ('public_liability', 'other'));

comment on column public.insurance_policies.kind is
  'public_liability, or other (named by the office). Motor vehicle and office contents were removed on 16 Oct 2026 (0079): add them under other.';

commit;

-- ── Verify. Expected: no policy of a removed type, and the check names two types ──
select
  (select count(*) from public.insurance_policies
    where kind not in ('public_liability', 'other'))                                    as removed_types_left_expect_0,
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.insurance_policies'::regclass
      and conname = 'insurance_policies_kind_check')                                     as kind_check;
