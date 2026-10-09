-- ===== 0059: is the signed-in person the account holder? 9 October 2026 =====
--
-- Found in the agent access preview check. The account holder is whoever
-- created the agency, which is the agency's earliest profile (see
-- src/lib/subscription-end/access.ts). The app worked that out by reading the
-- agency's profiles in created order through the signed-in person's own
-- connection. Since 0058 an agent can see only themself and their
-- assistants, so the earliest profile an agent could see was their own, and
-- every agent counted as the account holder: typing /dashboard/billing
-- opened Billing for them.
--
-- This answers the one question for the signed-in person only, yes or no. It
-- reveals nothing about anyone else.
--
-- RUN THIS BEFORE MERGING the agent access branch. The app treats an error
-- (this function not there yet) as no, which is safe for security but would
-- stop a new founder who is not the licensee from starting their trial. It
-- changes nothing for the app that is live now, so it can run any time
-- before the merge.
--
-- Used by the Billing page, starting checkout, the trial-start screen and the
-- records page after a subscription ends. The cron jobs still use
-- accountHolderId() with the service client.
--
-- ALSO: profiles.created_at can no longer be changed from the app. "Earliest
-- profile" is what makes someone the account holder, and signed-in people
-- could rewrite their own created_at (review of this change, 9 Oct 2026), so
-- anyone could have made themself the account holder. Its own small guard,
-- so Adam's 0057 guard stays exactly as he ran it.
--
-- ALSO: an assistant to an agent on their own plan no longer counts as the
-- licensee. acts_as_licensee() (0058) gave everyone on an agent plan the
-- licensee's powers, meaning the agent, but an assistant there would have
-- got them too: deletes, the agency's details, trust, the team. No agency on
-- an agent plan exists yet, so nobody has had them.
--
-- Tests: supabase/tests/agent_access.sql.

create or replace function public.is_account_holder()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles me
     where me.id = auth.uid()
       and me.id = (select p.id
                      from public.profiles p
                     where p.agency_id = me.agency_id
                     order by p.created_at asc
                     limit 1)
  );
$$;

revoke execute on function public.is_account_holder() from public, anon;
grant execute on function public.is_account_holder() to authenticated;

create or replace function public.guard_profile_created_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $f$
begin
  -- Security invoker on purpose: current_user is then the caller's role.
  -- Database functions with higher rights, and the service role, pass.
  if current_user in ('authenticated', 'anon') and new.created_at is distinct from old.created_at then
    raise exception 'This change is not allowed.';
  end if;
  return new;
end
$f$;

revoke execute on function public.guard_profile_created_at() from public, anon, authenticated;

drop trigger if exists profiles_created_at_guard on public.profiles;
create trigger profiles_created_at_guard
  before update on public.profiles
  for each row execute function public.guard_profile_created_at();

create or replace function public.acts_as_licensee()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((
    select me.is_licensee_in_charge or (left(a.plan, 6) = 'agent_' and not me.is_assistant)
      from public.profiles me
      join public.agencies a on a.id = me.agency_id
     where me.id = auth.uid() and me.archived_at is null), false);
$$;
