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
-- reveals nothing about anyone else. The app treats an error (this function
-- not there yet) as no, so the app can go out before or after this runs.
--
-- Used by the Billing page, starting checkout, the trial-start screen and the
-- records page after a subscription ends. The cron jobs still use
-- accountHolderId() with the service client.
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
