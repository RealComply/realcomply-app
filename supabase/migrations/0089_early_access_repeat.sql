-- 0089: someone already on the early access list signs up again.
--
-- Adam, 23 Oct 2026: "what if someone registered, never went ahead with
-- signing up and then responded to one of our ads again and wanted to
-- register again? I feel like that's a gap." Until now a repeat hit the
-- unique email index and vanished.
--
-- The form runs with the anon key, which can only insert (0013), so it cannot
-- look up the existing row. This function does just the two things a repeat
-- needs, and nothing else:
--   1. Fills in details the row is MISSING (first name, office, mobile). It
--      never overwrites one already there: anyone can type anyone's email,
--      so a stranger must not be able to change a real person's details.
--   2. Says whether they unsubscribed, so the site knows not to email them.
--      Only the server sees the answer; the page shows the same "Thanks".
--
-- Returns 'unsubscribed', 'ok', or 'missing' (no such row, which should not
-- happen right after a unique-index clash, but is handled).

create or replace function public.early_access_repeat(
  p_email text,
  p_first_name text,
  p_agency_name text,
  p_phone text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unsubscribed timestamptz;
begin
  update public.early_access
     set first_name  = coalesce(nullif(trim(first_name), ''), nullif(trim(left(p_first_name, 80)), '')),
         agency_name = coalesce(nullif(trim(agency_name), ''), nullif(trim(left(p_agency_name, 160)), '')),
         phone       = coalesce(nullif(trim(phone), ''), nullif(trim(left(p_phone, 30)), ''))
   where lower(email) = lower(trim(p_email))
  returning unsubscribed_at into v_unsubscribed;

  if not found then
    return 'missing';
  end if;

  return case when v_unsubscribed is not null then 'unsubscribed' else 'ok' end;
end;
$$;

revoke all on function public.early_access_repeat(text, text, text, text) from public;
grant execute on function public.early_access_repeat(text, text, text, text) to anon, authenticated;
