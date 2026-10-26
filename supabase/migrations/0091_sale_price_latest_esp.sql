-- ===== 0091: Final sale price cards re-checked with the 26 Oct 2026 rule =====
--
-- REVERSAL (Adam, 26 Oct 2026). The Final sale price card (f0, Settled stage)
-- used to compare the sale with the ORIGINAL ESP and save any price outside
-- that range as "flagged", which held up the Settled stage. Found live on a
-- Cass Property listing: ESP $1.40m to $1.45m, revised to $1.35m, sold $1.26m,
-- flagged for being below the original range.
--
-- The rule now (src/lib/rules/sale-price.ts):
--   * compared with the LATEST ESP: the revision card's (d3) revised figures
--     when both are there, otherwise the agency agreement's (a4). The same
--     rule as listing_effective_esp (0066) and src/lib/data/effective-esp.ts;
--   * flagged only when the sale is MORE THAN 10% ABOVE the top figure of it;
--   * the card is always done. A flag is said on the card and in the
--     finalised file, and never holds the stage or the sign-off.
--
-- What this does: every Final sale price card with a price recorded is
-- re-checked. Its status becomes done, the ESP it was compared with and the
-- new flag are written, and the old rule's two fields (outsideRange, and its
-- flagReason naming the revision card by its code) are removed. The price,
-- any attached file's name and any note are kept. WHO RECORDED THE PRICE AND
-- WHEN ARE KEPT: completed_by and recorded_at are not touched.
--
-- No table is created, so no grants are needed. Safe to run again: a second
-- run writes the same thing.

with checked as (
  select f.id,
         public.jsonb_to_numeric(f.data -> 'price') as price,
         (d.rl is not null and d.rh is not null) as revised,
         case when d.rl is not null and d.rh is not null then d.rl else a.al end as esp_low,
         case when d.rl is not null and d.rh is not null then d.rh else a.ah end as esp_high
    from public.property_items f
    left join lateral (
      select public.jsonb_to_numeric(x.data -> 'revisedEspLow') as rl,
             public.jsonb_to_numeric(x.data -> 'revisedEspHigh') as rh
        from public.property_items x
       where x.property_id = f.property_id and x.item_key = 'd3'
    ) d on true
    left join lateral (
      select public.jsonb_to_numeric(x.data -> 'espLow') as al,
             public.jsonb_to_numeric(x.data -> 'espHigh') as ah
        from public.property_items x
       where x.property_id = f.property_id and x.item_key = 'a4'
    ) a on true
   where f.item_key = 'f0'
     and public.jsonb_to_numeric(f.data -> 'price') > 0
)
update public.property_items f
   set status = 'done',
       data = (f.data - 'outsideRange' - 'flagReason') || jsonb_build_object(
         'espLow', c.esp_low,
         'espHigh', c.esp_high,
         'espRevised', c.revised,
         -- The top figure is the high end, or the single figure. In whole
         -- percent, as the app does, so exactly 10% above is not flagged.
         'aboveEsp', coalesce(
           coalesce(c.esp_high, c.esp_low) > 0
             and c.price * 100 > coalesce(c.esp_high, c.esp_low) * 110,
           false))
  from checked c
 where f.id = c.id;
