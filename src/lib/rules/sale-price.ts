import type { EffectiveEsp } from "@/lib/data/effective-esp";
import { espRangeText } from "./price-statement";

// f0, the Final sale price card (Settled stage).
//
// REVERSAL (Adam, 26 Oct 2026). Found live on a Cass Property listing: the
// agency agreement's ESP was $1.40m to $1.45m, the ESP revision card revised
// it to $1.35m, and the property sold for $1.26m. The card compared the sale
// with the ORIGINAL ESP, flagged it for being below, and the flag held up the
// Settled stage even after evidence was uploaded to the card.
//
//   Was: flag any final price outside the original ESP range, and the flag
//        blocks the stage (the card saved as "flagged", which is not done).
//   Now: 1. Compare with the LATEST estimate: the revised ESP from the ESP
//           revision card if there is one, otherwise the original ESP
//           (espFrom, the same rule every other ESP check uses).
//        2. Flag only when the sale price is MORE THAN 10% ABOVE the top
//           figure of that ESP. At or below the ESP, or up to 10% above it,
//           there is no flag.
//        3. A flag is said in plain words, with an optional note on how the
//           price came about. The card still completes (it saves as done),
//           so the flag never blocks the Settled stage or the file sign-off.
//
// Where the ESP came from and how it was formed is recorded on its own cards
// (the agency agreement, the ESP reasoning, the revision card). This card only
// records the result and, when it is well above the estimate, the agent's word
// on it.

/** How far above the top of the latest ESP a sale may be before it is flagged, in percent. */
export const SALE_PRICE_MARGIN_PCT = 10;

export type SalePriceCheck = {
  /** The latest ESP the sale was compared with, as recorded. */
  espLow: number | null;
  espHigh: number | null;
  /** True when that was the revised ESP rather than the agency agreement's. */
  espRevised: boolean;
  /** More than 10% above the top figure of the latest ESP. */
  aboveEsp: boolean;
};

/** The top figure of an ESP: the high end of a range, or the single figure. */
function topOf(esp: { low: number | null; high: number | null }): number | null {
  return esp.high ?? esp.low;
}

/**
 * The sale price against the latest ESP. No ESP recorded, no flag: there is
 * nothing to compare with, and the ESP's own card is where that shows.
 */
export function checkSalePrice(price: number, esp: EffectiveEsp): SalePriceCheck {
  const top = topOf(esp);
  // In whole percent rather than top * 1.1, so exactly 10% above is never
  // flagged by a rounding error (1,350,000 * 1.1 is 1485000.0000000002).
  const aboveEsp = top !== null && top > 0 && price * 100 > top * (100 + SALE_PRICE_MARGIN_PCT);
  return { espLow: esp.low, espHigh: esp.high, espRevised: esp.revised, aboveEsp };
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;

/**
 * The ESP as the agent knows it: "$1,350,000", or "$1,400,000 to $1,450,000",
 * as the price statement card writes it. One end missing reads as the other.
 */
export function espText(check: Pick<SalePriceCheck, "espLow" | "espHigh">): string | null {
  return espRangeText(check.espLow ?? check.espHigh, check.espHigh ?? check.espLow);
}

/** What a flagged card says. Null when the sale isn't flagged. */
export function salePriceFlagText(check: SalePriceCheck): string | null {
  const esp = espText(check);
  if (!check.aboveEsp || !esp) return null;
  return `The sale price is more than ${SALE_PRICE_MARGIN_PCT}% above the latest estimated selling price (${esp}).`;
}

/** Shown under the flag on the card, above the note box. */
export const SALE_PRICE_NOTE_PROMPT = "You can add a note on how that came about.";

export type SaleRecord = {
  price?: unknown;
  espLow?: unknown;
  espHigh?: unknown;
  espRevised?: unknown;
  aboveEsp?: unknown;
  note?: unknown;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The check as saved on the card. Read only from the fields this rule writes. */
export function savedSaleCheck(data: unknown): SalePriceCheck & { price: number | null; note: string | null } {
  const d = ((data ?? {}) as SaleRecord | null) ?? {};
  const note = typeof d.note === "string" && d.note.trim() ? d.note.trim() : null;
  return {
    price: num(d.price),
    espLow: num(d.espLow),
    espHigh: num(d.espHigh),
    espRevised: d.espRevised === true,
    aboveEsp: d.aboveEsp === true,
    note,
  };
}

/**
 * The finalised file's lines for the card: the price, what it was compared
 * with, and the flag and the agent's note where there is one.
 */
export function saleRecordLines(data: unknown): string[] {
  const saved = savedSaleCheck(data);
  if (saved.price === null) return [];
  const lines = [`Final sale price: ${money(saved.price)}`];
  const esp = espText(saved);
  if (esp) {
    lines.push(
      saved.espRevised
        ? `Compared with the revised estimated selling price: ${esp}`
        : `Compared with the estimated selling price: ${esp}`,
    );
  }
  const flag = salePriceFlagText(saved);
  if (flag) lines.push(flag);
  if (flag && saved.note) lines.push(`Agent's note: ${saved.note}`);
  return lines;
}
