-- Listing URL, for the weekly advertised-price check (Adam, 16 Aug 2026).
--
-- The check reads the agency's own live listing page and compares the price
-- actually advertised against the ESP recorded on the file. c1 already records
-- what the agent SAYS is advertised and checks that against the ESP; this
-- catches the two cases c1 cannot:
--   * the ESP was revised and the advertising was never updated, which is the
--     s73(3) obligation ("as soon as practicable ... amend or retract any
--     advertisement");
--   * what went live is not what was recorded.
--
-- Per-property rather than scraping the agency's site and matching addresses.
-- Address matching across an arbitrary website is guesswork, and a check that
-- silently matches the wrong listing is worse than no check — it would report
-- a clean result for a page nobody looked at.
--
-- Worth more from late 2026, when the reforms require a price or price range
-- in every residential advertisement. Today many listings carry no price and
-- the check has nothing to compare; then, every listing will.
alter table public.properties
  add column listing_url text;

comment on column public.properties.listing_url is
  'Public URL of the agency''s own listing page for this property. Read weekly by the advertised-price check.';
