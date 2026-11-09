import { reformsInForce } from "./underquoting-reforms";

// The advertised price card (c1), from 17 November 2026 (s72D: every ad for a
// residential sale needs a price or price range). Adam, 9 Nov 2026:
//   - The price is read from the agency agreement (Sch 6 s5: a private treaty
//     agreement states the price it is offered at) and pre-filled. If the
//     agreement has none, usually an auction, the card asks for it.
//   - One tick: "This price is shown in all the required marketing material".
//   - No for-sale sign exception: "No one's going to advertise with only a
//     signboard."

export type PriceFigures = { low: number; high: number };

// "$1,200,000", "1,200,000", "$1.2m", "1.25 million", "$950k", "950 thousand".
const MONEY = /\$?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(m\b|mil\b|million\b|k\b|thousand\b)?/gi;

/**
 * The low and high of a price as written, e.g. on the agency agreement. Null
 * when there's no price in it. Anything under $10,000 is taken as not a price
 * ("3 bedrooms", "2 car spaces"). One figure is a range of one.
 */
export function priceFromText(text: string | null | undefined): PriceFigures | null {
  if (!text) return null;
  const figures: number[] = [];
  for (const m of text.matchAll(MONEY)) {
    const base = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(base)) continue;
    const unit = (m[2] ?? "").toLowerCase();
    const value = unit.startsWith("m") ? base * 1_000_000 : unit === "k" || unit === "thousand" ? base * 1_000 : base;
    if (value >= 10_000) figures.push(Math.round(value));
    if (figures.length === 2) break;
  }
  if (figures.length === 0) return null;
  const [a, b = a] = figures;
  return { low: Math.min(a, b), high: Math.max(a, b) };
}

export const ENTER_PRICE =
  "Enter the advertised price. From 17 November 2026 every ad needs a price or price range (s72D).";
export const TICK_MARKETING = "Tick that this price is shown in all the required marketing material.";

/**
 * Why the card can't be recorded yet, or null. From 17 November the price and
 * the tick are both needed. Before then a price is optional (an auction need
 * not show one yet), but a price that is entered still needs the tick.
 */
export function advertisedPriceProblem(input: {
  low: number | null;
  inAllMarketing: boolean;
  now?: Date;
}): string | null {
  if (reformsInForce(input.now)) {
    if (input.low == null) return ENTER_PRICE;
    if (!input.inAllMarketing) return TICK_MARKETING;
    return null;
  }
  // Before 17 November the tick isn't on the card (s72D starts then).
  return null;
}
