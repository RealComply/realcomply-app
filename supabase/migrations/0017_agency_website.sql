-- Agency website, for finding listing pages automatically (Adam, 16 Aug 2026).
--
-- The advertised-price check reads a listing page and compares the price to the
-- ESP. As first built it needed the agent to paste each listing's URL in by
-- hand, which is exactly the kind of unnecessary work this product exists to
-- remove (Adam: "That's much better. It's more along the lines of what I was
-- thinking"). With the agency's own website recorded once, the app finds the
-- listing page itself and asks the agent to confirm it once, after which the
-- exact URL is stored on the property.
--
-- Confirm-once rather than trust-the-match: address matching across a website
-- is inference, and a check that silently matches the wrong page reports a
-- clean result for a listing nobody looked at. One click converts a guess into
-- a fact, and it never has to be guessed again.
--
-- Captured at signup for BOTH tiers. For an agency subscription it is the
-- agency's own site; for an individual agent subscription it is their employing
-- agency's site (Adam, 16 Aug 2026) — the listings are on the same website
-- either way, which is all this needs.
alter table public.agencies
  add column website_url text;

comment on column public.agencies.website_url is
  'The agency''s public website. Used to find each listing''s own page for the advertised-price check.';

-- Same reasoning as set_agency_licensee_email in 0014: agencies has a SELECT
-- policy only, and a general UPDATE policy would expose every column on the
-- table in order to set one field.
create function public.set_agency_website(p_url text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.agencies
     set website_url = nullif(btrim(p_url), '')
   where id = public.current_agency_id();
$$;

grant execute on function public.set_agency_website(text) to authenticated;
