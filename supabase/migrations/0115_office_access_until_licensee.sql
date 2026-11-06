-- ===== 0115: Office access until the licensee approves =====
--
-- Adam, 6 Nov 2026: an agent who moves their account from an agent plan to an
-- office plan keeps the office side (Team, Registers, Office profile and the
-- rest an office manager has) until their licensee in charge approves them as
-- office manager or joins RealComply. The rule Adam chose for self-serve plan
-- changes ("A, agent keeps access until licensee joins"), first for Uralla
-- Properties: Christine Clark keeps it until Suzanne Stirling approves.
--
-- How: one row per office names the person who keeps access, and since when.
-- While it holds they count as office manager (is_office_manager()), so every
-- rule that already lets an office manager in lets them in too, and nothing
-- more: what stays with the licensee in charge (file sign-offs, the annexure,
-- changing the licensee, deletes) still asks acts_as_licensee(). It ends by
-- itself, for good, when any of these happens:
--   - the office has a licensee in charge on RealComply;
--   - the licensee approves anyone in the office as office manager after it
--     started (or this person has ever had an approval of their own);
--   - the person leaves the office, or becomes licensee in charge;
--   - the office goes back to an agent plan.
-- The row stays as the record of what was given; it is never re-read as
-- access once ended, because the end is worked out from those facts.
--
-- The person can still ask to be office manager: request_office_manager()
-- now checks only a real approval (is_approved_office_manager()), word for
-- word as 0093 otherwise.
--
-- Rows are added by RealComply (the SQL editor, the server; later the
-- self-serve plan change). Nobody signed in can write them.
--
-- One new table, with its grants. Safe to run twice.

begin;

-- Order check.
do $$
begin
  if to_regclass('public.office_managers') is null
     or to_regprocedure('public.office_has_active_licensee()') is null
     or to_regprocedure('public.current_agency_id()') is null
     or to_regprocedure('public.licensee_confirm_first_message(uuid)') is null then
    raise exception 'Run 0066, 0093 and 0112 before this one. Nothing was changed.';
  end if;
end $$;

-- ── 1. Who keeps office access, and since when ──────────────────────────
create table if not exists public.office_access_until_licensee (
  agency_id   uuid primary key references public.agencies (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  -- Why, in words: e.g. "Moved from Agent 1 to Office 1 on 6 Nov 2026".
  reason      text not null check (char_length(btrim(reason)) between 1 and 300),
  started_at  timestamptz not null default now()
);
comment on table public.office_access_until_licensee is
  'An agent who moved to an office plan keeps office manager access until their licensee in charge approves them or joins (0115, Adam 6 Nov 2026). One row per office. When it ends is worked out by keeps_office_access().';

alter table public.office_access_until_licensee enable row level security;
drop policy if exists "office_access_until_licensee: office can view" on public.office_access_until_licensee;
create policy "office_access_until_licensee: office can view" on public.office_access_until_licensee
  for select to authenticated
  using (agency_id = public.current_agency_id());

revoke all on table public.office_access_until_licensee from public, anon, authenticated;
grant select on public.office_access_until_licensee to authenticated;
grant select, insert, update, delete on public.office_access_until_licensee to service_role;

-- ── 2. Whether the signed-in person keeps it now ────────────────────────
create or replace function public.keeps_office_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.office_access_until_licensee k
      join public.profiles me on me.id = k.profile_id and me.agency_id = k.agency_id
      join public.agencies a on a.id = k.agency_id
     where k.profile_id = auth.uid()
       and me.archived_at is null
       and not coalesce(me.is_licensee_in_charge, false)
       and not coalesce(me.is_assistant, false)
       and left(coalesce(a.plan, ''), 6) <> 'agent_'
       and not exists (select 1 from public.profiles p
                        where p.agency_id = k.agency_id
                          and p.is_licensee_in_charge and p.archived_at is null)
       and not exists (select 1 from public.office_managers m
                        where m.agency_id = k.agency_id
                          and (m.profile_id = k.profile_id or m.approved_at >= k.started_at)));
$$;
revoke execute on function public.keeps_office_access() from public, anon;
grant execute on function public.keeps_office_access() to authenticated, service_role;

-- ── 3. Office manager: approved, or keeping access until approved ───────
-- 0093's test, word for word, under its own name.
create or replace function public.is_approved_office_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.office_managers m
      join public.profiles me on me.id = m.profile_id and me.agency_id = m.agency_id
      join public.agencies a on a.id = m.agency_id
     where m.profile_id = auth.uid()
       and m.withdrawn_at is null
       and me.archived_at is null
       and left(coalesce(a.plan, ''), 6) <> 'agent_');
$$;
revoke execute on function public.is_approved_office_manager() from public, anon;
grant execute on function public.is_approved_office_manager() to authenticated, service_role;

create or replace function public.is_office_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_approved_office_manager() or public.keeps_office_access();
$$;
revoke execute on function public.is_office_manager() from public, anon;
grant execute on function public.is_office_manager() to authenticated, service_role;

-- ── 4. Asking to be office manager ──────────────────────────────────────
-- 0093's function word for word, except that "already office manager" means
-- a real approval: someone keeping access until approved can still ask.
create or replace function public.request_office_manager()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me public.profiles;
  v_agency public.agencies;
  v_email text;
  v_id uuid;
begin
  select * into v_me from public.profiles where id = auth.uid() and archived_at is null;
  if v_me.id is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select * into v_agency from public.agencies where id = v_me.agency_id;
  if v_agency.ended_at is not null then
    raise exception 'This office''s subscription has ended.';
  end if;
  if left(coalesce(v_agency.plan, ''), 6) = 'agent_' then
    raise exception 'On your own plan, you already run your account.';
  end if;
  if v_me.is_licensee_in_charge then
    raise exception 'You''re the licensee in charge.';
  end if;
  if public.is_approved_office_manager() then
    raise exception 'You''re already office manager.';
  end if;
  if public.office_has_active_licensee() then
    raise exception 'Your licensee in charge is on RealComply. Ask them to make you office manager in Team.';
  end if;
  v_email := lower(nullif(btrim(v_agency.licensee_email), ''));
  if v_email is null then
    raise exception 'There''s no email for your licensee in charge. Email admin@realcomply.com.au and we''ll add it.';
  end if;
  if public.licensee_email_is_a_member() then
    raise exception 'The licensee''s email on file is the login of someone in your office. It needs to be your licensee''s own email. Email admin@realcomply.com.au and we''ll correct it.';
  end if;

  -- An old request, out of date or to an address since changed, is closed.
  update public.office_manager_requests
     set cancelled_at = now()
   where agency_id = v_agency.id and profile_id = v_me.id
     and approved_at is null and cancelled_at is null
     and (expires_at <= now() or sent_to <> v_email);

  select id into v_id from public.office_manager_requests
   where agency_id = v_agency.id and profile_id = v_me.id
     and approved_at is null and cancelled_at is null;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.office_manager_requests (agency_id, profile_id, sent_to, licensee_name, wording, created_by)
  values (v_agency.id, v_me.id, v_email, nullif(btrim(v_agency.licensee_name), ''),
          public.office_manager_wording(coalesce(nullif(btrim(v_me.full_name), ''), v_me.email), v_agency.name),
          v_me.id)
  returning id into v_id;
  return v_id;
end
$$;
revoke execute on function public.request_office_manager() from public, anon;
grant execute on function public.request_office_manager() to authenticated;

commit;

-- ── Verify. Expected: true, true, true, true, 0 rows yet (Uralla's row is a
-- separate file), authenticated can read only ──
select
  to_regclass('public.office_access_until_licensee') is not null                              as table_made,
  (select count(*) = 1 from pg_policies
    where schemaname = 'public' and tablename = 'office_access_until_licensee')               as one_policy,
  to_regprocedure('public.keeps_office_access()') is not null
    and to_regprocedure('public.is_approved_office_manager()') is not null                    as functions_made,
  position('keeps_office_access' in pg_get_functiondef('public.is_office_manager()'::regprocedure)) > 0 as office_manager_includes_it,
  (select count(*) from public.office_access_until_licensee)                                  as rows_now,
  has_table_privilege('authenticated', 'public.office_access_until_licensee', 'select')
    and not has_table_privilege('authenticated', 'public.office_access_until_licensee', 'insert') as authenticated_reads_only;
