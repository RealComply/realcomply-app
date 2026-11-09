// Comparable sales under the 17 November 2026 rules (Reg s12C to s12F; Adam,
// 9 Nov 2026: "go ahead with comparables").
//
//   s12D(2)  First, the recently sold properties: within 2 km and sold in the
//            previous 6 months (metropolitan area), or within 5 km and the
//            previous 18 months (non-metropolitan). Metro or non-metro is the
//            listing's council area (lib/rules/council-area.ts; 0118).
//   s12D(3)  Of those, the ones the agent reasonably believes are comparable,
//            having regard to the comparison factors (a) to (o).
//   s12D(4)  Metropolitan area only: fewer than 3 comparable? Then also the
//            earlier sold properties, within 2 km and the previous 12 months.
//   s12D(5)  The 3 most comparable. (a) A recently sold property is more
//            comparable than an earlier sold one. (b) Two about equal: the more
//            recent sale is the more comparable.
//   s12C     The agent takes the 3 most comparable sold prices into account,
//            or all of them if fewer than 3 are comparable.
//   s12F     The record: each comparable's address, date and price; how they
//            were identified and the factors considered; why the 3 are the most
//            comparable; the information used and its source; and, if fewer
//            than 3, why.
//
// Everything here is arithmetic on what the file holds, or wording. Which
// sales are comparable, and which 3 are the most, is the agent's own call:
// nothing here marks a sale.

import type { AreaKind } from "@/lib/rules/council-area";
import { espGivenApplies } from "@/lib/rules/esp-given-before-signing";

// ── The search area (Reg s12D(2) and (4)) ──────────────────────────────────

export type SearchWindow = { radiusM: number; recentMonths: number; earlierMonths: number | null };

export function searchWindow(kind: AreaKind): SearchWindow {
  return kind === "metro"
    ? { radiusM: 2000, recentMonths: 6, earlierMonths: 12 }
    : { radiusM: 5000, recentMonths: 18, earlierMonths: null };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (v: unknown): string | null => (typeof v === "string" && ISO_DATE.test(v.slice(0, 10)) ? v.slice(0, 10) : null);

/**
 * The date the ESP was worked out, which the months count back from: the
 * date it was given to the vendor (the ESP card), else the agreement's
 * signing date, else today.
 */
export function espDeterminedOn(input: { espGivenOn?: unknown; agreementDate?: unknown; today: string }): string {
  return isoDate(input.espGivenOn) ?? isoDate(input.agreementDate) ?? input.today;
}

/** The same day `months` months earlier ("2026-11-30" less 3 months is "2026-08-30"; a missing day is the month's last). */
export function monthsBefore(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) - months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Where a sale sits against the search area. */
export type WindowPlace =
  | "recent" // within the radius and the recent months: a recently sold property
  | "earlier" // metropolitan area: within 2 km, sold 6 to 12 months before
  | "outside" // too far, too long ago, or sold after the ESP was worked out
  | "unknown"; // distance or sale date not recorded

export type WindowCheck = { place: WindowPlace; label: string };

const km = (m: number) => {
  if (m < 1000) return `${Math.round(m)} m`;
  const k = (m / 1000).toFixed(1);
  return `${k.endsWith(".0") ? k.slice(0, -2) : k} km`;
};

export function windowCheck(
  sale: { distanceM: number | null; saleDate: string | null },
  kind: AreaKind,
  asAt: string,
): WindowCheck {
  const w = searchWindow(kind);
  const radius = km(w.radiusM);
  if (sale.distanceM !== null && sale.distanceM > w.radiusM) {
    return { place: "outside", label: `Outside the search area: ${km(sale.distanceM)} away (${radius} here).` };
  }
  const sold = isoDate(sale.saleDate);
  if (sold && sold > asAt) {
    return { place: "outside", label: "Sold after the ESP was worked out." };
  }
  const longest = w.earlierMonths ?? w.recentMonths;
  if (sold && sold < monthsBefore(asAt, longest)) {
    return { place: "outside", label: `Outside the search area: sold more than ${longest} months before.` };
  }
  if (sale.distanceM === null) {
    return { place: "unknown", label: `Distance not shown: check it's within ${radius}.` };
  }
  if (!sold) {
    return { place: "unknown", label: `Sale date not shown: check it sold in the last ${w.recentMonths} months.` };
  }
  if (sold >= monthsBefore(asAt, w.recentMonths)) {
    return { place: "recent", label: `Recent sale: within ${radius} and ${w.recentMonths} months.` };
  }
  return {
    place: "earlier",
    label: `Earlier sale: within ${radius}, ${w.recentMonths} to ${w.earlierMonths} months before. It counts only if fewer than 3 recent sales are comparable (Reg s12D(4)).`,
  };
}

// ── The comparison factors (Reg s12D(3)(a) to (o)) ─────────────────────────

export const COMPARISON_FACTORS = [
  { key: "date_sold", label: "Date sold" },
  { key: "location", label: "Location (distance, neighbourhood, school catchment, same complex, estate or street)" },
  { key: "dwelling_type", label: "Type of dwelling" },
  { key: "condition", label: "Standard and condition, including renovation" },
  { key: "layout", label: "Layout" },
  { key: "floor_area", label: "Total floor area" },
  { key: "beds_baths", label: "Bedrooms and bathrooms" },
  { key: "parking", label: "Parking spaces" },
  { key: "special_features", label: "Special features, such as a pool or tennis court" },
  { key: "construction", label: "Construction materials" },
  { key: "age", label: "Age of the buildings" },
  { key: "style", label: "Architectural style" },
  { key: "build_status", label: "Build status (under construction, approval, vacant land)" },
  { key: "land_size", label: "Land size" },
  { key: "zoning_frontage", label: "Zoning and street frontage" },
] as const;

export type ComparisonFactor = (typeof COMPARISON_FACTORS)[number]["key"];
const FACTOR_KEYS = new Set<string>(COMPARISON_FACTORS.map((f) => f.key));

/** The factors as the form sends them: known ones only, each once, in the Regulation's order. */
export function factorsFrom(raw: unknown[]): ComparisonFactor[] {
  const chosen = new Set(raw.filter((v): v is string => typeof v === "string" && FACTOR_KEYS.has(v)));
  return COMPARISON_FACTORS.map((f) => f.key).filter((k) => chosen.has(k));
}

/**
 * "Date sold, layout, land size": the short names, for a line. Commas only,
 * since some names have "and" in them ("bedrooms and bathrooms").
 */
export function factorsLine(keys: readonly string[]): string {
  const names = COMPARISON_FACTORS.filter((f) => keys.includes(f.key)).map((f) => f.label.replace(/ \(.*\)$/, "").toLowerCase());
  if (names.length === 0) return "";
  return [names[0].charAt(0).toUpperCase() + names[0].slice(1), ...names.slice(1)].join(", ");
}

// ── The 3 most comparable ─────────────────────────────────────────────────

export const MOST_COMPARABLE_LABEL = "One of the 3 most comparable";
export const MOST_COMPARABLE_REASON_LABEL = "Why it's one of the 3 most comparable";
export const MOST_COMPARABLE_REASON_MISSING = "Say why it's one of the 3 most comparable.";
export const FACTORS_LABEL = "Comparison factors you weighed (Reg s12D(3))";
export const TIE_HINT =
  "If two sales are about equally comparable, the more recent sale counts as more comparable (Reg s12D(5)(b)).";
export const MAX_MOST_COMPARABLE = 3;

type Sale = {
  address: string;
  distanceM: number | null;
  saleDate: string | null;
  weighting: string | null;
  mostComparable: boolean;
};

/**
 * What to point out about the marks, in the Regulation's words: a most
 * comparable sale outside the search area, an earlier sale ahead of a recent
 * one (s12D(5)(a)), and earlier sales relied on when 3 recent ones are
 * (s12D(4)). Prompts, never a block: the distance and date are the report's.
 */
export function comparablesPrompts(sales: Sale[], kind: AreaKind, asAt: string): string[] {
  const out: string[] = [];
  const checked = sales.map((s) => ({ s, w: windowCheck(s, kind, asAt) }));
  for (const { s, w } of checked) {
    if (s.mostComparable && w.place === "outside") {
      out.push(`${s.address} is marked one of the 3 most comparable but is outside the search area. ${w.label}`);
    }
  }
  const recentRelied = checked.filter(({ s, w }) => w.place === "recent" && s.weighting === "relied");
  const earlierMost = checked.filter(({ s, w }) => w.place === "earlier" && s.mostComparable);
  const recentNotMost = recentRelied.filter(({ s }) => !s.mostComparable);
  if (earlierMost.length > 0 && recentNotMost.length > 0) {
    out.push(
      `${earlierMost[0].s.address} is an earlier sale marked one of the 3 most comparable, and ${recentNotMost[0].s.address} is a recent sale you relied on. A recent sale counts as more comparable than an earlier one (Reg s12D(5)(a)).`,
    );
  }
  const earlierRelied = checked.filter(({ s, w }) => w.place === "earlier" && s.weighting === "relied");
  if (earlierRelied.length > 0 && recentRelied.length >= 3) {
    out.push(
      `You relied on ${recentRelied.length} recent sales. Earlier sales count only when fewer than 3 recent ones are comparable (Reg s12D(4)).`,
    );
  }
  return out;
}

// ── On the ESP reasoning card: fewer than 3, and the information used ──────

/** Kept on the ESP reasoning card (a4c) as data.comparablesRecord. */
export type ComparablesRecord = { informationUsed: string | null; fewerThanThreeReason: string | null };

export const INFORMATION_USED_LABEL = "The information you used, and where it came from";
export const INFORMATION_USED_HINT =
  "For example: the comparable-sales report and who it's from, your office's own sales, a portal. Reg s12E asks you to use all the information you have or can reasonably get.";
export const FEWER_THAN_THREE_LABEL = "Why fewer than 3 are comparable";
export const FEWER_THAN_THREE_HINT =
  "Fewer than 3 sales marked as the most comparable. If that's because fewer than 3 are comparable, say why (Reg s12C(2), s12F(1)(c)).";
export const INFORMATION_USED_MISSING =
  "Say what information you used for the comparable sales, and where it came from (Reg s12F).";
export const FEWER_THAN_THREE_MISSING =
  "Mark the 3 most comparable sales, or say why fewer than 3 are comparable (Reg s12C).";

const MAX_RECORD_TEXT = 4000;
const clean = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim().slice(0, MAX_RECORD_TEXT) : "";
  return t ? t : null;
};

export function comparablesRecordFrom(raw: { informationUsed: unknown; fewerThanThreeReason: unknown }): ComparablesRecord {
  return { informationUsed: clean(raw.informationUsed), fewerThanThreeReason: clean(raw.fewerThanThreeReason) };
}

export function comparablesRecordOf(data: unknown): ComparablesRecord {
  const r = (data as { comparablesRecord?: Partial<ComparablesRecord> } | null | undefined)?.comparablesRecord;
  return comparablesRecordFrom({ informationUsed: r?.informationUsed, fewerThanThreeReason: r?.fewerThanThreeReason });
}

/** Whether the 17 November rules apply to this ESP: signed on or after it, or not signed yet and it's here. */
export function comparablesRulesApply(agreementDate: string | null | undefined, now: Date = new Date()): boolean {
  return espGivenApplies(agreementDate, now);
}

/** What still stops the ESP reasoning card being marked done under the 17 November rules. */
export function comparablesMissing(input: { mostComparableCount: number; record: ComparablesRecord }): string[] {
  const missing: string[] = [];
  if (input.mostComparableCount < MAX_MOST_COMPARABLE && !input.record.fewerThanThreeReason) {
    missing.push(FEWER_THAN_THREE_MISSING);
  }
  if (!input.record.informationUsed) missing.push(INFORMATION_USED_MISSING);
  return missing;
}

/** The compliance record's lines for one sale: where it sits, and why it's one of the 3 most comparable. */
export function saleRecordLines(
  sale: Sale & { mostComparableReason: string | null; comparisonFactors: string[] },
  kind: AreaKind | null,
  asAt: string,
): string[] {
  const lines: string[] = [];
  if (kind) lines.push(windowCheck(sale, kind, asAt).label);
  if (sale.mostComparable) {
    lines.push(`${MOST_COMPARABLE_LABEL}: ${sale.mostComparableReason ?? ""}`.trim());
    const factors = factorsLine(sale.comparisonFactors);
    if (factors) lines.push(`Comparison factors weighed: ${factors}.`);
  }
  return lines;
}

/** The compliance record's lines for the listing: how many are marked, fewer than 3, and the information used. */
export function comparablesRecordLines(record: ComparablesRecord, mostComparableCount: number): string[] {
  const lines = [`Marked as the most comparable: ${mostComparableCount} of 3.`];
  if (mostComparableCount < MAX_MOST_COMPARABLE && record.fewerThanThreeReason) {
    lines.push(`Fewer than 3 comparable: ${record.fewerThanThreeReason}`);
  }
  if (record.informationUsed) lines.push(`Information used and where it came from: ${record.informationUsed}`);
  return lines;
}
