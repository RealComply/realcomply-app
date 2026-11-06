-- ===== 0116: Self-serve plan changes =====
--
-- Mockup signed off by Adam, 6 Nov 2026 (Change plan on Billing). Whoever
-- pays (the licensee in charge, the agent on their own plan, or the account
-- holder) changes the plan on RealComply's own page, so the app and Stripe
-- change together and Adam is emailed every time.
--
--   1. plan_changes: one row per change. From what to what, monthly or
--      yearly, when it takes effect (now, or the next billing date), what
--      was charged today, who did it, and for an agent moving to an office
--      plan, who they said the licensee in charge is. Written by the server
--      only. The office side and the account holder can read their own.
--   2. apply_plan_change_licensee(): an agent moving to an office plan says
--      who the licensee in charge is.
--        "I am": they're marked licensee in charge, and the office's
--        licensee name and email become theirs (their login).
--        "Someone else": the office's licensee name and email become what
--        they typed, and they keep the office side until that licensee
--        approves them as office manager or joins (0115, Adam: "A, agent
--        keeps access until licensee joins"). The confirm-first email
--        (0112) goes from the app, before any link goes to that address.
--      Server only, after Stripe has taken the payment and the office is on
--      the office plan.
--
-- One new table, with its grants. Safe to run twice.

begin;

-- Order check.
do $$
begin
  if to_regclass('public.office_access_until_licensee') is null
     or to_regclass('public.licensee_in_charge_history') is null
     or to_regclass('public.licensee_email_confirmations') is null
     or to_regprocedure('public.is_account_holder()') is null
     or to_regprocedure('public.runs_office()') is null then
    raise exception 'Run 0080, 0093, 0112 and 0115 before this one. Nothing was changed.';
  end if;
end $$;

-- ── 1. The record of every plan change ──────────────────────────────────
create table if not exists public.plan_changes (
  id                 uuid primary key default gen_random_uuid(),
  agency_id          uuid not null references public.agencies (id) on delete cascade,
  changed_by         uuid references public.profiles (id) on delete set null,
  -- The name as it was, so the record reads the same after they leave.
  changed_by_name    text check (changed_by_name is null or char_length(changed_by_name) <= 200),
  from_plan          text not null check (from_plan ~ '^(agent_[1-3]|office_[1-5])$'),
  from_interval      text not null check (from_interval in ('monthly', 'annual')),
  to_plan            text not null check (to_plan ~ '^(agent_[1-3]|office_[1-5])$'),
  to_interval        text not null check (to_interval in ('monthly', 'annual')),
  -- 'now': the plan changed straight away. 'next_billing_date': Stripe makes
  -- the change on effective_at (a schedule). Both can be true of one change:
  -- an upgrade now, then monthly to yearly from the next billing date.
  takes_effect       text not null check (takes_effect in ('now', 'next_billing_date', 'now_then_next')),
  effective_at       timestamptz not null,
  -- The next billing date when the change was made: when the new price is
  -- next charged.
  next_payment_at    timestamptz,
  -- What Stripe charged today, GST included, in cents. 0 for a change from
  -- the next billing date, or during the free trial.
  amount_today_cents integer not null default 0 check (amount_today_cents >= 0),
  -- The new price each month or year, GST included, in cents.
  ongoing_cents      integer not null check (ongoing_cents >= 0),
  stripe_invoice_id  text check (stripe_invoice_id is null or char_length(stripe_invoice_id) <= 100),
  stripe_schedule_id text check (stripe_schedule_id is null or char_length(stripe_schedule_id) <= 100),
  licensee_answer    text check (licensee_answer in ('self', 'someone_else')),
  licensee_name      text check (licensee_name is null or char_length(licensee_name) <= 200),
  licensee_email     text check (licensee_email is null or char_length(licensee_email) <= 320),
  -- 'scheduled' until the next billing date; 'kept_current' when the person
  -- chose to keep their plan instead before then.
  status             text not null default 'done' check (status in ('done', 'scheduled', 'kept_current')),
  kept_at            timestamptz,
  created_at         timestamptz not null default now()
);
comment on table public.plan_changes is
  'Every self-serve plan change (0116, Adam 6 Nov 2026): from and to, monthly or yearly, when it takes effect, what was charged today, who did it, and the licensee answer for an agent moving to an office plan. Written by the server only.';
create index if not exists plan_changes_agency_idx on public.plan_changes (agency_id, created_at desc);

alter table public.plan_changes enable row level security;
drop policy if exists "plan_changes: office side and account holder can view" on public.plan_changes;
create policy "plan_changes: office side and account holder can view" on public.plan_changes
  for select to authenticated
  using (agency_id = public.current_agency_id() and (public.runs_office() or public.is_account_holder()));

revoke all on table public.plan_changes from public, anon, authenticated;
grant select on public.plan_changes to authenticated;
grant select, insert, update, delete on public.plan_changes to service_role;

-- ── 2. Who the licensee in charge is, after moving to an office plan ────
-- Asked before anything is charged: what's wrong with the answer, or null.
create or replace function public.plan_change_licensee_problem(p_agency uuid, p_profile uuid, p_answer text, p_name text, p_email text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_answer = 'self' then null
    when p_answer is distinct from 'someone_else' then 'Say who the licensee in charge is.'
    when nullif(btrim(coalesce(p_name, '')), '') is null then 'Add the licensee''s name.'
    when char_length(btrim(p_name)) > 200 then 'The licensee''s name is too long.'
    when nullif(lower(btrim(coalesce(p_email, ''))), '') is null
      or lower(btrim(p_email)) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
      or char_length(btrim(p_email)) > 320 then 'Add the licensee''s email.'
    when exists (select 1 from public.profiles p join auth.users u on u.id = p.id
                  where p.agency_id = p_agency and lower(btrim(u.email)) = lower(btrim(p_email)))
      then 'That email is the login of someone in your office. Use your licensee''s own email.'
    else null
  end;
$$;
revoke execute on function public.plan_change_licensee_problem(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.plan_change_licensee_problem(uuid, uuid, text, text, text) to service_role;

create or replace function public.apply_plan_change_licensee(
  p_agency uuid,
  p_profile uuid,
  p_answer text,
  p_name text,
  p_email text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me public.profiles;
  v_plan text;
  v_login text;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  select * into v_me from public.profiles
   where id = p_profile and agency_id = p_agency and archived_at is null;
  if v_me.id is null then
    raise exception 'That person isn''t in this office.';
  end if;
  select a.plan into v_plan from public.agencies a where a.id = p_agency and a.ended_at is null;
  if v_plan is null or left(v_plan, 6) = 'agent_' then
    raise exception 'The office isn''t on an office plan yet.';
  end if;
  select lower(btrim(u.email)) into v_login from auth.users u where u.id = p_profile;

  if p_answer = 'self' then
    update public.profiles set is_licensee_in_charge = true where id = p_profile;
    update public.agencies
       set licensee_name = coalesce(nullif(btrim(v_me.full_name), ''), v_login),
           licensee_email = v_login
     where id = p_agency;
  elsif p_answer = 'someone_else' then
    if public.plan_change_licensee_problem(p_agency, p_profile, p_answer, p_name, p_email) is not null then
      raise exception '%', public.plan_change_licensee_problem(p_agency, p_profile, p_answer, p_name, p_email);
    end if;
    update public.agencies set licensee_name = v_name, licensee_email = v_email where id = p_agency;
    insert into public.office_access_until_licensee (agency_id, profile_id, reason)
    values (p_agency, p_profile, left(coalesce(nullif(btrim(p_reason), ''), 'Moved to an office plan'), 300))
    on conflict (agency_id) do update
      set profile_id = excluded.profile_id, reason = excluded.reason, started_at = now();
  else
    raise exception 'Say who the licensee in charge is.';
  end if;
end
$$;
revoke execute on function public.apply_plan_change_licensee(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_plan_change_licensee(uuid, uuid, text, text, text, text) to service_role;

commit;

-- ── Verify. Expected: true, true, true, 0, true, false, true ──
-- (function_made counts both functions.)
select
  to_regclass('public.plan_changes') is not null                                               as table_made,
  (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'plan_changes') as one_policy,
  to_regprocedure('public.apply_plan_change_licensee(uuid,uuid,text,text,text,text)') is not null
    and to_regprocedure('public.plan_change_licensee_problem(uuid,uuid,text,text,text)') is not null as function_made,
  (select count(*) from public.plan_changes)                                                    as rows_now,
  has_table_privilege('authenticated', 'public.plan_changes', 'select')                          as authenticated_reads,
  has_table_privilege('authenticated', 'public.plan_changes', 'insert')                          as authenticated_writes,
  not has_function_privilege('authenticated', 'public.apply_plan_change_licensee(uuid,uuid,text,text,text,text)', 'execute') as only_the_server_applies;
