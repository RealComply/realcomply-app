-- ===== RUN THIS ONE. Migration 0078, other kinds of insurance, 16 October 2026 =====
--
-- The Insurance register has three fixed policies (professional indemnity,
-- cyber, iCare workers), held on the office row (0004, 0010, 0076). Offices
-- hold other insurance too. Adam approved the mockup on 16 Oct 2026: the three
-- cards stay as they are, and under them one link, "+ Add other insurance".
-- Pick a type (public liability, office contents and business, motor vehicle,
-- or name your own), upload the certificate, and it is read the same way.
-- More than one of the same type is fine (two vehicles, say).
--
-- What this file does:
--
--   1. insurance_policies: one row per added policy. Its type, its name (for
--      "Other"), the insurer, number and expiry, the certificate on file and
--      what the last read found. The certificate must be in that policy's own
--      folder: {office}/_insurance/other/{policy}/...
--      Never deleted. "Remove" takes a policy off the register (removed_at,
--      removed_by); it and its history stay in the record, and a removed
--      policy can't be changed again.
--   2. insurance_history (0076) keeps their history too, written by a
--      trigger in the same way: one row for every change, the policy before
--      and after, append-only. An added policy's rows carry its id.
--   3. The end-of-subscription guard (0054) covers the new table.
--
-- Licensee only, like the rest of the Insurance register (the licensee in
-- charge, or the agent on their own plan: acts_as_licensee, 0058).
--
-- Nothing is deleted and no existing row changes. Safe to run more than once.

begin;

-- Order check: 0076 (the insurance history) first.
do $$
begin
  if to_regclass('public.insurance_history') is null or to_regprocedure('public.log_insurance_change()') is null then
    raise exception 'Run 0076 before this one. Nothing was changed.';
  end if;
end $$;

-- ── 1. The added policies ─────────────────────────────────────────────────
create table if not exists public.insurance_policies (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  kind text not null check (kind in ('public_liability', 'office_contents', 'motor_vehicle', 'other')),
  -- The office's own name for it. Required for "Other"; optional otherwise
  -- (say, which vehicle).
  name text check (name is null or char_length(btrim(name)) between 1 and 80),
  insurer text check (insurer is null or char_length(insurer) <= 200),
  policy_number text check (policy_number is null or char_length(policy_number) <= 100),
  expiry date,
  document_path text,
  document_file_name text check (document_file_name is null or char_length(document_file_name) <= 300),
  read jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles(id) on delete set null,
  constraint insurance_policies_other_is_named check (kind <> 'other' or name is not null),
  constraint insurance_policies_document_in_own_folder check (
    document_path is null
    or (octet_length(document_path) <= 1024
        and starts_with(document_path, agency_id::text || '/_insurance/other/' || id::text || '/')))
);

create index if not exists insurance_policies_agency_idx on public.insurance_policies (agency_id, created_at);

alter table public.insurance_policies enable row level security;

drop policy if exists "insurance policies: licensee can view" on public.insurance_policies;
create policy "insurance policies: licensee can view" on public.insurance_policies
  for select using (agency_id = public.current_agency_id() and public.acts_as_licensee());
drop policy if exists "insurance policies: licensee can add" on public.insurance_policies;
create policy "insurance policies: licensee can add" on public.insurance_policies
  for insert with check (agency_id = public.current_agency_id() and public.acts_as_licensee());
drop policy if exists "insurance policies: licensee can update" on public.insurance_policies;
create policy "insurance policies: licensee can update" on public.insurance_policies
  for update using (agency_id = public.current_agency_id() and public.acts_as_licensee())
  with check (agency_id = public.current_agency_id() and public.acts_as_licensee());
-- No delete policy, on purpose: a policy leaves the register by "Remove"
-- (removed_at), and stays in the record with its history.

-- Explicit grants. From 30 Oct 2026 Supabase stops granting new public tables
-- to the Data API automatically (RealComply-supabase-data-api-grants-30-Oct.md).
-- Authenticated may read, add and change; never delete. Nothing here is for anon.
revoke all on table public.insurance_policies from public, anon;
revoke delete on table public.insurance_policies from authenticated;
grant select, insert, update on public.insurance_policies to authenticated;
grant select, insert, update, delete on public.insurance_policies to service_role;

comment on table public.insurance_policies is
  'Insurance an office holds beyond the three fixed policies on agencies (public liability, office contents and business, motor vehicle, or named). One row per policy; never deleted, "removed" from the register instead. Every change is in insurance_history.';

-- What can't change. Who added it and when are the database's; the type and
-- the office are fixed; a removed policy is final. Removing is stamped with
-- the database clock and whoever did it.
create or replace function public.guard_insurance_policy()
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
  if tg_op = 'INSERT' then
    new.created_by := (select p.id from public.profiles p where p.id = auth.uid());
    new.created_at := now();
    if new.removed_at is not null or new.removed_by is not null then
      raise exception 'A new policy can''t start removed.';
    end if;
    return new;
  end if;
  if old.removed_at is not null then
    raise exception 'This policy has been removed from the register and can''t be changed.';
  end if;
  if new.agency_id is distinct from old.agency_id or new.kind is distinct from old.kind
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'This change is not allowed.';
  end if;
  if new.removed_at is not null then
    new.removed_at := now();
    new.removed_by := (select p.id from public.profiles p where p.id = auth.uid());
  elsif new.removed_by is not null then
    raise exception 'This change is not allowed.';
  end if;
  return new;
end
$f$;
revoke execute on function public.guard_insurance_policy() from public, anon, authenticated;
drop trigger if exists insurance_policies_guard on public.insurance_policies;
create trigger insurance_policies_guard
  before insert or update on public.insurance_policies
  for each row execute function public.guard_insurance_policy();

-- ── 2. Their history, in insurance_history ────────────────────────────────
alter table public.insurance_history
  add column if not exists policy_id uuid references public.insurance_policies(id);

create index if not exists insurance_history_policy_idx on public.insurance_history (policy_id) where policy_id is not null;

-- 'other' rows belong to an added policy; the three fixed ones have none.
alter table public.insurance_history drop constraint if exists insurance_history_policy_type_check;
alter table public.insurance_history add constraint insurance_history_policy_type_check
  check (policy_type in ('pi', 'cyber', 'icare', 'other'));
alter table public.insurance_history drop constraint if exists insurance_history_other_has_policy;
alter table public.insurance_history add constraint insurance_history_other_has_policy
  check ((policy_type = 'other') = (policy_id is not null));
-- 'policy_removed': an added policy taken off the register.
alter table public.insurance_history drop constraint if exists insurance_history_source_check;
alter table public.insurance_history add constraint insurance_history_source_check
  check (source in ('document_read', 'typed', 'document_removed', 'policy_removed'));

comment on column public.insurance_history.policy_id is
  'For an added policy (insurance_policies, 0078): which one. Null for the three fixed policies.';

-- The trigger. One history row for each change to an added policy's
-- details or certificate, and one when it is removed. How the change
-- happened comes from changeSource in its read state, as for the fixed
-- policies (0076); anything else is a change by hand.
create or replace function public.log_insurance_policy_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_new jsonb := to_jsonb(new);
  v_before jsonb;
  v_after jsonb;
  v_source text;
begin
  v_before := jsonb_build_object(
    'insurer', v_old ->> 'insurer', 'policyNumber', v_old ->> 'policy_number', 'expiry', v_old ->> 'expiry',
    'documentPath', v_old ->> 'document_path', 'documentFileName', v_old ->> 'document_file_name');
  v_after := jsonb_build_object(
    'insurer', v_new ->> 'insurer', 'policyNumber', v_new ->> 'policy_number', 'expiry', v_new ->> 'expiry',
    'documentPath', v_new ->> 'document_path', 'documentFileName', v_new ->> 'document_file_name');

  if tg_op = 'UPDATE' and new.removed_at is not null and old.removed_at is null then
    v_source := 'policy_removed';
  elsif v_before is distinct from v_after then
    v_source := 'typed';
    if (v_new -> 'read') is distinct from (v_old -> 'read')
       and (v_new -> 'read' ->> 'changeSource') in ('document_read', 'typed', 'document_removed') then
      v_source := v_new -> 'read' ->> 'changeSource';
    end if;
  else
    return null;
  end if;

  insert into public.insurance_history (agency_id, policy_type, policy_id, source, before, after, changed_by)
  values (new.agency_id, 'other', new.id, v_source, v_before, v_after,
          (select p.id from public.profiles p where p.id = auth.uid()));
  return null;
end
$$;
revoke execute on function public.log_insurance_policy_change() from public, anon, authenticated;

drop trigger if exists insurance_policies_log_change on public.insurance_policies;
create trigger insurance_policies_log_change
  after insert or update on public.insurance_policies
  for each row execute function public.log_insurance_policy_change();

-- ── 3. An ended subscription can't change it (0054) ───────────────────────
do $$
begin
  if to_regprocedure('public.guard_agency_not_ended()') is not null then
    drop trigger if exists insurance_policies_not_ended_guard on public.insurance_policies;
    create trigger insurance_policies_not_ended_guard
      before insert or update or delete on public.insurance_policies
      for each row execute function public.guard_agency_not_ended();
  end if;
end $$;

commit;

-- ── Verify. Expected: 1 table, 3 policies, 3 triggers, history linked, authenticated can't delete ──
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'insurance_policies')                    as tables_expect_1,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'insurance_policies')                       as policies_expect_3,
  (select count(*) from pg_trigger
    where tgrelid = 'public.insurance_policies'::regclass and not tgisinternal)              as triggers_expect_3,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'insurance_history' and column_name = 'policy_id') as history_linked,
  has_table_privilege('authenticated', 'public.insurance_policies', 'select')
    and has_table_privilege('authenticated', 'public.insurance_policies', 'insert')
    and has_table_privilege('authenticated', 'public.insurance_policies', 'update')
    and not has_table_privilege('authenticated', 'public.insurance_policies', 'delete')    as grants_ok;
