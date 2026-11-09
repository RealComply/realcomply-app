// Each ESP revision's own comparable sales (Reg s12G(1)(a), (c), (d); Adam,
// 9 Nov 2026: "go ahead with comparables per revision"; 0120).
//
// A revision is worked out the way the first ESP was (Reg s12C to s12E), and
// its record keeps the same things (s12G(1)(a)): each comparable sale taken
// into account, which 3 are the most comparable and why, the factors
// weighed, the information used and where it came from. Two things are its
// own:
//   (c) a sale taken into account now that wasn't for the previous ESP: why
//       it wasn't then;
//   (d) fewer than 3 comparable: why.
//
// The list is kept with the revision (esp_revisions.comparables) and, like
// the rest of a revision, never changes once recorded. The listing's own
// list of comparable sales stays the record of the first ESP.

import {
  FEWER_THAN_THREE_MISSING,
  INFORMATION_USED_MISSING,
  MAX_MOST_COMPARABLE,
  factorsFrom,
  factorsLine,
} from "@/lib/rules/comparables-rules";
import { formatAuDate } from "@/lib/format-date";

/** A sale the next revision can take into account: the listing's own, then any an earlier revision added. */
export type RevisionCandidate = {
  key: string;
  address: string;
  soldOn: string | null;
  soldPrice: number | null;
  distanceM: number | null;
};

/** One sale taken into account for a revision. */
export type RevisionComparable = {
  address: string;
  /** YYYY-MM-DD. */
  soldOn: string | null;
  soldPrice: number | null;
  distanceM: number | null;
  most: boolean;
  mostReason: string | null;
  factors: string[];
  /** Why it wasn't taken into account for the previous ESP, when it wasn't (s12G(1)(c)). */
  notBeforeReason: string | null;
};

export const REVISION_COMPARABLES_LABEL = "Comparable sales for this revision";
export const REVISION_COMPARABLES_HINT =
  "Tick each sale you took into account for the new figure, and mark the 3 most comparable with why (Reg s12C, s12G(1)(a)). Add any sale that isn't listed.";
export const NOT_BEFORE_LABEL = "Not used for the previous ESP. Why not?";
export const NOT_BEFORE_MISSING =
  "For each sale you didn't take into account for the previous ESP, say why not (Reg s12G(1)(c)).";
export const MOST_REASON_MISSING = "Say why each of the 3 most comparable is one of them.";
export const TOO_MANY_MOST = "Only 3 sales can be marked as the most comparable.";
export const BAD_SALE = "Each sale needs its address. Check any date sold or price you typed.";

const MAX_TEXT = 2000;
const text = (v: unknown, max = MAX_TEXT): string | null => {
  const t = typeof v === "string" ? v.trim().slice(0, max) : "";
  return t ? t : null;
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const positive = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(/[$,\s]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** An address reduced to compare two lists by: case, spaces and punctuation don't count. */
export function addressKey(address: string): string {
  return address.toLowerCase().replace(/\(made up\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The sales as the form sends them (a JSON list). Refuses a sale with no
 * address, a date or price that isn't one, and more than 3 marked the most
 * comparable. Reasons are kept only where they belong.
 */
export function revisionComparablesFrom(raw: unknown): { entries: RevisionComparable[] } | { error: string } {
  let list: unknown;
  try {
    list = typeof raw === "string" && raw.trim() ? JSON.parse(raw) : [];
  } catch {
    return { error: BAD_SALE };
  }
  if (!Array.isArray(list)) return { error: BAD_SALE };
  const entries: RevisionComparable[] = [];
  for (const item of list.slice(0, 60)) {
    const r = (item ?? {}) as Record<string, unknown>;
    const address = text(r.address, 200);
    const soldOnRaw = text(r.soldOn, 10);
    const priceRaw = r.soldPrice;
    const soldPrice = positive(priceRaw);
    if (!address || (soldOnRaw && !ISO.test(soldOnRaw)) || (priceRaw !== null && priceRaw !== undefined && priceRaw !== "" && soldPrice === null)) {
      return { error: BAD_SALE };
    }
    const most = r.most === true;
    entries.push({
      address,
      soldOn: soldOnRaw,
      soldPrice,
      distanceM: positive(r.distanceM),
      most,
      mostReason: most ? text(r.mostReason) : null,
      factors: most ? factorsFrom(Array.isArray(r.factors) ? r.factors : []) : [],
      notBeforeReason: text(r.notBeforeReason),
    });
  }
  if (entries.filter((e) => e.most).length > MAX_MOST_COMPARABLE) return { error: TOO_MANY_MOST };
  return { entries };
}

/** What a revision kept, read back. Anything that isn't a sale is left out. */
export function revisionComparablesOf(raw: unknown): RevisionComparable[] {
  if (!Array.isArray(raw)) return [];
  const parsed = revisionComparablesFrom(JSON.stringify(raw.filter((r) => r && typeof r === "object" && typeof (r as { address?: unknown }).address === "string")));
  return "entries" in parsed ? parsed.entries : [];
}

/** The sales new since the previous ESP: not in the list it was worked out from. */
export function newSincePrevious(entries: RevisionComparable[], previousAddresses: string[]): RevisionComparable[] {
  const before = new Set(previousAddresses.map(addressKey));
  return entries.filter((e) => !before.has(addressKey(e.address)));
}

/**
 * What stops the revision being saved, or null. Under the 17 November rules
 * (a notice given from then): the information used, the 3 most comparable or
 * why fewer, a reason for each of the 3, and for each sale new since the
 * previous ESP, why it wasn't used then. Before, only what is typed is checked.
 */
export function revisionComparablesProblem(input: {
  entries: RevisionComparable[];
  previousAddresses: string[];
  infoUsed: string | null;
  fewerReason: string | null;
  underReforms: boolean;
}): string | null {
  const most = input.entries.filter((e) => e.most);
  if (most.length > MAX_MOST_COMPARABLE) return TOO_MANY_MOST;
  if (most.some((e) => !e.mostReason)) return MOST_REASON_MISSING;
  if (!input.underReforms) return null;
  if (!input.infoUsed) return INFORMATION_USED_MISSING;
  if (most.length < MAX_MOST_COMPARABLE && !input.fewerReason) return FEWER_THAN_THREE_MISSING;
  if (newSincePrevious(input.entries, input.previousAddresses).some((e) => !e.notBeforeReason)) return NOT_BEFORE_MISSING;
  return null;
}

/**
 * The sales the previous ESP was worked out from: the latest earlier revision
 * that kept its own, else the first ESP's (the listing's sales relied on).
 */
export function previousAddresses(
  earlier: Array<{ no: number; comparables?: RevisionComparable[] }>,
  firstEsp: string[],
): string[] {
  const kept = [...earlier].sort((a, b) => b.no - a.no).find((r) => (r.comparables ?? []).length > 0);
  return kept ? (kept.comparables ?? []).map((c) => c.address) : firstEsp;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;

/** "14 Near Street, sold 1 October 2026 for $1,250,000". */
export function saleLine(c: Pick<RevisionComparable, "address" | "soldOn" | "soldPrice">): string {
  const sold = [c.soldOn ? `sold ${formatAuDate(c.soldOn)}` : null, c.soldPrice ? `for ${money(c.soldPrice)}` : null]
    .filter(Boolean)
    .join(" ");
  return sold ? `${c.address}, ${sold}` : c.address;
}

/** The compliance record's lines under the ESP revision card, for one revision. */
export function revisionComparablesLines(
  revisionNo: number,
  r: { comparables?: RevisionComparable[]; comparablesInfoUsed?: string | null; comparablesFewerReason?: string | null },
): string[] {
  const lines: string[] = [];
  for (const c of r.comparables ?? []) {
    const parts = [`Revision ${revisionNo}, comparable sale taken into account: ${saleLine(c)}.`];
    if (c.most) {
      parts.push(`One of the 3 most comparable: ${c.mostReason ?? ""}`.trim());
      const f = factorsLine(c.factors);
      if (f) parts.push(`Comparison factors weighed: ${f}.`);
    }
    if (c.notBeforeReason) parts.push(`Not used for the previous ESP because: ${c.notBeforeReason}`);
    lines.push(parts.join(" "));
  }
  const most = (r.comparables ?? []).filter((c) => c.most).length;
  if (most < MAX_MOST_COMPARABLE && r.comparablesFewerReason) {
    lines.push(`Revision ${revisionNo}, fewer than 3 comparable: ${r.comparablesFewerReason}`);
  }
  if (r.comparablesInfoUsed) lines.push(`Revision ${revisionNo}, information used and where it came from: ${r.comparablesInfoUsed}`);
  return lines;
}
