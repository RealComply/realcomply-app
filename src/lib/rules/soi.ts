// The Statement of Information (s72C; Reg s12H, s12I; 0121).
//
// Adam, 9 Nov 2026, through Master: "both". RealComply makes it as the main
// route, filled from the file onto Fair Trading's approved form and checked by
// the agent, and agents can upload their own instead. Every version is kept
// (s72C(6): 3 years). Follow the approved form exactly: all 9 types of
// residential property and all 7 kinds of report it lists.
//
// When it applies: to an agency agreement entered into after s72C commences
// on 8 February 2027 (Act Sch 1, transitional cl 3).
//
// THE SWITCH (Master, 10 Nov 2026): built now, off until midnight Sydney on
// 8 February 2027: the card, the link for ads, the 2 business day clock,
// everything. Then only for a listing whose agency agreement was signed on
// or after that day (or isn't signed yet, so will be). A listing signed
// before never gets it. soiApplies is the app's one check; the database has
// the same one (soi_applies, 0121) for what's saved and what the link shows.
//
// What goes on it (Reg s12H(1)): the address and type of the property; for
// each comparable property whose sold price was taken into account, its
// address, date and price sold and why it's comparable; fewer than 3
// comparable and why; and which reports, to the agent's knowledge, have been
// prepared. Under Reg s12C those properties are the 3 most comparable, or all
// of them when there are fewer than 3. The form's Section A takes up to 3,
// Section B the reasons for fewer than 3. With 1 or 2, both are kept: Section
// A lists them (s12H(1)(c)) and Section B says why there aren't 3
// (s12H(1)(d)).
//
// Revising it (Reg s12I): within 2 business days after revising the ESP, when
// the comparable properties taken into account for the revision are not the
// same as those currently in the statement.
//
// No database or browser here, so every rule is tested (soi.test.ts).

import { addNswBusinessDays } from "@/lib/licensee-history";
import { SOI_FROM } from "@/lib/rules/underquoting-reforms";
import { formatAuDate } from "@/lib/format-date";
import type { AreaKind } from "@/lib/rules/council-area";
import { MAX_MOST_COMPARABLE } from "@/lib/rules/comparables-rules";
import { addressKey, type RevisionComparable } from "@/lib/rules/revision-comparables";
import { strataLandHidden } from "@/lib/rules/strata-land";

/** The day s72C commences (Act Sch 1, transitional cl 3). */
export const SOI_STARTS_ON = "2027-02-08";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const sydneyToday = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/**
 * Whether the statement is switched on for the listing: never before midnight
 * Sydney on 8 February 2027; from then, for an agreement signed on or after
 * that day, or none signed yet.
 */
export function soiApplies(agreementDate: string | null | undefined, now: Date = new Date()): boolean {
  if (now.getTime() < SOI_FROM.getTime()) return false;
  const signed = typeof agreementDate === "string" && ISO.test(agreementDate) ? agreementDate : sydneyToday(now);
  return signed >= SOI_STARTS_ON;
}

export const SOI_NOT_YET =
  "The Statement of Information starts on 8 February 2027, for agency agreements signed from that day.";

// ── The approved form's lists, word for word ───────────────────────────────

/** "Type of residential property (house, terrace house, semi-detached, duplex, townhouse, villa, apartment, unit, or vacant land)". */
export const SOI_TYPES = [
  "house",
  "terrace house",
  "semi-detached",
  "duplex",
  "townhouse",
  "villa",
  "apartment",
  "unit",
  "vacant land",
] as const;
export type SoiType = (typeof SOI_TYPES)[number];

export const soiTypeLabel = (t: SoiType): string => t.charAt(0).toUpperCase() + t.slice(1);

/** The listing's own type, where it says which of the 9 it is. The other 4 are the agent's choice. */
export function soiTypeFrom(propertyType: string | null | undefined): SoiType | null {
  switch (propertyType) {
    case "House":
      return "house";
    case "Unit":
      return "unit";
    case "Townhouse":
      return "townhouse";
    case "Duplex":
      return "duplex";
    case "Land":
      return "vacant land";
    default:
      return null;
  }
}

/** "Records of property reports and documents": the 7 boxes, in the form's order and words. */
export const SOI_REPORTS = [
  { key: "building", label: "Building inspection report" },
  { key: "termite", label: "Termite inspection report" },
  { key: "other_pest", label: "Other pest inspection report" },
  { key: "strata_records", label: "A strata records inspection report" },
  { key: "strata_certificate", label: "A strata information certificate under s184 of the Strata Schemes Management Act 2015" },
  { key: "association_records", label: "An association records inspection report" },
  {
    key: "association_certificate",
    label: "An association information certificate under s171 of the Community Land Management Act 2021",
  },
] as const;
export type SoiReport = (typeof SOI_REPORTS)[number]["key"];
const REPORT_KEYS = new Set<string>(SOI_REPORTS.map((r) => r.key));

// ── What a statement says ───────────────────────────────────────────────────

/** One comparable property in Section A. */
export type SoiComparable = {
  address: string;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  /** "if known by the real estate agent". */
  landSizeSqm: number | null;
  /** "if known by the real estate agent". */
  floorAreaSqm: number | null;
  soldPrice: number | null;
  /** YYYY-MM-DD. */
  soldOn: string | null;
  reasons: string;
};

/** Everything a statement RealComply makes says, kept with the version (0121). */
export type SoiContent = {
  address: string;
  propertyType: SoiType;
  area: AreaKind;
  /** Section A, up to 3. */
  comparables: SoiComparable[];
  /** Section B: why fewer than 3. Only with fewer than 3. */
  fewerReason: string | null;
  reports: SoiReport[];
  /** YYYY-MM-DD. */
  preparedOn: string;
  preparedBy: string;
  /** The ESP it's made for: 0 the agreement's, else the revision's number. */
  espRevisionNo: number;
};

export const SOI_LABEL = "Statement of Information";
export const MAKE_LABEL = "Make it in RealComply";
export const UPLOAD_LABEL = "Upload one made elsewhere";
export const CHECKED_LABEL = "I've checked every detail above against my records.";

export const SOI_TYPE_MISSING = "Choose the type of residential property.";
export const SOI_AREA_MISSING =
  "Choose the council area in Edit listing first. The form says whether the property is in a metropolitan area, and that comes from the council area.";
export const SOI_COMPARABLE_INCOMPLETE =
  "Each comparable property needs its address, bedrooms, bathrooms, parking spaces, sold price, date of sale, and why it's comparable.";
export const SOI_FEWER_MISSING = "Say why there are fewer than 3 comparable properties (Section B).";
export const SOI_NOT_CHECKED = "Tick that you've checked the details before making the statement.";
export const SOI_TOO_MANY = "Section A takes the 3 most comparable properties only.";
export const SOI_BAD = "Something on the form didn't come through. Reload the page and try again.";
/** Adam, 10 Nov 2026: lib/rules/strata-land.ts. */
export const SOI_STRATA_LAND =
  "On a unit, townhouse or duplex on strata, a land size over 500 m² is likely the whole strata site, so it can't go on the statement. Enter the lot's own land size, or leave it empty.";

const MAX_TEXT = 2000;
const text = (v: unknown, max = MAX_TEXT): string | null => {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
  return t ? t : null;
};
/** A whole number from 0 (a count), or null. "" and nothing are null; anything else that isn't one is NaN. */
const count = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isInteger(n) && n >= 0 && n < 1000 ? n : NaN;
};
/** A positive amount ("$1,250,000", "650.5"), or null. Anything else that isn't one is NaN. */
const amount = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : NaN;
};
const realDay = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  if (!ISO.test(t)) return null;
  const d = new Date(`${t}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === t ? t : null;
};

/**
 * The statement as the form sends it, checked. The address, the date it was
 * prepared, who by and the ESP it's for come from the server, never the
 * form; everything else is what the agent checked.
 */
export function soiContentFrom(
  form: { propertyType: unknown; comparables: unknown; fewerReason: unknown; reports: unknown[]; checked: unknown },
  fixed: {
    address: string;
    area: AreaKind | null;
    preparedOn: string;
    preparedBy: string;
    espRevisionNo: number;
    /** The listing is a unit, townhouse or duplex on strata (lib/rules/strata-land.ts). */
    strata?: boolean;
  },
): { content: SoiContent } | { error: string } {
  if (!fixed.area) return { error: SOI_AREA_MISSING };
  const propertyType = SOI_TYPES.find((t) => t === form.propertyType);
  if (!propertyType) return { error: SOI_TYPE_MISSING };

  let list: unknown;
  try {
    list = typeof form.comparables === "string" && form.comparables.trim() ? JSON.parse(form.comparables) : [];
  } catch {
    return { error: SOI_BAD };
  }
  if (!Array.isArray(list)) return { error: SOI_BAD };
  if (list.length > MAX_MOST_COMPARABLE) return { error: SOI_TOO_MANY };
  const comparables: SoiComparable[] = [];
  for (const item of list) {
    const r = (item ?? {}) as Record<string, unknown>;
    const c: SoiComparable = {
      address: text(r.address, 200) ?? "",
      bedrooms: count(r.bedrooms),
      bathrooms: count(r.bathrooms),
      parking: count(r.parking),
      landSizeSqm: amount(r.landSizeSqm),
      floorAreaSqm: amount(r.floorAreaSqm),
      soldPrice: amount(r.soldPrice),
      soldOn: realDay(r.soldOn),
      reasons: text(r.reasons) ?? "",
    };
    const numbers = [c.bedrooms, c.bathrooms, c.parking, c.landSizeSqm, c.floorAreaSqm, c.soldPrice];
    if (
      !c.address ||
      !c.reasons ||
      !c.soldOn ||
      numbers.some((n) => Number.isNaN(n)) ||
      c.bedrooms === null ||
      c.bathrooms === null ||
      c.parking === null ||
      c.soldPrice === null
    ) {
      return { error: SOI_COMPARABLE_INCOMPLETE };
    }
    if (strataLandHidden(c.landSizeSqm, fixed.strata === true)) return { error: SOI_STRATA_LAND };
    comparables.push(c);
  }
  const fewerReason = comparables.length < MAX_MOST_COMPARABLE ? text(form.fewerReason) : null;
  if (comparables.length < MAX_MOST_COMPARABLE && !fewerReason) return { error: SOI_FEWER_MISSING };
  if (form.checked !== "on" && form.checked !== true) return { error: SOI_NOT_CHECKED };

  const ticked = new Set(form.reports.filter((r): r is string => typeof r === "string" && REPORT_KEYS.has(r)));
  return {
    content: {
      address: fixed.address.trim(),
      propertyType,
      area: fixed.area,
      comparables,
      fewerReason,
      reports: SOI_REPORTS.map((r) => r.key).filter((k) => ticked.has(k)),
      preparedOn: fixed.preparedOn,
      preparedBy: fixed.preparedBy,
      espRevisionNo: fixed.espRevisionNo,
    },
  };
}

/** What a version kept, read back; null when it isn't one RealComply made. */
export function soiContentOf(raw: unknown): SoiContent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const area = r.area === "metro" || r.area === "non_metro" ? (r.area as AreaKind) : null;
  const parsed = soiContentFrom(
    {
      propertyType: r.propertyType,
      comparables: JSON.stringify(Array.isArray(r.comparables) ? r.comparables : []),
      fewerReason: r.fewerReason,
      reports: Array.isArray(r.reports) ? r.reports : [],
      checked: true,
    },
    {
      address: typeof r.address === "string" ? r.address : "",
      area,
      preparedOn: typeof r.preparedOn === "string" ? r.preparedOn : "",
      preparedBy: typeof r.preparedBy === "string" ? r.preparedBy : "",
      espRevisionNo: typeof r.espRevisionNo === "number" ? r.espRevisionNo : 0,
    },
  );
  return "content" in parsed ? parsed.content : null;
}

// ── Filling it in from the file ────────────────────────────────────────────

/** A sale on the listing's own list (property_comparables), as the draft reads it. */
export type ListingSale = {
  address: string;
  salePrice: number | null;
  saleDate: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  carSpaces: number | null;
  landSizeSqm: number | null;
  internalAreaSqm: number | null;
  mostComparable: boolean;
  mostComparableReason: string | null;
};

export type SoiDraft = {
  propertyType: SoiType | null;
  comparables: SoiComparable[];
  fewerReason: string;
  reports: SoiReport[];
  espRevisionNo: number;
  /** Where Section A came from, said on the form. */
  from: string;
  /** Reports on the register that could be one of two boxes: the agent ticks which. */
  reportHints: string[];
  /**
   * The properties whose land size was left out: over 500 m² on a strata
   * listing, likely the whole strata site (Adam, 10 Nov 2026).
   */
  landNotShown: string[];
};

/**
 * The form, filled from the file: the 3 most comparable of the latest ESP
 * revision that kept its own, else the listing's (the agreement's ESP), each
 * with the details the comparable-sales report gave; why fewer than 3; and
 * the reports. The type and the reports carry over from the last statement
 * RealComply made, since the form asks what the agent knew "when this
 * Statement of Information was first prepared".
 */
export function soiDraft(input: {
  propertyType: string | null;
  listing: ListingSale[];
  firstEspFewerReason: string | null;
  revisions: Array<{ no: number; comparables?: RevisionComparable[]; comparablesFewerReason?: string | null }>;
  previous: SoiContent | null;
  register: { building: boolean; pest: boolean; strata: boolean };
  /** The listing is a unit, townhouse or duplex on strata (lib/rules/strata-land.ts). */
  strataDwelling?: boolean;
}): SoiDraft {
  const landNotShown: string[] = [];
  const latestNo = input.revisions.reduce((n, r) => Math.max(n, r.no), 0);
  const kept = [...input.revisions].sort((a, b) => b.no - a.no).find((r) => (r.comparables ?? []).length > 0);
  const byAddress = new Map(input.listing.map((s) => [addressKey(s.address), s]));
  const typedBefore = new Map((input.previous?.comparables ?? []).map((c) => [addressKey(c.address), c]));

  const fill = (address: string, sold: { price: number | null; on: string | null }, reason: string | null): SoiComparable => {
    const sale = byAddress.get(addressKey(address));
    const before = typedBefore.get(addressKey(address));
    let land = sale?.landSizeSqm ?? before?.landSizeSqm ?? null;
    if (strataLandHidden(land, input.strataDwelling === true)) {
      land = null;
      landNotShown.push(address);
    }
    return {
      address,
      bedrooms: sale?.bedrooms ?? before?.bedrooms ?? null,
      bathrooms: sale?.bathrooms ?? before?.bathrooms ?? null,
      parking: sale?.carSpaces ?? before?.parking ?? null,
      landSizeSqm: land,
      floorAreaSqm: sale?.internalAreaSqm ?? before?.floorAreaSqm ?? null,
      soldPrice: sold.price ?? sale?.salePrice ?? before?.soldPrice ?? null,
      soldOn: sold.on ?? sale?.saleDate?.slice(0, 10) ?? before?.soldOn ?? null,
      reasons: reason ?? before?.reasons ?? "",
    };
  };

  const comparables = kept
    ? (kept.comparables ?? [])
        .filter((c) => c.most)
        .slice(0, MAX_MOST_COMPARABLE)
        .map((c) => fill(c.address, { price: c.soldPrice, on: c.soldOn }, c.mostReason))
    : input.listing
        .filter((s) => s.mostComparable)
        .slice(0, MAX_MOST_COMPARABLE)
        .map((s) => fill(s.address, { price: s.salePrice, on: s.saleDate?.slice(0, 10) ?? null }, s.mostComparableReason));
  const fewerReason = (kept ? kept.comparablesFewerReason : input.firstEspFewerReason) ?? input.previous?.fewerReason ?? "";

  const reportHints: string[] = [];
  let reports: SoiReport[];
  if (input.previous) {
    reports = input.previous.reports;
  } else {
    reports = input.register.building ? ["building"] : [];
    if (input.register.pest) reportHints.push("Your reports register has a pest inspection: tick termite or other pest, whichever it was.");
    if (input.register.strata) reportHints.push("Your reports register has a strata report: tick the strata record or certificate it was.");
  }

  return {
    propertyType: input.previous?.propertyType ?? soiTypeFrom(input.propertyType),
    comparables,
    fewerReason: comparables.length < MAX_MOST_COMPARABLE ? fewerReason : "",
    reports,
    espRevisionNo: latestNo,
    from: kept ? `ESP revision ${kept.no}` : "the comparable sales on this listing",
    reportHints,
    landNotShown,
  };
}

// ── Revising it (Reg s12I) ─────────────────────────────────────────────────

export const REVISE_DAYS = 2;

/** One version, as the clock reads it. */
export type SoiVersionForClock = {
  versionNo: number;
  /** The ESP it was made for: 0 the agreement's. */
  espRevisionNo: number | null;
};

/** One ESP revision, as the clock reads it. */
export type RevisionForClock = {
  no: number;
  /** YYYY-MM-DD: the notice's date. */
  givenOn: string | null;
  /** ISO time it was recorded: the day it counts from when the notice has no date. */
  recordedAt: string;
  comparables?: RevisionComparable[];
};

const mostOf = (comparables: RevisionComparable[] | undefined) =>
  (comparables ?? []).filter((c) => c.most).map((c) => c.address);
const sameProperties = (a: string[], b: string[]) => {
  const x = new Set(a.map(addressKey));
  const y = new Set(b.map(addressKey));
  return x.size === y.size && [...x].every((k) => y.has(k));
};

/**
 * When the statement has to be revised by (Reg s12I), or null. Measured from
 * the latest version: the first ESP revision after the one it was made for
 * whose most comparable properties aren't the ones in it. A revision that
 * kept no comparable sales (before 0120) can't be compared, so starts no
 * clock. The properties in a statement are those of the ESP it was made for:
 * Section A is filled from them, and its addresses can't be retyped.
 */
export function soiReviseBy(input: {
  versions: SoiVersionForClock[];
  revisions: RevisionForClock[];
  /** The listing's 3 most comparable: the agreement's ESP. */
  firstEsp: string[];
}): { revisionNo: number; revisedOn: string; dueBy: string } | null {
  if (input.versions.length === 0) return null;
  const latest = [...input.versions].sort((a, b) => b.versionNo - a.versionNo)[0];
  const revisions = [...input.revisions].sort((a, b) => a.no - b.no);
  const madeFor = latest.espRevisionNo ?? 0;

  // The properties as at the ESP it was made for: that revision's, else the
  // latest one before it that kept its own, else the agreement's.
  const setAt = (no: number): string[] => {
    const kept = revisions.filter((r) => r.no <= no && (r.comparables ?? []).length > 0).pop();
    return kept ? mostOf(kept.comparables) : input.firstEsp;
  };
  const inStatement = setAt(madeFor);

  for (const r of revisions) {
    if (r.no <= madeFor || (r.comparables ?? []).length === 0) continue;
    if (sameProperties(mostOf(r.comparables), inStatement)) continue;
    const revisedOn = r.givenOn && ISO.test(r.givenOn) ? r.givenOn : sydneyToday(new Date(r.recordedAt));
    return { revisionNo: r.no, revisedOn, dueBy: addNswBusinessDays(revisedOn, REVISE_DAYS) };
  }
  return null;
}

/** The line on the card and on the ESP revision card. */
export function reviseByLine(due: { revisionNo: number; dueBy: string }, now: Date = new Date()): string {
  const today = sydneyToday(now);
  const why = `ESP revision ${due.revisionNo} took into account different comparable properties`;
  return today > due.dueBy
    ? `Overdue: revise the Statement of Information. It was due by ${formatAuDate(due.dueBy)}: ${why} (Reg s12I).`
    : `Revise the Statement of Information by ${formatAuDate(due.dueBy)}: ${why} (Reg s12I).`;
}

// ── The versions, in words ─────────────────────────────────────────────────

export type SoiVersion = {
  versionNo: number;
  source: "realcomply" | "uploaded";
  pdfPath: string;
  fileName: string | null;
  content: SoiContent | null;
  espRevisionNo: number | null;
  /** YYYY-MM-DD. */
  preparedOn: string;
  preparedByName: string | null;
  createdAt: string;
};

const forEsp = (no: number | null) => (no === null ? "" : no === 0 ? ", for the agreement's ESP" : `, for ESP revision ${no}`);

/** "Version 2, made in RealComply, prepared 12 February 2027 by Ana Agent, for ESP revision 1". */
export function versionLine(v: SoiVersion): string {
  const how = v.source === "realcomply" ? "made in RealComply" : `uploaded${v.fileName ? ` (${v.fileName})` : ""}`;
  const who = v.preparedByName ? ` by ${v.preparedByName}` : "";
  return `Version ${v.versionNo}, ${how}, prepared ${formatAuDate(v.preparedOn)}${who}${forEsp(v.espRevisionNo)}`;
}

// ── The link for online ads ────────────────────────────────────────────────

export type SoiLink = {
  token: string;
  enabled: boolean;
  changedAt: string | null;
  changedByName: string | null;
};

/** Why the link doesn't show the statement, or null when it does. The database's own check is the one that counts. */
export function linkStoppedBecause(input: {
  enabled: boolean;
  hasVersion: boolean;
  withdrawn: boolean;
  storedStage: number;
  signedOff: boolean;
}): string | null {
  if (!input.enabled) return "The link is switched off.";
  if (!input.hasVersion) return "There's no statement on this listing yet.";
  if (input.withdrawn) return "The link stopped working: this listing is withdrawn from sale.";
  if (input.storedStage >= 5 || input.signedOff) return "The link stopped working: this listing has reached Settled.";
  return null;
}

export const LINK_EXPLAINER =
  "Put this link in your online ads (s72C(4)). Anyone with it sees the current statement only, nothing else. It stops working once the listing reaches Settled or is withdrawn from sale, and you can switch it off at any time.";

/** The compliance record's lines under the card. */
export function soiRecordLines(input: {
  versions: SoiVersion[];
  reviseBy: { revisionNo: number; dueBy: string } | null;
  link: SoiLink | null;
  now?: Date;
}): string[] {
  const lines = [...input.versions].sort((a, b) => a.versionNo - b.versionNo).map((v) => `${versionLine(v)}.`);
  if (input.reviseBy) lines.push(reviseByLine(input.reviseBy, input.now));
  if (input.link) {
    const who = input.link.changedByName ? ` by ${input.link.changedByName}` : "";
    const when = input.link.changedAt ? ` on ${formatAuDate(sydneyToday(new Date(input.link.changedAt)))}` : "";
    lines.push(`Link for online ads: switched ${input.link.enabled ? "on" : "off"}${when}${who}.`);
  }
  return lines;
}
