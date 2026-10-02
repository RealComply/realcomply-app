import { hasSubjectDetail, proseComparison, type Comparable, type EspFigures, type SubjectAttributes } from "./comparables";
import { daysOnMarket, longDate, type MarketListing } from "./market-listings";

// "Draft my reasoning" on the ESP reasoning card (a4c).
//
// REVERSAL — founder decision, 2 Oct 2026. Until now the rule (Adam, 7 Sep
// 2026) was that the draft only ARRANGES THE AGENT'S OWN FRAGMENTS: it
// quoted the sales they had marked and the notes they had typed, stated no
// conclusion, and left "the estimate is reasonable" to them. That rule is
// reversed. This draft is written by RealComply from the file, in the first
// person as the agent, and it does reach a conclusion about how the estimate
// sits against the sales.
//
// What makes that safe is not the wording but the limits below, each of which
// is enforced in code and asserted in scripts/check-comparables.ts:
//
//   (a) The only estimate in the draft is the one recorded from the agency
//       agreement. It is never set, suggested, adjusted or restated as a
//       different figure, and with no estimate on file there is no draft.
//   (b) Honest about the evidence. When the sales sit mostly above or below
//       the estimate, or there are too few to judge, the draft says so and
//       does not argue the estimate is supported. The card shows the agent a
//       note saying the same.
//   (c) On-market listings are competition, not evidence of value. They are
//       described as published and never set against the estimate.
//   (d) Only facts in the file. No sale, feature, condition or market
//       commentary the file does not hold, and no draft at all until the
//       listing's own details are confirmed.
//   (e) No guarantee language: never "compliant", "correct" or "accurate".
//   (f) Where the agent has marked sales, only the ones marked Relied on are
//       relied on.
//
// The draft is never the agent's reasoning until they make it so. It is shown
// under an on-screen disclaimer (never part of this text), the agent must
// change its wording before they can confirm it — spacing, punctuation and
// capitals alone do not count — and then confirm it in one click. Both are
// enforced on the server, and the card cannot complete before that. See
// lib/rules/esp-reasoning-adoption.ts.

export type EvidenceVerdict = "supports" | "mostly_above" | "mostly_below" | "too_few";

export type EspDraftInput = {
  /** a4: the estimated selling price recorded from the agency agreement. */
  esp: EspFigures;
  subject: SubjectAttributes;
  /** properties.property_type — "House", "Unit" and so on. */
  subjectType: string | null;
  comparables: Comparable[];
  /** The on-market list as at the agreement date (as_at null). */
  listings: MarketListing[];
  /** a3's event date, ISO. */
  agreementDate: string | null;
  /** The agent confirmed nothing comparable was on the market at that date. */
  noneOnMarketConfirmed: boolean;
};

export type EspDraftUnavailable = {
  kind: "unavailable";
  reason: "no_estimate" | "attributes_unconfirmed";
  /** Addressed to the agent, shown where the button would be. */
  message: string;
};

export type EspDraft = {
  kind: "draft";
  text: string;
  /** The three paragraphs separately, so the checks can hold each to its own rules. */
  sections: { sales: string; estimate: string; market: string };
  /** The agent's own notes as they appear, quoted, in the text — theirs, not ours. */
  agentQuotes: string[];
  evidence: EvidenceVerdict;
  /** Ids of the sales the draft draws on most. */
  drawnOn: string[];
  /** Addressed to the agent and shown on the card whenever evidence isn't "supports". */
  warning: string | null;
};

const MIN_SALES_TO_JUDGE = 2;
const MOST_ALIKE = 3;

export function draftEspReasoning(input: EspDraftInput): EspDraftUnavailable | EspDraft {
  const { esp, subject } = input;

  // (a) No estimate, no draft. Nothing here may stand in for the figure.
  if (esp.low === null || esp.high === null) {
    return {
      kind: "unavailable",
      reason: "no_estimate",
      message:
        "The agency agreement is needed first. Record the estimated selling price from it, and the draft will be written around that figure and no other.",
    };
  }

  // (d) Every comparison runs against the listing's own details. Until a
  // person has confirmed them, a draft would be guessing.
  const missing = unconfirmedDetails(subject);
  if (missing) {
    return { kind: "unavailable", reason: "attributes_unconfirmed", message: missing };
  }

  const agentQuotes: string[] = [];
  const quote = (note: string | null): string => {
    const t = (note ?? "").trim().replace(/\s+/g, " ");
    if (!t) return "";
    const q = `“${t}”`;
    agentQuotes.push(q);
    return q;
  };

  const priced = input.comparables.filter((c) => c.weighting !== "not_comparable");
  const legacyRejected = input.comparables.filter((c) => c.weighting === "not_comparable");
  const hasMarks = priced.some((c) => c.weighting === "relied" || c.weighting === "considered");

  // (f) With marks, the agent decided what is relied on. Without them, the
  // draft picks the closest by type, size, location and date — and says so.
  const drawn = hasMarks
    ? priced.filter((c) => c.weighting === "relied")
    : rankByLikeness(input, priced.filter((c) => c.salePrice !== null)).slice(0, MOST_ALIKE);
  const drawnIds = new Set(drawn.map((c) => c.id));
  const others = priced.filter((c) => !drawnIds.has(c.id));

  const gaps = notRecorded(subject);
  const sales =
    salesParagraph(input, drawn, others, legacyRejected, hasMarks, quote) +
    (gaps.length > 0
      ? ` This file doesn't record the listing's ${list(gaps)}, so I haven't compared the sales on ${gaps.length === 1 ? "it" : "them"}.`
      : "");
  const { text: estimate, verdict, warning } = estimateParagraph(input, drawn, hasMarks);
  const market = marketParagraph(input, quote);

  return {
    kind: "draft",
    text: [sales, estimate, market].filter(Boolean).join("\n\n"),
    sections: { sales, estimate, market },
    agentQuotes,
    evidence: verdict,
    drawnOn: drawn.map((c) => c.id),
    warning,
  };
}

// ── (d) The listing's own details ───────────────────────────────────────

const DETAIL_LABELS: Array<[keyof SubjectAttributes, string]> = [
  ["bedrooms", "bedrooms"],
  ["bathrooms", "bathrooms"],
  ["carSpaces", "car spaces"],
  ["landSizeSqm", "land size"],
  ["internalAreaSqm", "internal area"],
];

// What a person stands behind is the property's own columns: typed in Edit
// listing details at set-up, or accepted from the report with "Use these
// details". Figures the report read but nobody has accepted sit in
// subject.suggestions and are never used here. (attributes_confirmed_at is
// only stamped on the second route, so it cannot be the test on its own.)
function unconfirmedDetails(subject: SubjectAttributes): string | null {
  if (hasSubjectDetail(subject)) return null;
  const what = "bedrooms, bathrooms, car spaces, land size and internal area";
  return subject.suggestions
    ? `This listing's details aren't confirmed yet. The report suggests ${what} figures, but nothing is used until you accept them with "Use these details" above the sales. The draft compares every sale with them, so it won't guess.`
    : `This listing's details aren't recorded yet (${what}). Add them in Edit listing details at the top of the page. The draft compares every sale with them, so it won't guess.`;
}

/** The confirmed details that are still empty, so the draft can say what it didn't compare. */
function notRecorded(subject: SubjectAttributes): string[] {
  return DETAIL_LABELS.filter(([k]) => subject[k] === null).map(([, label]) => label);
}

// ── Which sales are most alike ──────────────────────────────────────────
//
// Only used when the agent has marked nothing. Each term is a fact the
// paragraph then states, so the ranking never rests on anything the reader
// can't see: type, the measured differences, where it is, and when it sold.

function rankByLikeness(input: EspDraftInput, sales: Comparable[]): Comparable[] {
  const score = (c: Comparable): number => {
    let s = 0;
    const type = typeRelation(input.subjectType, c.propertyType);
    if (type === "different") s += 3;
    const { subject } = input;
    if (subject.bedrooms !== null && c.bedrooms !== null) s += Math.abs(c.bedrooms - subject.bedrooms);
    if (subject.bathrooms !== null && c.bathrooms !== null) s += 0.5 * Math.abs(c.bathrooms - subject.bathrooms);
    if (subject.carSpaces !== null && c.carSpaces !== null) s += 0.25 * Math.abs(c.carSpaces - subject.carSpaces);
    if (subject.landSizeSqm && c.landSizeSqm !== null) s += 4 * Math.abs(c.landSizeSqm - subject.landSizeSqm) / subject.landSizeSqm;
    if (subject.internalAreaSqm && c.internalAreaSqm !== null)
      s += 4 * Math.abs(c.internalAreaSqm - subject.internalAreaSqm) / subject.internalAreaSqm;
    const place = proseComparison(subject, c).place;
    s += place === "in the same building" ? -1 : place === "in the same suburb" ? 0 : place === null ? 0.5 : 1.5;
    const months = monthsBefore(c.saleDate, input.agreementDate);
    if (months !== null) s += Math.abs(months) / 6;
    if (c.distanceM !== null) s += c.distanceM / 2000;
    return s;
  };
  return [...sales].sort((x, y) => score(x) - score(y) || x.position - y.position);
}

function typeRelation(mine: string | null, theirs: string | null): "same" | "different" | null {
  const a = normaliseType(mine);
  const b = normaliseType(theirs);
  if (!a || !b) return null;
  return a === b ? "same" : "different";
}

function normaliseType(t: string | null): string | null {
  const v = (t ?? "").trim().toLowerCase();
  if (!v) return null;
  if (/apartment|unit|flat/.test(v)) return "unit";
  if (/town ?house|villa|terrace|duplex|semi/.test(v)) return "townhouse";
  if (/house|home/.test(v)) return "house";
  return v;
}

// ── Paragraph 1: the sales ──────────────────────────────────────────────

function salesParagraph(
  input: EspDraftInput,
  drawn: Comparable[],
  others: Comparable[],
  legacyRejected: Comparable[],
  hasMarks: boolean,
  quote: (note: string | null) => string,
): string {
  const lines: string[] = [];

  if (drawn.length === 0) {
    lines.push(
      hasMarks
        ? "I haven't marked any of the sales in the report as relied on."
        : "The comparable-sales report has no sales with a sale price that I can draw on.",
    );
  } else {
    lines.push(
      hasMarks
        ? `The ${drawn.length === 1 ? "sale" : "sales"} I relied on ${drawn.length === 1 ? "is" : "are"} ${list(drawn.map(shortAddress))}.`
        : drawn.length === 1 && others.every((c) => c.salePrice === null)
          ? `The only sale in the report with a price is ${shortAddress(drawn[0])}.`
          : `The ${drawn.length === 1 ? "sale" : "sales"} I've drawn on most ${drawn.length === 1 ? "is" : "are"} ${list(drawn.map(shortAddress))}, ` +
            `the closest to this property in type, size, location and date.`,
    );
    for (const c of drawn) {
      const note = quote(c.agentNote);
      lines.push(`${saleFacts(c, input)} ${describeAgainstSubject(c, input)}${note ? ` My note: ${note}.` : ""}`);
    }
  }

  if (others.length > 0) {
    const parts = others.map((c) => {
      const apart = setsApart(c, input);
      const why = hasMarks
        ? c.weighting === "considered"
          ? "I considered it but didn't rely on it"
          : "I didn't mark it as relied on"
        : null;
      const note = quote(c.agentNote);
      return `${shortAddress(c)} (${priceAndMonth(c)})${apart ? ` ${apart}` : ""}${why ? `${apart ? "; " : " "}${why}` : ""}${note ? `, noting ${note}` : ""}`;
    });
    // "Less alike" is only claimed when the ranking decided it. With marks,
    // the agent decided, and the draft says what they did, not why.
    const lead = drawn.length === 0 ? "" : hasMarks ? "Of the other sales: " : "The other sales are less alike. ";
    lines.push(`${lead}${hasMarks && drawn.length > 0 ? parts.join("; ") : capitalise(parts.join(". "))}.`);
  }

  for (const c of legacyRejected) {
    const note = quote(c.agentNote);
    lines.push(`I didn't treat ${shortAddress(c)} as comparable${note ? `: ${note}` : ""}.`);
  }

  return lines.join(" ");
}

function saleFacts(c: Comparable, input: EspDraftInput): string {
  const price = c.salePrice !== null ? `sold for ${money(c.salePrice)}` : "sold (the report gives no price)";
  const month = monthLabel(c.saleDate);
  const before = monthsBefore(c.saleDate, input.agreementDate);
  let when = month ? ` in ${month}` : "";
  if (before !== null && before > 0) when += `, ${before} ${before === 1 ? "month" : "months"} before the agreement`;
  else if (before === 0) when += ", the same month as the agreement";
  return `${shortAddress(c)} ${price}${when}.`;
}

function describeAgainstSubject(c: Comparable, input: EspDraftInput): string {
  const { same, diff, place } = proseComparison(input.subject, c);
  const sentences: string[] = [];

  const where: string[] = [];
  if (c.distanceM !== null) where.push(`${distance(c.distanceM)} away`);
  if (place) where.push(place);
  const type = typeRelation(input.subjectType, c.propertyType);
  if (type === "same") where.push(`also ${article(normaliseType(c.propertyType) as string)}`);
  if (type === "different") {
    where.push(`${article(normaliseType(c.propertyType) as string)}, not ${article(normaliseType(input.subjectType) as string)}`);
  }
  if (where.length > 0) sentences.push(`It is ${list(where)}.`);
  if (same.length > 0) sentences.push(`It has the same ${list(same)}.`);
  if (diff.length > 0) sentences.push(`Against this property it has ${list(diff)}.`);

  return sentences.length > 0 ? sentences.join(" ") : "The report gives nothing to compare it with this property.";
}

function setsApart(c: Comparable, input: EspDraftInput): string {
  const { diff, place } = proseComparison(input.subject, c);
  const bits: string[] = [];
  if (place === "in a different suburb") bits.push("is in a different suburb");
  const type = typeRelation(input.subjectType, c.propertyType);
  if (type === "different") bits.push(`is ${article(normaliseType(c.propertyType) as string)}`);
  if (diff.length > 0) bits.push(`has ${list(diff)}`);
  const before = monthsBefore(c.saleDate, input.agreementDate);
  if (before !== null && before >= 6) bits.push(`sold ${before} months before the agreement`);
  if (c.distanceM !== null && c.distanceM >= 1500) bits.push(`is ${distance(c.distanceM)} away`);
  return list(bits);
}

// ── Paragraph 2: the estimate against the sales ─────────────────────────

function estimateParagraph(
  input: EspDraftInput,
  drawn: Comparable[],
  hasMarks: boolean,
): { text: string; verdict: EvidenceVerdict; warning: string | null } {
  const esp = espLabel(input.esp);
  const recorded = `My estimated selling price, recorded in the agency agreement, is ${esp}.`;
  const prices = drawn
    .map((c) => c.salePrice)
    .filter((p): p is number => p !== null)
    .sort((a, b) => a - b);

  if (prices.length < MIN_SALES_TO_JUDGE) {
    const what =
      prices.length === 0
        ? hasMarks
          ? "With no sale marked as relied on, there is nothing to set it against"
          : "With no priced sales in the report, there is nothing to set it against"
        : hasMarks
          ? `I relied on one sale, at ${money(prices[0])}`
          : `The report has only one priced sale, at ${money(prices[0])}`;
    return {
      text: `${recorded} ${what}, which is too few sales to judge the estimate on sales alone.`,
      verdict: "too_few",
      warning:
        "There aren't enough comparable sales here to judge your estimate on sales alone, so the draft says that rather than " +
        "arguing the estimate is supported. Before you confirm, add what else you relied on, or talk to your licensee in charge.",
    };
  }

  const low = input.esp.low as number;
  const high = input.esp.high as number;
  const above = prices.filter((p) => p > high).length;
  const below = prices.filter((p) => p < low).length;
  const within = prices.length - above - below;
  const n = prices.length;
  const range = `${money(prices[0])} and ${money(prices[n - 1])}`;
  const all = n === 2 ? "both" : "all of them";
  const counts =
    within === n
      ? `${all} within my estimate`
      : above === n
        ? `${all} above my estimate`
        : below === n
          ? `${all} below my estimate`
          : list(
          [
            within > 0 ? `${count(within)} within my estimate` : null,
            above > 0 ? `${count(above)} above it` : null,
            below > 0 ? `${count(below)} below it` : null,
          ].filter(Boolean) as string[],
        );
  const facts = `The ${count(n)} sales I ${hasMarks ? "relied on" : "drew on"} sold between ${range}, ${counts}.`;

  if (above * 2 > n || below * 2 > n) {
    const side = above * 2 > n ? "above" : "below";
    return {
      text:
        `${recorded} ${facts} ${above === n || below === n ? "So" : `Most of these sales sold ${side} my estimate, so`} ` +
        "on this evidence they don't support it as it stands. " +
        "If I hold to the estimate, my reasons for it need to be recorded here.",
      verdict: side === "above" ? "mostly_above" : "mostly_below",
      warning:
        `Most of the sales this draft draws on sold ${side} your estimated selling price. The draft says so plainly and doesn't ` +
        "argue that the estimate is supported. If you stand by the estimate, add your reasons before you confirm, or talk to your licensee in charge.",
    };
  }

  return {
    text: `${recorded} ${facts} My estimate sits within the range of these sales, and on this evidence I consider it is supported by them.`,
    verdict: "supports",
    warning: null,
  };
}

// ── Paragraph 3: the competition ────────────────────────────────────────
//
// (c) Described, never weighed. Each listing gets its address, the other
// agent's advertised price or guide exactly as published, and how long it had
// been listed at the agreement date. No sentence here mentions the estimate.

function marketParagraph(input: EspDraftInput, quote: (note: string | null) => string): string {
  const when = longDate(input.agreementDate);
  const at = when ? `at the agreement date (${when})` : "at the agreement date";

  if (input.listings.length === 0) {
    return input.noneOnMarketConfirmed
      ? `I checked what was on the market ${at}, and there were no comparable properties for sale.`
      : `No properties on the market ${at} are recorded in this file.`;
  }

  const described = input.listings.map((l) => {
    const price = l.askingPrice?.trim()
      ? `advertised as “${l.askingPrice.trim()}”`
      : l.saleMethod?.trim()
        ? `for sale by ${l.saleMethod.trim().toLowerCase()} with no price advertised`
        : "no advertised price recorded";
    const days = daysOnMarket(l.listedDate, input.agreementDate);
    const listed = days === null ? "days listed not recorded" : `listed for ${days} ${days === 1 ? "day" : "days"}`;
    const mark =
      l.weighting === "competition" ? ", which I treat as direct competition" : l.weighting === "considered" ? ", which I looked at" : "";
    const note = quote(l.agentNote);
    return `${shortAddress(l)}, ${price}, ${listed}${mark}${note ? ` (my note: ${note})` : ""}`;
  });

  return `On the market ${at}: ${described.join("; ")}. These are other agents' advertised prices, not sales.`;
}

// ── (a)–(f), checked ────────────────────────────────────────────────────
//
// Run over every draft in scripts/check-comparables.ts and the tests. The
// agent's own quoted notes are taken out first: those are their words, and
// the limits are on what RealComply writes.

const GUARANTEE = /\b(compliant|compliance|correct(ly)?|accurate(ly)?|guarantee[ds]?|certain(ly)?|definitely)\b/i;
const SUPPORT_CLAIM = /\b(?<!don't |doesn't |not )(support|supports|supported|justif\w*)\b/i;

export function draftProblems(draft: EspDraft, input: EspDraftInput): string[] {
  const problems: string[] = [];
  const strip = (s: string) => draft.agentQuotes.reduce((acc, q) => acc.split(q).join(""), s);
  const ours = strip(draft.text);
  const sales = strip(draft.sections.sales);
  const estimate = strip(draft.sections.estimate);
  const market = strip(draft.sections.market);

  // (a) Every figure outside the market paragraph is the agreement's estimate
  // or a sale price off the report.
  const allowed = new Set<string>();
  if (input.esp.low !== null) allowed.add(money(input.esp.low));
  if (input.esp.high !== null) allowed.add(money(input.esp.high));
  for (const c of input.comparables) if (c.salePrice !== null) allowed.add(money(c.salePrice));
  for (const f of `${sales} ${estimate}`.match(/\$\d{1,3}(?:,\d{3})*(?:\.\d+)?[km]?/gi) ?? []) {
    if (!allowed.has(f)) problems.push(`(a) a figure that is neither the estimate nor a sale price: ${f}`);
  }
  if (!estimate.includes(espLabel(input.esp))) problems.push("(a) the estimate is not stated as recorded in the agreement");

  // (b) No support claimed unless the evidence gives it, and a note for the
  // agent whenever it doesn't.
  if (draft.evidence !== "supports") {
    if (SUPPORT_CLAIM.test(ours)) problems.push("(b) argues the estimate is supported when the sales don't");
    if (!draft.warning) problems.push("(b) no note to the agent about unsupportive evidence");
  } else if (draft.warning) {
    problems.push("(b) a warning on evidence that supports the estimate");
  }

  // (c) The market paragraph never mentions the estimate or weighs value, and
  // asking prices appear nowhere else.
  if (/\bestimate|\bvalue\b|\bworth\b|\bsupport|\bjustif/i.test(market)) {
    problems.push("(c) the on-market paragraph sets listings against the estimate");
  }
  for (const v of [input.esp.low, input.esp.high]) {
    if (v !== null && market.includes(money(v))) problems.push("(c) the estimate appears beside the asking prices");
  }
  for (const l of input.listings) {
    const asking = l.askingPrice?.trim();
    if (asking && (sales.includes(asking) || estimate.includes(asking))) {
      problems.push(`(c) an asking price is used outside the on-market paragraph: ${asking}`);
    }
  }

  // (e) No guarantee words.
  const guarantee = ours.match(GUARANTEE);
  if (guarantee) problems.push(`(e) guarantee language: "${guarantee[0]}"`);

  // (f) With marks, only Relied on sales are drawn on.
  const marked = input.comparables.some((c) => c.weighting === "relied" || c.weighting === "considered");
  if (marked) {
    const relied = new Set(input.comparables.filter((c) => c.weighting === "relied").map((c) => c.id));
    for (const id of draft.drawnOn) if (!relied.has(id)) problems.push(`(f) relies on a sale not marked Relied on: ${id}`);
  }

  return problems;
}

// ── Small helpers ───────────────────────────────────────────────────────

export function espLabel(esp: EspFigures): string {
  if (esp.low === null || esp.high === null) return "";
  return esp.low === esp.high ? money(esp.low) : `${money(esp.low)} to ${money(esp.high)}`;
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-AU")}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(iso: string | null): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? "");
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

/** Whole calendar months from the sale to the agreement. Null if either is unknown. */
function monthsBefore(saleIso: string | null, agreementIso: string | null): number | null {
  const s = /^(\d{4})-(\d{2})/.exec(saleIso ?? "");
  const a = /^(\d{4})-(\d{2})/.exec(agreementIso ?? "");
  if (!s || !a) return null;
  return (Number(a[1]) - Number(s[1])) * 12 + (Number(a[2]) - Number(s[2]));
}

function priceAndMonth(c: Comparable): string {
  const price = c.salePrice !== null ? money(c.salePrice) : "no price in the report";
  const month = monthLabel(c.saleDate);
  return month ? `${price}, ${month}` : price;
}

function distance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)}km` : `${Math.round(metres)}m`;
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function count(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function article(word: string): string {
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}

function shortAddress(c: { address: string }): string {
  return c.address.split(",")[0].trim() || c.address;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
