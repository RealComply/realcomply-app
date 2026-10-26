-- ===== 0096: the office manager card on Home, seen once (Adam, 26 Oct 2026) =====
--
-- The "You're now office manager" card on Home was too big once it had been
-- seen. It now shows once, with a "Got it" button. After "Got it", or on the
-- next visit to Home, whichever comes first, it becomes one small grey line
-- at the top of Home linking to Team. A withdrawal shows once, then goes.
-- The "Ask your licensee to approve" and "Waiting" cards are unchanged: they
-- need action.
--
-- This records, per person, which of those cards they have seen and when
-- they pressed "Got it". The office manager and the licensee in charge (if
-- they have a login) each have their own record.
--
-- One new table, with its grants in this file (from 30 Oct 2026 Supabase
-- stops granting new tables to the API roles by default). Safe to run twice.

create table if not exists public.home_notices_seen (
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  -- Which card: 'om-approved:<office_managers.id>' or 'om-withdrawn:<office_managers.id>'.
  notice_key    text not null check (notice_key ~ '^om-(approved|withdrawn):[0-9a-f-]{36}$'),
  -- The first time the card was on their Home.
  first_seen_at timestamptz not null default now(),
  -- When they pressed "Got it"; null if the card went on a second visit.
  dismissed_at  timestamptz,
  primary key (profile_id, notice_key)
);
comment on table public.home_notices_seen is
  'Which Home cards each person has seen, and when they pressed "Got it" (0096, Adam 26 Oct 2026). Written only by note_home_notice().';

alter table public.home_notices_seen enable row level security;
drop policy if exists "home_notices_seen: own" on public.home_notices_seen;
create policy "home_notices_seen: own" on public.home_notices_seen
  for select to authenticated
  using (profile_id = auth.uid());

revoke all on table public.home_notices_seen from public, anon, authenticated;
grant select on public.home_notices_seen to authenticated;
grant select, insert, update, delete on public.home_notices_seen to service_role;

-- Records that the signed-in person has seen a card (and, with p_dismiss,
-- pressed "Got it"). Only for an office manager record in their own office.
-- The first time seen and the first "Got it" are kept; later calls change
-- nothing.
create or replace function public.note_home_notice(p_key text, p_dismiss boolean default false)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if p_key is null or p_key !~ '^om-(approved|withdrawn):[0-9a-f-]{36}$' then
    raise exception 'Unknown card.';
  end if;
  v_record := split_part(p_key, ':', 2)::uuid;
  if not exists (select 1 from public.office_managers
                  where id = v_record and agency_id = public.current_agency_id()) then
    raise exception 'Unknown card.';
  end if;

  insert into public.home_notices_seen (profile_id, notice_key, dismissed_at)
  values (auth.uid(), p_key, case when p_dismiss then now() end)
  on conflict (profile_id, notice_key) do update
    set dismissed_at = coalesce(public.home_notices_seen.dismissed_at, excluded.dismissed_at);
  return true;
end
$$;

revoke execute on function public.note_home_notice(text, boolean) from public, anon;
grant execute on function public.note_home_notice(text, boolean) to authenticated;

-- What it shows when it has run: true, true.
select to_regclass('public.home_notices_seen') is not null as seen_record_ready,
       has_function_privilege('authenticated', 'public.note_home_notice(text, boolean)', 'execute')
         and not has_function_privilege('anon', 'public.note_home_notice(text, boolean)', 'execute') as only_signed_in;
