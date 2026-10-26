-- ===== 0097: the licensee's details at sign-up (fix to 0095, 26 Oct 2026) =====
--
-- 0095 made the licensee's name and email the licensee's alone to change
-- (Adam, 26 Oct, as decided 9 Oct). That also stopped them being saved at
-- sign-up: when the person setting up an office answers "No, someone else"
-- to "Are you the licensee in charge?", the app saves the licensee's name
-- and email right after the office is created, as that person, who isn't
-- the licensee. Since 0095 that was refused, so a new office of that kind
-- started with no licensee name or email (found in testing on a made-up
-- office; no real office signed up in between).
--
-- Now: the person who set the office up may fill them in once, at sign-up
-- only. That is, within an hour of the office being created, while both are
-- still blank and no licensee in charge is on RealComply. After that,
-- changing them is the licensee's alone, as 0095.
--
-- Safe to run twice.

create or replace function public.may_fill_licensee_details_at_signup()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_agency_id() is not null
     and exists (select 1 from public.agencies a
                  where a.id = public.current_agency_id()
                    and a.created_at > now() - interval '1 hour'
                    and a.licensee_name is null
                    and a.licensee_email is null)
     and public.is_account_holder()
     and not public.office_has_active_licensee();
$$;

revoke execute on function public.may_fill_licensee_details_at_signup() from public, anon;
grant execute on function public.may_fill_licensee_details_at_signup() to authenticated, service_role;

-- As 0095, plus the fill at sign-up.
create or replace function public.set_agency_licensee(p_name text, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.may_change_licensee_details() or public.may_fill_licensee_details_at_signup()) then
    raise exception 'Only the licensee in charge can change the licensee''s details.';
  end if;
  update public.agencies
     set licensee_name = nullif(btrim(p_name), ''),
         licensee_email = nullif(btrim(p_email), '')
   where id = public.current_agency_id();
end
$$;

-- What it shows when it has run: true.
select position('may_fill_licensee_details_at_signup' in
                pg_get_functiondef('public.set_agency_licensee(text,text)'::regprocedure)) > 0
       as signup_saves_licensee_details;
