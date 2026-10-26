-- ===== 0094: A reminder that didn't go can be sent again =====
--
-- Found in testing 0093 (26 Oct 2026). claim_staff_reminder counted every
-- reminder claimed in the last 20 hours, including one whose email failed.
-- So a failed send blocked the next try for a day, and the SG Manual page
-- said "Reminded" although nothing went.
--
--   Was (0093): any reminder claimed in the last 20 hours blocks the next.
--   Now: one that went (email_sent_at) in the last 20 hours blocks the next.
--        One not recorded as sent blocks for 5 minutes only, so two presses
--        still send one email, and "Try again in a few minutes" is true.
--
-- Only this function changes. No new tables. Safe to run twice.

create or replace function public.claim_staff_reminder(p_profile_id uuid, p_kinds text[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_id uuid;
begin
  if v_agency is null or not public.runs_office() then
    raise exception 'Only the licensee in charge or an office manager can send reminders.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles
                  where id = p_profile_id and agency_id = v_agency and archived_at is null)
     or p_profile_id = auth.uid() then
    raise exception 'That person isn''t in your office.';
  end if;
  -- One at a time per person, so two presses can't both pass the check below.
  perform pg_advisory_xact_lock(hashtext('staff_reminders:' || p_profile_id::text));
  -- Sent in the last 20 hours, or being sent (or just failed) in the last 5
  -- minutes (0094).
  if exists (select 1 from public.staff_reminders
              where profile_id = p_profile_id
                and (email_sent_at > now() - interval '20 hours'
                     or (email_sent_at is null and created_at > now() - interval '5 minutes'))) then
    return null;
  end if;
  insert into public.staff_reminders (agency_id, profile_id, kinds, sent_by)
  values (v_agency, p_profile_id, p_kinds, auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

revoke execute on function public.claim_staff_reminder(uuid, text[]) from public, anon;
grant execute on function public.claim_staff_reminder(uuid, text[]) to authenticated;

-- What it shows when it has run: true.
select position('email_sent_at > now()' in pg_get_functiondef('public.claim_staff_reminder(uuid, text[])'::regprocedure)) > 0
       as failed_sends_can_retry;
