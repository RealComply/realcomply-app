-- 0024 — auction campaigns.
--
-- RealComply had no concept of HOW a property was being sold. An auction file
-- passed every gate and exported as compliant while an entire statutory regime
-- — the bidders record, the displayed notices, the reserve in writing, vendor
-- bids — was never touched. This is the property-level half of the fix; the
-- items themselves live in src/lib/rules/nsw-sales.ts.
--
-- Safe to run more than once.

alter table public.properties
  add column if not exists sale_method text not null default 'private_treaty',
  -- Nullable, deliberately (Adam, 18 Aug 2026): "there may not be an auction
  -- date or time... we have to leave space for a TBC". A property is very
  -- often listed for auction before the date is locked in, and forcing a date
  -- at set-up would either block the listing or invite a made-up one. Null
  -- means TBC and the app says so.
  add column if not exists auction_date date,
  -- Text rather than `time`: agents write "10:00am", "11am", "on site 10.30".
  -- Nothing computes on it — only auction_date drives anything — so storing
  -- what they typed beats rejecting it.
  add column if not exists auction_time text,
  add column if not exists auction_venue text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'properties_sale_method_check') then
    alter table public.properties
      add constraint properties_sale_method_check
      check (sale_method in ('private_treaty', 'auction'));
  end if;
end $$;

-- Existing listings are all private treaty — that is what the default gives
-- them, and it is correct: none of them ran an auction campaign.

create index if not exists properties_auction_date_idx
  on public.properties (auction_date)
  where sale_method = 'auction';

select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'properties'
       and column_name in ('sale_method','auction_date','auction_time','auction_venue')) as columns_expect_4;
