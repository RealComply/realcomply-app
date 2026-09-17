-- ===== RUN THIS ONE. Migration 0048, agent name on the sign-off page, 17 Sep 2026 =====
--
-- The public sign-off page says who is asking. Until now it named the AGENCY:
--
--   "Cass Property has asked you to sign off on the compliance file for ..."
--
-- and it should name the PERSON, and only the person:
--
--   "Sarah Nguyen has requested your sign-off on ..."
--
-- WHY IT MATTERS ON THIS PAGE PARTICULARLY. A licensee in charge supervises
-- people, not letterheads. "Sarah has asked me to sign off her file" is a
-- sentence that makes immediate sense to them; "Cass Property has asked you"
-- is institutional and slightly off on a page reached from an unexpected link,
-- where the reader is already deciding whether this is genuine. Same reasoning
-- as the email subject line — the first recognisable fact should be a person
-- they know, not a product or a company name.
--
-- Adam, 17 Sep 2026, on why the agency name comes out entirely rather than
-- sitting beside the agent's: "The licensee knows who works for them. So just
-- having the agent's name, I think will be enough. Otherwise it feels a little
-- too formal and third party-ish." The agency is still named in the footer,
-- so nothing is lost by taking it out of the opening line.
--
-- Adam, 17 Sep 2026, settling the verb: "has requested your sign off." Not
-- "requires" — the agency does not require anything of its licensee in charge,
-- it is the other way round, and a page that tells someone they are required
-- to sign is the software applying pressure to a decision that is theirs.
--
-- ── WHY THIS IS A NEW FUNCTION RATHER THAN A REPLACED ONE ─────────────────
--
-- Postgres will not let CREATE OR REPLACE change a function's return type; the
-- old one has to be removed first. The SQL keyword for removing it is one of
-- the destructive words Supabase's editor scans for, and a match holds the
-- entire script behind a confirmation modal. From the other side of the screen
-- that looks exactly like a successful run — press Run, close the box, nothing
-- happened — and it has cost this project three separate migration attempts
-- (see RealComply-code-delivery-workflow.md).
--
-- So: a v2, called by the app, with the old one left in place and harmless.
-- Same pattern as bootstrap_agency_v3. That keyword appears nowhere in this
-- file, including in these comments, deliberately — the scanner does not know
-- the difference between a comment and a statement.

create or replace function public.get_signoff_request_v2(p_token uuid)
returns table (
  request_id uuid,
  statement text,
  ruleset_version text,
  property_address text,
  agency_name text,
  requested_by_name text,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  -- left join on profiles: created_by is nullable on older rows, and a request
  -- whose author has since been removed from the agency must still be signable.
  -- The page falls back to the agency name when this comes back null.
  select r.id, r.statement, r.ruleset_version, p.address, a.name,
         nullif(trim(coalesce(pr.full_name, '')), ''),
         r.expires_at
  from public.property_signoff_requests r
  join public.properties p on p.id = r.property_id
  join public.agencies a on a.id = r.agency_id
  left join public.profiles pr on pr.id = r.created_by
  where r.token = p_token
    and r.signed_at is null
    and r.revoked_at is null
    and r.expires_at > now();
$$;

grant execute on function public.get_signoff_request_v2(uuid) to anon, authenticated;

-- Verify. Expect 1.
select count(*) as function_expect_1
from pg_proc
where proname = 'get_signoff_request_v2';
