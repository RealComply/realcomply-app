-- ===== 0057: stop people changing their own role, 9 October 2026 =====
--
-- ALREADY LIVE. Adam ran this in the Supabase SQL editor on 9 Oct 2026
-- (claude/RealComply-urgent-profile-guard-9-Oct.sql). This file is here so the
-- repo's migration history matches the live database. Running it again is
-- harmless: it replaces the function and the trigger with the same thing.
--
-- THE HOLE IT CLOSES (code review 9 Oct, finding 1). The policy "profiles:
-- users can update their own profile" (0001) checks only that the row is the
-- user's own, and signed-in users hold UPDATE on every column. So anyone could
-- make themselves platform admin or licensee in charge, drop their assistant
-- limit, un-archive themselves, or move into another agency by changing
-- agency_id — straight from the browser with their own login.
--
-- WHAT IT DOES. A trigger on every update of profiles, for calls made by the
-- app's own users (roles authenticated and anon):
--   - id, agency_id and is_platform_admin can't be changed by anyone;
--   - is_licensee_in_charge, is_assistant, is_agent, archived_at and
--     archived_by can be changed only by a current licensee in charge of the
--     same agency;
--   - everything else (name, phone and the like) is unchanged.
-- Database functions that run with higher rights, and the service role, pass
-- through, so invites, archiving and the admin tools keep working.
--
-- Tests: supabase/tests/profile_privileged_columns.sql.

create or replace function public.guard_profile_privileged_columns()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_caller_is_licensee boolean;
begin
  -- Only direct calls from the app's users are checked. Database functions
  -- that run with higher rights, and the service role, pass through.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.agency_id is distinct from old.agency_id
     or new.is_platform_admin is distinct from old.is_platform_admin then
    raise exception 'This change is not allowed.';
  end if;

  if new.is_licensee_in_charge is distinct from old.is_licensee_in_charge
     or new.is_assistant is distinct from old.is_assistant
     or new.is_agent is distinct from old.is_agent
     or new.archived_at is distinct from old.archived_at
     or new.archived_by is distinct from old.archived_by then
    select coalesce(bool_or(me.is_licensee_in_charge), false)
      into v_caller_is_licensee
      from public.profiles me
     where me.id = auth.uid()
       and me.agency_id = old.agency_id
       and me.archived_at is null;
    if not v_caller_is_licensee then
      raise exception 'Only the licensee in charge can change roles.';
    end if;
  end if;

  return new;
end
$function$;

-- A trigger function is never called directly. Live it is executable by
-- postgres and service_role only.
revoke execute on function public.guard_profile_privileged_columns() from public, anon, authenticated;

drop trigger if exists profiles_privileged_columns_guard on public.profiles;
create trigger profiles_privileged_columns_guard
  before update on public.profiles
  for each row execute function public.guard_profile_privileged_columns();
