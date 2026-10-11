-- 0064, 11 October 2026: a sign-off link's token is always the database's.
--
-- Until now a signed-in person could create a licensee sign-off link with a
-- token of their own choosing, and then use that token to sign the final
-- sign-off as the licensee. This makes the database choose the token, the
-- expiry and the email status for every new link, whatever the browser sends.
-- Everything else is exactly as 0062 left it. Existing links are not changed.
--
-- Safe to run more than once. Safe while the current app is live: the app
-- never sends a token, expiry or email status when it creates a link.

begin;

create or replace function public.guard_signoff_request_insert()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if public.listing_has_open_send_back(new.property_id) then
    raise exception 'Some cards your licensee flagged are not marked "Changes made" yet.';
  end if;
  select a.licensee_email into new.sent_to from public.agencies a where a.id = new.agency_id;
  if new.sent_to is null or btrim(new.sent_to) = '' then
    raise exception 'Add the licensee''s email before sending a sign-off link.';
  end if;
  new.created_by := auth.uid();
  new.signed_at := null;
  new.signed_name := null;
  -- The link's credential and lifetime come from the database, never the browser.
  new.token := gen_random_uuid();
  new.created_at := now();
  new.expires_at := now() + interval '30 days';
  new.revoked_at := null;
  new.email_sent_at := null;
  new.email_attempts := 0;
  new.email_error := null;
  return new;
end
$$;
revoke execute on function public.guard_signoff_request_insert() from public, anon, authenticated;

commit;

-- Check: one row, true.
select position('new.token := gen_random_uuid()' in
         pg_get_functiondef('public.guard_signoff_request_insert()'::regprocedure)) > 0 as token_set_by_database;
