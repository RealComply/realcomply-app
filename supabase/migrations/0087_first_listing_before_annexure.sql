-- 0087: An office's first listing no longer waits for the annexure (Adam,
-- trial brief, 23 Oct 2026).
--
-- CHANGE (Adam, 23 Oct 2026). WAS (0071, 14 Oct 2026): the annexure lock
-- blocked EVERY listing until the annexure was adopted (office plans) or the
-- signed annexure was uploaded (agent plans). NOW: an office can create its
-- FIRST listing without the annexure. The lock applies from the SECOND
-- listing. Same for every plan, including agent plans on the signed-annexure
-- path. Why: on the 14-day trial, a new office should see RealComply read
-- and file its first agency agreement before anything else is asked of it.
--
-- HOW. Only public.listing_gate_reason(p_agency_id) changes. It now returns
-- null (no lock) while the office has never had a listing. "Never had" counts
-- every listing the office has, archived ones included, AND every listing it
-- has deleted (deletion_log, 0058 section 12, which records each delete a
-- signed-in person makes). So deleting the first listing does not hand out
-- another free one. The trigger (properties_listing_gate), my_listing_gate()
-- and the app all read this one function, so they stay in step on their own.
--
-- Not changed: the lock after a change of licensee in charge (0080) is a
-- separate rule and still applies.
--
-- RUN THIS BEFORE THE CODE GOES LIVE. No new table, no new grants. Safe to
-- run twice. The revert is in the .txt copy Adam runs (and at the bottom of
-- this file, commented out).

create or replace function public.listing_gate_reason(p_agency_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when a.id is null or not a.annexure_gate then null
    -- CHANGE (Adam, 23 Oct 2026): the first listing is free of the lock.
    -- Counts listings that still exist (archived too) and ones deleted.
    when not exists (select 1 from public.properties p where p.agency_id = a.id)
     and not exists (select 1 from public.deletion_log d
                      where d.agency_id = a.id and d.what = 'properties')
      then null
    when left(coalesce(a.plan, ''), 6) = 'agent_' then
      case when exists (select 1 from public.signoff_documents d
                         where d.agency_id = a.id and d.category = 'sg_annexure_licensee_signed')
           then null else 'signed_annexure' end
    else
      case when exists (select 1 from public.sg_annexure_adoptions ad
                         where ad.agency_id = a.id and ad.signed_at is not null)
           then null else 'annexure' end
  end
  from (select 1) one
  left join public.agencies a on a.id = p_agency_id;
$$;
revoke execute on function public.listing_gate_reason(uuid) from public, anon, authenticated;
grant execute on function public.listing_gate_reason(uuid) to service_role;

-- Check: stops with a message if the new rule is not in place.
do $$
begin
  if position('deletion_log' in pg_get_functiondef('public.listing_gate_reason(uuid)'::regprocedure)) = 0 then
    raise exception 'Check failed: the first-listing rule is not in listing_gate_reason.';
  end if;
end
$$;

-- Every office with the lock on: how many listings it has (and has deleted),
-- and what the lock says now. "open" means it can add a listing.
select a.name as office,
       a.plan,
       (select count(*) from public.properties p where p.agency_id = a.id) as listings,
       (select count(*) from public.deletion_log d where d.agency_id = a.id and d.what = 'properties') as deleted_listings,
       coalesce(public.listing_gate_reason(a.id), 'open') as lock_now
  from public.agencies a
 where a.annexure_gate
 order by a.name;

-- ── REVERT (puts back the 0071 lock: every listing waits for the annexure) ──
-- Only if needed: remove the "-- " from each line below and run it.
-- create or replace function public.listing_gate_reason(p_agency_id uuid)
-- returns text
-- language sql
-- stable
-- security definer
-- set search_path = public
-- as $$
--   select case
--     when a.id is null or not a.annexure_gate then null
--     when left(coalesce(a.plan, ''), 6) = 'agent_' then
--       case when exists (select 1 from public.signoff_documents d
--                          where d.agency_id = a.id and d.category = 'sg_annexure_licensee_signed')
--            then null else 'signed_annexure' end
--     else
--       case when exists (select 1 from public.sg_annexure_adoptions ad
--                          where ad.agency_id = a.id and ad.signed_at is not null)
--            then null else 'annexure' end
--   end
--   from (select 1) one
--   left join public.agencies a on a.id = p_agency_id;
-- $$;
-- revoke execute on function public.listing_gate_reason(uuid) from public, anon, authenticated;
-- grant execute on function public.listing_gate_reason(uuid) to service_role;
