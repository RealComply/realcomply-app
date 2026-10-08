-- ===== RUN THIS ONE. Migration 0054, when a subscription ends, 8 October 2026 =====
--
-- MIGRATION 0054 — the records window, the write block, the activity record
-- and the deletion log
--
-- Brief: RealComply-cancellation-records-brief-8-Oct.md. Promised by Terms v.4
-- (data retention clause), DPA v.3 cl 4.8 and 4.9, and the Data Retention
-- Policy v3 (sections 5.1 and 6).
--
-- What this adds:
--
--   1. agencies.ended_at. The moment the subscription ended. Set by a trigger
--      when status moves to 'canceled', whoever made the move (the Stripe
--      webhook or a platform admin), and cleared when the agency becomes
--      current again. Deletion date = the Sydney calendar date of ended_at,
--      plus 14 days.
--   2. agencies.legal_hold. Data Retention Policy section 6. Only a platform
--      admin can set it. The deletion job skips any agency on hold.
--   3. agency_is_protected(). Cass Property, Comply Real Estate, any comped
--      agency, and any agency a platform admin belongs to. These never get an
--      ended_at, whatever Stripe says, and the deletion job refuses them.
--      Same list in code: src/lib/subscription-end/protected.ts.
--   4. The write block. Once ended, nothing in that agency can be created,
--      changed or deleted by its users: every table carrying agency_id, the
--      agency row itself, and its uploaded files. Reactivation lifts it,
--      because it is read from ended_at at the moment of each write.
--      The service key (the deletion job, the webhook, cron) and platform
--      admins are not blocked.
--   5. activity_records, deletion_certificates, deletion_runs. RealComply's
--      own store. No foreign key to agencies, so it survives the deletion.
--      Holds internal identifiers only, never names or addresses (DPA 4.9).
--
-- REVERSAL, 2 Oct 2026 (Adam): source documents are kept for the life of the
-- subscription. Nothing is purged at settlement. They are deleted with
-- everything else 14 days after the subscription ends.
--
-- Explicit grants for every new table (RealComply-supabase-data-api-grants-
-- 30-Oct.md). Nothing to anon.
--
-- SAFE TO RUN TWICE.

-- ─────────────────────────────────────────────────────────────────────────
-- 1 and 2. The fields
-- ─────────────────────────────────────────────────────────────────────────

alter table public.agencies
  add column if not exists ended_at timestamptz,
  add column if not exists ended_notice_sent_at timestamptz,
  add column if not exists ended_reminder_sent_at timestamptz,
  add column if not exists legal_hold boolean not null default false,
  add column if not exists legal_hold_reason text,
  add column if not exists legal_hold_set_at timestamptz;

comment on column public.agencies.ended_at is
  'When the subscription ended. Set by trigger when status moves to canceled; cleared on reactivation. Never set for a protected agency (agency_is_protected). Records are deleted on the Sydney date of this plus 14 days.';
comment on column public.agencies.legal_hold is
  'Data Retention Policy section 6. Set by a platform admin only. The deletion job skips an agency on hold.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Who is never ended and never deleted
-- ─────────────────────────────────────────────────────────────────────────
--
-- By id, not by name: an agency can rename itself. Comply Real Estate is
-- comped but has no comped_by, so a comped_by check alone would miss it.

create or replace function public.agency_is_protected_values(
  p_agency_id uuid,
  p_status text,
  p_comped_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_agency_id in (
           'b4763dfb-b33e-43bb-94ca-702a7e989a27'::uuid,  -- Cass Property
           '2972edd0-7995-4946-803b-064d2a50baee'::uuid   -- Comply Real Estate
         )
      or p_status = 'comped'
      or p_comped_by is not null
      or exists (
           select 1 from public.profiles p
           where p.agency_id = p_agency_id and p.is_platform_admin
         );
$$;

create or replace function public.agency_is_protected(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select public.agency_is_protected_values(a.id, a.status, a.comped_by)
       from public.agencies a where a.id = p_agency_id),
    -- No such agency: protected, so nothing acts on an id it cannot see.
    true);
$$;

grant execute on function public.agency_is_protected(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Setting and clearing ended_at
-- ─────────────────────────────────────────────────────────────────────────
--
-- In the database so it happens however the status changed. The comped
-- check uses the status BEFORE the change: a comped agency is protected even
-- in the update that tries to cancel it.

create or replace function public.agencies_track_end()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_protected boolean :=
    public.agency_is_protected_values(new.id, old.status, new.comped_by)
    or public.agency_is_protected_values(new.id, new.status, new.comped_by);
begin
  if new.status = 'canceled' and old.status is distinct from 'canceled' then
    if not v_protected and new.ended_at is null then
      new.ended_at := now();
    end if;
  elsif new.status in ('trialing', 'active', 'comped') then
    -- Reactivated. Everything returns as it was, straight away, and a later
    -- end starts a fresh 14 days with fresh emails.
    new.ended_at := null;
    new.ended_notice_sent_at := null;
    new.ended_reminder_sent_at := null;
  end if;

  -- The hard guard. Whatever wrote ended_at, a protected agency never has one.
  if v_protected then
    new.ended_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists agencies_track_end on public.agencies;
create trigger agencies_track_end
  before update on public.agencies
  for each row execute function public.agencies_track_end();

-- The new columns join the billing columns users cannot change for
-- themselves. Without this an agency could clear its own ended_at.
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

-- ─────────────────────────────────────────────────────────────────────────
-- 4. The write block
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.agency_has_ended(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.agencies a
    where a.id = p_agency_id and a.ended_at is not null
  );
$$;

grant execute on function public.agency_has_ended(uuid) to authenticated;

-- One function for every agency table. The agency id is read through jsonb
-- so the same function serves tables whose rows differ in every other way.
-- The agencies table is its own row: its id is the agency id.
create or replace function public.guard_agency_not_ended()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_agency uuid;
  -- Who is calling, from the request's token. Empty for the SQL editor and
  -- for jobs inside the database; 'service_role' for the service key (the
  -- deletion job, the webhook, cron). Checked by role rather than by
  -- auth.uid() being null, because the licensee sign-off link writes through
  -- a token-based function as 'anon' with no user id, and that must be
  -- blocked like anyone else.
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
begin
  if v_role in ('', 'service_role') then
    return coalesce(new, old);
  end if;

  if v_role = 'authenticated' and public.is_platform_admin() then
    return coalesce(new, old);
  end if;

  v_agency := case when tg_table_name = 'agencies'
                   then (v_row ->> 'id')::uuid
                   else (v_row ->> 'agency_id')::uuid end;

  -- An update that moves a row between agencies is checked against both.
  if tg_op = 'UPDATE' and tg_table_name <> 'agencies'
     and (to_jsonb(old) ->> 'agency_id') is distinct from (to_jsonb(new) ->> 'agency_id')
     and public.agency_has_ended((to_jsonb(old) ->> 'agency_id')::uuid) then
    v_agency := (to_jsonb(old) ->> 'agency_id')::uuid;
  end if;

  if v_agency is not null and public.agency_has_ended(v_agency) then
    raise exception
      'This agency''s subscription has ended, so nothing can be added or changed. Records can still be downloaded until they are deleted.'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'agencies',
    'profiles', 'agency_invites', 'assistant_agents',
    'properties', 'property_items', 'property_comparables', 'property_market_listings',
    'property_signoff_requests', 'property_transfers',
    'gifts', 'complaints', 'breaches',
    'cpd_records', 'cpd_year_signoffs',
    'training_sessions', 'training_attendance', 'training_plans', 'training_plan_items',
    'trust_accounts', 'trust_audits',
    'signoff_documents', 'signoff_signatures', 'sg_manual_versions',
    'licence_history',
    'pm_properties', 'pm_tenancies', 'pm_item_states', 'pm_group_moves', 'pm_records'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_not_ended_guard', t);
    execute format(
      'create trigger %I before insert or update or delete on public.%I
         for each row execute function public.guard_agency_not_ended()',
      t || '_not_ended_guard', t);
  end loop;
end
$$;

-- Uploaded files. Restrictive policies sit on top of the existing permissive
-- ones (0002), so an ended agency can still read its files but not add,
-- replace or remove any. The first folder of every path is the agency id.
create or replace function public.storage_path_agency_has_ended(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.agencies a
    where a.id::text = (storage.foldername(p_name))[1]
      and a.ended_at is not null
  );
$$;

grant execute on function public.storage_path_agency_has_ended(text) to authenticated;

drop policy if exists "compliance-evidence: no uploads once ended" on storage.objects;
create policy "compliance-evidence: no uploads once ended"
  on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'compliance-evidence' or not public.storage_path_agency_has_ended(name));

drop policy if exists "compliance-evidence: no changes once ended" on storage.objects;
create policy "compliance-evidence: no changes once ended"
  on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'compliance-evidence' or not public.storage_path_agency_has_ended(name));

drop policy if exists "compliance-evidence: no removals once ended" on storage.objects;
create policy "compliance-evidence: no removals once ended"
  on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'compliance-evidence' or not public.storage_path_agency_has_ended(name));

-- ─────────────────────────────────────────────────────────────────────────
-- 5. RealComply's own store, which survives the deletion
-- ─────────────────────────────────────────────────────────────────────────

-- The activity record. One per ended agency, copied before anything is
-- deleted. agency_ref is the deleted agency's internal id: no foreign key, so
-- it outlives the row it names. Kept 7 years from the end of the subscription
-- (DPA 4.9), then deleted by the daily job.
create table if not exists public.activity_records (
  agency_ref   uuid primary key,
  ended_at     timestamptz not null,
  copied_at    timestamptz not null default now(),
  delete_after timestamptz not null,
  counts       jsonb not null,
  record       jsonb not null
);

comment on table public.activity_records is
  'RealComply''s own activity record for an ended agency: what was recorded, flagged and signed off, by whom (internal id) and when. Internal identifiers only, never names, addresses or documents (DPA cl 4.9). Deleted after delete_after.';

-- The deletion certificate. RealComply's copy. Counts and categories only.
create sequence if not exists public.deletion_certificate_seq;

create table if not exists public.deletion_certificates (
  certificate_number text primary key,
  agency_ref         uuid not null unique,
  subscriber_name    text not null,
  ended_at           timestamptz not null,
  deleted_at         timestamptz not null,
  counts             jsonb not null,
  delete_after       timestamptz not null,
  pdf                bytea,
  created_at         timestamptz not null default now()
);

comment on table public.deletion_certificates is
  'RealComply''s copy of each deletion certificate. Categories and counts only, never contents. Kept 7 years (Data Retention Policy section 4).';

-- Every run of the deletion job, dry or real, so it can be seen to have
-- happened. A real run is resumable: its context is held here until it
-- completes, then the recipients are cleared.
create table if not exists public.deletion_runs (
  id                 bigint generated always as identity primary key,
  agency_ref         uuid not null,
  dry_run            boolean not null,
  status             text not null
    check (status in ('started', 'completed', 'skipped', 'blocked', 'failed', 'dry_run')),
  step               text,
  reason             text,
  counts             jsonb,
  context            jsonb,
  certificate_number text,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz
);

create index if not exists deletion_runs_agency_idx on public.deletion_runs (agency_ref, started_at desc);
create index if not exists deletion_runs_open_idx on public.deletion_runs (status) where status = 'started';

comment on table public.deletion_runs is
  'Log of the day-14 deletion job, dry and real, with counts. context holds what a resumed run needs (user ids, recipients) and is cleared on completion.';

alter table public.activity_records enable row level security;
alter table public.deletion_certificates enable row level security;
alter table public.deletion_runs enable row level security;

-- Written only by the service key. Readable by platform admins, for the staff
-- page. No agency-level access at all.
do $$
declare
  t text;
begin
  foreach t in array array['activity_records', 'deletion_certificates', 'deletion_runs']
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and policyname = t || ': platform admins can view'
    ) then
      execute format(
        'create policy %I on public.%I for select using (public.is_platform_admin())',
        t || ': platform admins can view', t);
    end if;
  end loop;
end
$$;

-- ── Grants (RealComply-supabase-data-api-grants-30-Oct.md). Nothing to anon.
-- Read-only for signed-in users (and RLS limits that to platform admins).
grant select on public.activity_records to authenticated;
grant select on public.deletion_certificates to authenticated;
grant select on public.deletion_runs to authenticated;
grant select, insert, update, delete on public.activity_records to service_role;
grant select, insert, update, delete on public.deletion_certificates to service_role;
grant select, insert, update, delete on public.deletion_runs to service_role;
grant usage on sequence public.deletion_certificate_seq to service_role;

create or replace function public.next_deletion_certificate_number()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select 'DEL-' || to_char(now() at time zone 'Australia/Sydney', 'YYYY') || '-' ||
         lpad(nextval('public.deletion_certificate_seq')::text, 4, '0');
$$;

revoke execute on function public.next_deletion_certificate_number() from public, anon, authenticated;
grant execute on function public.next_deletion_certificate_number() to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- The activity record itself
-- ─────────────────────────────────────────────────────────────────────────
--
-- Columns are named one by one: an ALLOW list, never a deny list. A column
-- added to a table later is left out until someone decides it belongs here.
-- No free text (notes, descriptions, typed names), no addresses, no
-- complainant or counterparty, no vendor or purchaser, no file names, no
-- `data` blobs. People appear by internal id only.

create or replace function public.build_activity_record(p_agency_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'agency', (select jsonb_build_object(
        'id', a.id, 'created_at', a.created_at, 'plan', a.plan, 'status', a.status,
        'ended_at', a.ended_at)
      from agencies a where a.id = p_agency_id),
    'users', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'created_at', p.created_at, 'is_agent', p.is_agent,
        'is_licensee_in_charge', p.is_licensee_in_charge, 'is_assistant', p.is_assistant,
        'licence_type', p.licence_type, 'archived_at', p.archived_at) order by p.created_at)
      from profiles p where p.agency_id = p_agency_id), '[]'),
    'listings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'created_by', x.created_by, 'created_at', x.created_at, 'stage', x.stage,
        'test_mode', x.test_mode, 'sale_method', x.sale_method,
        'review_requested_at', x.review_requested_at, 'review_requested_by', x.review_requested_by,
        'attributes_confirmed_at', x.attributes_confirmed_at,
        'attributes_confirmed_by', x.attributes_confirmed_by) order by x.created_at)
      from properties x where x.agency_id = p_agency_id), '[]'),
    'checklist', coalesce((select jsonb_agg(jsonb_build_object(
        'listing', i.property_id, 'item', i.item_key, 'status', i.status,
        'event_date', i.event_date, 'recorded_at', i.recorded_at,
        'completed_by', i.completed_by, 'created_at', i.created_at,
        'had_document', i.evidence_path is not null) order by i.created_at)
      from property_items i where i.agency_id = p_agency_id), '[]'),
    'listing_transfers', coalesce((select jsonb_agg(jsonb_build_object(
        'listing', t.property_id, 'from', t.from_agent, 'to', t.to_agent,
        'by', t.moved_by, 'at', t.moved_at) order by t.moved_at)
      from property_transfers t where t.agency_id = p_agency_id), '[]'),
    'licensee_signoff_links', coalesce((select jsonb_agg(jsonb_build_object(
        'listing', r.property_id, 'created_by', r.created_by, 'created_at', r.created_at,
        'ruleset_version', r.ruleset_version, 'signed_at', r.signed_at,
        'revoked_at', r.revoked_at) order by r.created_at)
      from property_signoff_requests r where r.agency_id = p_agency_id), '[]'),
    'document_signoffs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'category', d.category, 'period_month', d.period_month,
        'trust_account', d.trust_account_id, 'signer_scope', d.signer_scope,
        'uploaded_by', d.uploaded_by, 'created_at', d.created_at,
        'signed', d.signed_file_path is not null) order by d.created_at)
      from signoff_documents d where d.agency_id = p_agency_id), '[]'),
    'signatures', coalesce((select jsonb_agg(jsonb_build_object(
        'document', s.document_id, 'signer', s.signer_id, 'signed_at', s.signed_at)
        order by s.signed_at)
      from signoff_signatures s where s.agency_id = p_agency_id), '[]'),
    'gifts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'date', g.gift_date, 'direction', g.direction, 'status', g.status,
        'value', g.value, 'agent', g.profile_id, 'listing', g.property_id,
        'created_by', g.created_by, 'created_at', g.created_at) order by g.created_at)
      from gifts g where g.agency_id = p_agency_id), '[]'),
    'complaints', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'received', c.received_date, 'status', c.status,
        'resolved', c.resolved_date, 'agent', c.agent_id, 'listing', c.property_id,
        'created_by', c.created_by, 'created_at', c.created_at) order by c.created_at)
      from complaints c where c.agency_id = p_agency_id), '[]'),
    'breaches', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'identified', b.identified_date, 'category', b.category,
        'severity', b.severity, 'notifiable', b.notifiable, 'notified', b.notified_date,
        'corrective_action_date', b.corrective_action_date, 'status', b.status,
        'closed', b.closed_date, 'agent', b.agent_id, 'listing', b.property_id,
        'created_by', b.created_by, 'created_at', b.created_at) order by b.created_at)
      from breaches b where b.agency_id = p_agency_id), '[]'),
    'cpd', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'person', c.profile_id, 'category', c.category, 'hours', c.hours,
        'completed', c.completed_date, 'from_session', c.source_session_id,
        'had_document', c.evidence_path is not null,
        'created_by', c.created_by, 'created_at', c.created_at) order by c.created_at)
      from cpd_records c where c.agency_id = p_agency_id), '[]'),
    'cpd_year_signoffs', coalesce((select jsonb_agg(jsonb_build_object(
        'person', y.profile_id, 'year_start', y.cpd_year_start,
        'confirmed_by', y.confirmed_by, 'confirmed_at', y.confirmed_at) order by y.created_at)
      from cpd_year_signoffs y where y.agency_id = p_agency_id), '[]'),
    'training_sessions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'date', t.session_date, 'cpd_eligible', t.is_cpd_eligible,
        'cpd_hours', t.cpd_hours, 'external', t.is_external,
        'attended_by', (select coalesce(jsonb_agg(a.profile_id), '[]')
                          from training_attendance a where a.session_id = t.id),
        'created_by', t.created_by, 'created_at', t.created_at) order by t.created_at)
      from training_sessions t where t.agency_id = p_agency_id), '[]'),
    'training_plans', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'person', t.profile_id, 'year_start', t.cpd_year_start,
        'valid_from', t.valid_from, 'valid_to', t.valid_to,
        'consultation_date', t.consultation_date, 'required_hours', t.required_hours,
        'staff_signed_at', t.staff_signed_at, 'principal_signed_at', t.principal_signed_at,
        'items', (select coalesce(jsonb_agg(jsonb_build_object(
                    'classification', pi.classification, 'hours', pi.training_hours,
                    'due', pi.due_date, 'completed', pi.completed_date,
                    'counts_toward_cpd', pi.counts_toward_cpd)), '[]')
                  from training_plan_items pi where pi.plan_id = t.id),
        'created_by', t.created_by, 'created_at', t.created_at) order by t.created_at)
      from training_plans t where t.agency_id = p_agency_id), '[]'),
    'trust_accounts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'created_at', t.created_at, 'archived_at', t.archived_at)
        order by t.created_at)
      from trust_accounts t where t.agency_id = p_agency_id), '[]'),
    'trust_audits', coalesce((select jsonb_agg(jsonb_build_object(
        'trust_account', t.trust_account_id, 'period_end', t.period_end,
        'report_received', t.report_received_on, 'confirmed_by', t.confirmed_by,
        'confirmed_at', t.confirmed_at) order by t.created_at)
      from trust_audits t where t.agency_id = p_agency_id), '[]'),
    'licence_changes', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', h.subject_kind, 'person', h.profile_id, 'source', h.source,
        'changed_by', h.changed_by, 'changed_at', h.changed_at) order by h.changed_at)
      from licence_history h where h.agency_id = p_agency_id), '[]'),
    'reminders_sent', jsonb_build_object(
      'licence', coalesce((select jsonb_agg(jsonb_build_object(
          'kind', r.subject_kind, 'person', r.profile_id, 'expiry', r.expiry_date,
          'threshold_days', r.threshold_days, 'sent_at', r.sent_at) order by r.sent_at)
        from licence_reminders r where r.agency_id = p_agency_id), '[]'),
      'trust', coalesce((select jsonb_agg(jsonb_build_object(
          'kind', r.kind, 'period', r.period, 'stage', r.stage,
          'trust_account', r.trust_account_id, 'sent_at', r.sent_at) order by r.sent_at)
        from trust_reminders r where r.agency_id = p_agency_id), '[]')),
    'pm_properties', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'manager', p.manager_id, 'origin', p.origin, 'group', p.grp,
        'management_ended_on', p.management_ended_on,
        'created_by', p.created_by, 'created_at', p.created_at) order by p.created_at)
      from pm_properties p where p.agency_id = p_agency_id), '[]'),
    'pm_tenancies', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'property', t.property_id, 'seq', t.seq, 'before_stages', t.before_stages,
        'move_in', t.move_in_date, 'vacate', t.vacate_date, 'move_out', t.move_out_date,
        'ended_by', t.ended_by, 'created_at', t.created_at) order by t.created_at)
      from pm_tenancies t where t.agency_id = p_agency_id), '[]'),
    'pm_ticks', coalesce((select jsonb_agg(jsonb_build_object(
        'property', e.property_id, 'tenancy', e.tenancy_id, 'item', e.item_key,
        'state', e.state, 'by', e.changed_by, 'at', e.changed_at) order by e.changed_at)
      from pm_item_events e where e.agency_id = p_agency_id), '[]'),
    'pm_group_moves', coalesce((select jsonb_agg(jsonb_build_object(
        'property', m.property_id, 'tenancy', m.tenancy_id, 'from', m.from_grp,
        'to', m.to_grp, 'date', m.event_date, 'by', m.moved_by, 'at', m.moved_at)
        order by m.moved_at)
      from pm_group_moves m where m.agency_id = p_agency_id), '[]'),
    'pm_records', coalesce((select jsonb_agg(jsonb_build_object(
        'property', r.property_id, 'tenancy', r.tenancy_id, 'kind', r.kind,
        'by', r.recorded_by, 'at', r.recorded_at,
        'response_by', r.response_given_by, 'response_at', r.response_given_at)
        order by r.recorded_at)
      from pm_records r where r.agency_id = p_agency_id), '[]')
  );
$$;

revoke execute on function public.build_activity_record(uuid) from public, anon, authenticated;
grant execute on function public.build_activity_record(uuid) to service_role;

-- The counts on the certificate, by category. Uploaded documents are counted
-- from Storage by the job, not here.
create or replace function public.agency_deletion_counts(p_agency_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'listings',            (select count(*) from properties where agency_id = p_agency_id),
    'pm_properties',       (select count(*) from pm_properties where agency_id = p_agency_id),
    'gifts',               (select count(*) from gifts where agency_id = p_agency_id),
    'complaints',          (select count(*) from complaints where agency_id = p_agency_id),
    'breaches',            (select count(*) from breaches where agency_id = p_agency_id),
    'training_and_cpd',    (select count(*) from cpd_records where agency_id = p_agency_id)
                         + (select count(*) from training_sessions where agency_id = p_agency_id)
                         + (select count(*) from training_plans where agency_id = p_agency_id),
    'licence_records',     (select count(*) from profiles
                              where agency_id = p_agency_id and licence_number is not null)
                         + (select count(*) from agencies
                              where id = p_agency_id and corporation_licence_number is not null),
    'trust_reconciliations', (select count(*) from signoff_documents
                                where agency_id = p_agency_id and category = 'trust_reconciliation'),
    'trust_audits',        (select count(*) from trust_audits where agency_id = p_agency_id),
    'other_signoff_documents', (select count(*) from signoff_documents
                                  where agency_id = p_agency_id and category <> 'trust_reconciliation'),
    'user_accounts',       (select count(*) from profiles where agency_id = p_agency_id)
  );
$$;

revoke execute on function public.agency_deletion_counts(uuid) from public, anon, authenticated;
grant execute on function public.agency_deletion_counts(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- Verify. One row. Each number should match its column name.
-- ─────────────────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'agencies'
      and column_name in ('ended_at', 'ended_notice_sent_at', 'ended_reminder_sent_at',
                          'legal_hold', 'legal_hold_reason', 'legal_hold_set_at'))  as new_columns_expect_6,
  (select count(*) from pg_trigger where tgname like '%\_not\_ended\_guard')          as write_guards_expect_30,
  (select count(*) from pg_trigger where tgname = 'agencies_track_end')               as end_trigger_expect_1,
  (select count(*) from pg_policies where schemaname = 'storage'
     and policyname like 'compliance-evidence: no % once ended')                      as storage_guards_expect_3,
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('activity_records', 'deletion_certificates', 'deletion_runs')) as store_tables_expect_3,
  (select count(*) from public.agencies a where public.agency_is_protected(a.id)
     and a.id in ('b4763dfb-b33e-43bb-94ca-702a7e989a27', '2972edd0-7995-4946-803b-064d2a50baee'))
                                                                                       as cass_and_comply_protected_expect_2,
  (select count(*) from public.agencies where ended_at is not null)                   as ended_agencies_expect_0;
