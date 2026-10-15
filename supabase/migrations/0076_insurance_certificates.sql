-- ===== RUN THIS ONE. Migration 0076, insurance certificates, 15 October 2026 =====
--
-- Trent (Lloyd Property, 15 Oct 2026): "under the insurance register it would
-- be great if you could attach the COC/Policy here, so when our "friends" at
-- Fair Trading walk in, we dont have to frantically find it, we can just open
-- the program and show them". Mockup approved by Adam the same day.
--
-- Each of the three policies on the Insurance register (professional
-- indemnity, cybersecurity, iCare workers) takes an upload: the certificate of
-- currency or the policy schedule. RealComply reads the insurer, the policy
-- number and the expiry off it, the same way it reads a licence.
--
-- And a renewal must not overwrite last year's policy (gap audit, 15 Oct
-- 2026). Uploading next year's certificate moves the expiry on; last year's
-- certificate, and the details it carried, stay in the history.
--
-- What this file does:
--
--   1. agencies: for each policy, the certificate on file (where it is stored
--      and its file name) and what the last read found (one jsonb, read whole
--      by the card; see lib/insurance-read.ts). The path must be in the
--      office's own _insurance folder for that policy.
--   2. insurance_history: one row for every change to a policy's insurer,
--      number, expiry or certificate, holding the policy before and after.
--      Written by a trigger on agencies, so no write can skip it, whoever
--      makes the change and however. Nobody can add, change or delete a row
--      directly: the licensee can only read it.
--   3. The end-of-subscription guard (0054) covers the new table too.
--
-- Nothing is deleted and no existing value changes. Safe to run more than
-- once.

begin;

-- Order check: the insurance columns (0004, 0010) and the licensee rule
-- (0058) first.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'agencies'
                    and column_name = 'icare_expiry') then
    raise exception 'Run 0010 before this one. Nothing was changed.';
  end if;
  if to_regprocedure('public.acts_as_licensee()') is null then
    raise exception 'Run 0058 before this one. Nothing was changed.';
  end if;
end $$;

-- ── 1. The certificate on file, and what the last read found ──────────────
alter table public.agencies
  add column if not exists pi_document_path text,
  add column if not exists pi_document_file_name text,
  add column if not exists pi_read jsonb,
  add column if not exists cyber_document_path text,
  add column if not exists cyber_document_file_name text,
  add column if not exists cyber_read jsonb,
  add column if not exists icare_document_path text,
  add column if not exists icare_document_file_name text,
  add column if not exists icare_read jsonb;

-- A policy's certificate lives in that policy's folder in the office's own
-- files: {agency}/_insurance/{pi|cyber|icare}/...
do $$
declare
  p text;
begin
  foreach p in array array['pi', 'cyber', 'icare'] loop
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.agencies'::regclass
                      and conname = 'agencies_' || p || '_document_in_own_folder') then
      execute format(
        'alter table public.agencies add constraint %I check (%I is null or starts_with(%I, id::text || %L))',
        'agencies_' || p || '_document_in_own_folder', p || '_document_path', p || '_document_path',
        '/_insurance/' || p || '/');
    end if;
  end loop;
end $$;

comment on column public.agencies.pi_document_path is
  'Storage path (compliance-evidence bucket) of the professional indemnity certificate of currency or policy schedule on file. Earlier certificates stay in Storage and are listed in insurance_history.';
comment on column public.agencies.pi_read is
  'What the last read of the PI certificate found, and where each value came from (certificate or typed, by whom, when). See lib/insurance-read.ts.';
comment on column public.agencies.cyber_document_path is
  'Storage path of the cybersecurity insurance certificate on file. Earlier certificates are listed in insurance_history.';
comment on column public.agencies.cyber_read is
  'What the last read of the cybersecurity certificate found. See lib/insurance-read.ts.';
comment on column public.agencies.icare_document_path is
  'Storage path of the iCare workers insurance certificate on file. Earlier certificates are listed in insurance_history.';
comment on column public.agencies.icare_read is
  'What the last read of the iCare workers insurance certificate found. See lib/insurance-read.ts.';

-- No new grants for agencies: an existing table, whose grants and policies
-- cover new columns (the licensee, or the agent on their own plan, may update
-- the office row: 0058).

-- ── 2. History of every change to a policy ────────────────────────────────
create table if not exists public.insurance_history (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  policy_type text not null check (policy_type in ('pi', 'cyber', 'icare')),
  -- How the change happened. 'document_read': a certificate was uploaded and
  -- read. 'typed': someone changed the details by hand. 'document_removed':
  -- the certificate was taken off the policy (the file itself is kept).
  source text not null check (source in ('document_read', 'typed', 'document_removed')),
  -- The policy before and after: insurer, policyNumber, expiry, documentPath,
  -- documentFileName. Before is what keeps last year's policy findable.
  before jsonb not null default '{}'::jsonb,
  after jsonb not null default '{}'::jsonb,
  changed_by uuid references public.profiles(id) on delete set null,
  -- The clock, not the transaction's start, so rows written together keep
  -- their order.
  changed_at timestamptz not null default clock_timestamp()
);

create index if not exists insurance_history_agency_idx on public.insurance_history (agency_id, policy_type, changed_at);

alter table public.insurance_history enable row level security;

-- The Insurance register is the licensee's (the agent on their own plan
-- included), so its history is too.
drop policy if exists "insurance history: licensee can view" on public.insurance_history;
create policy "insurance history: licensee can view" on public.insurance_history
  for select using (agency_id = public.current_agency_id() and public.acts_as_licensee());

-- No insert, update or delete policy, on purpose. Rows are written only by
-- the trigger below, so the history is exactly what happened to the policy:
-- nobody can leave a change out of it, add one that didn't happen, or edit
-- one afterwards.

-- Explicit grants. From 30 Oct 2026 Supabase stops granting new public tables
-- to the Data API automatically (RealComply-supabase-data-api-grants-30-Oct.md).
-- Authenticated may read, never write. Nothing here is for anon.
revoke all on table public.insurance_history from public, anon;
revoke insert, update, delete on table public.insurance_history from authenticated;
grant select on public.insurance_history to authenticated;
grant select, insert, update, delete on public.insurance_history to service_role;

comment on table public.insurance_history is
  'One row per change to an Insurance register policy (insurer, number, expiry, certificate), with the policy before and after. Written by the trigger on agencies; append-only. Keeps last year''s certificate and expiry findable after a renewal.';

-- The trigger. Runs after every update of an office row and writes one
-- history row for each policy whose details or certificate changed. The app
-- says how the change happened by setting changeSource in that policy's read
-- state in the same update; anything else (no changeSource, or a read state
-- left as it was) is a change by hand.
create or replace function public.log_insurance_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p text;
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_before jsonb;
  v_after jsonb;
  v_source text;
begin
  foreach p in array array['pi', 'cyber', 'icare'] loop
    v_before := jsonb_build_object(
      'insurer', v_old ->> (p || '_insurer'),
      'policyNumber', v_old ->> (p || '_policy_number'),
      'expiry', v_old ->> (p || '_expiry'),
      'documentPath', v_old ->> (p || '_document_path'),
      'documentFileName', v_old ->> (p || '_document_file_name'));
    v_after := jsonb_build_object(
      'insurer', v_new ->> (p || '_insurer'),
      'policyNumber', v_new ->> (p || '_policy_number'),
      'expiry', v_new ->> (p || '_expiry'),
      'documentPath', v_new ->> (p || '_document_path'),
      'documentFileName', v_new ->> (p || '_document_file_name'));
    if v_before is distinct from v_after then
      v_source := 'typed';
      if (v_new -> (p || '_read')) is distinct from (v_old -> (p || '_read'))
         and (v_new -> (p || '_read') ->> 'changeSource') in ('document_read', 'typed', 'document_removed') then
        v_source := v_new -> (p || '_read') ->> 'changeSource';
      end if;
      insert into public.insurance_history (agency_id, policy_type, source, before, after, changed_by)
      values (new.id, p, v_source, v_before, v_after,
              (select pr.id from public.profiles pr where pr.id = auth.uid()));
    end if;
  end loop;
  return null;
end
$$;
revoke execute on function public.log_insurance_change() from public, anon, authenticated;

drop trigger if exists agencies_log_insurance_change on public.agencies;
create trigger agencies_log_insurance_change
  after update on public.agencies
  for each row execute function public.log_insurance_change();

-- ── 3. An ended subscription can't change it (0054) ───────────────────────
do $$
begin
  if to_regprocedure('public.guard_agency_not_ended()') is not null then
    drop trigger if exists insurance_history_not_ended_guard on public.insurance_history;
    create trigger insurance_history_not_ended_guard
      before insert or update or delete on public.insurance_history
      for each row execute function public.guard_agency_not_ended();
  end if;
end $$;

commit;

-- ── Verify. Expected: 9 columns, 3 checks, 1 table, 1 policy, 1 trigger, authenticated can read only ──
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'agencies'
      and column_name in ('pi_document_path', 'pi_document_file_name', 'pi_read',
                          'cyber_document_path', 'cyber_document_file_name', 'cyber_read',
                          'icare_document_path', 'icare_document_file_name', 'icare_read')) as columns_expect_9,
  (select count(*) from pg_constraint
    where conrelid = 'public.agencies'::regclass and conname like 'agencies_%_document_in_own_folder') as checks_expect_3,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'insurance_history')                      as tables_expect_1,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'insurance_history')                          as policies_expect_1,
  (select count(*) from pg_trigger
    where tgrelid = 'public.agencies'::regclass and tgname = 'agencies_log_insurance_change') as trigger_expect_1,
  has_table_privilege('authenticated', 'public.insurance_history', 'select')
    and not has_table_privilege('authenticated', 'public.insurance_history', 'insert')
    and not has_table_privilege('authenticated', 'public.insurance_history', 'update')
    and not has_table_privilege('authenticated', 'public.insurance_history', 'delete')  as read_only_expect_true;
