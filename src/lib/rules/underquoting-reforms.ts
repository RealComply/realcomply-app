// The NSW underquoting reforms: the Property and Stock Agents Amendment
// (Underquoting and Other Agent Conduct) Act 2026 No 18 and Regulation 2026
// No 578 (made 23 Oct 2026). Most of it starts on 17 November 2026; the
// statement of information (s72C, Reg Part 2A Div 4) on 8 February 2027.
//
// One place for the dates, so every card, check and message switches on the
// same midnight (Adam and Master, 9 Nov 2026). Sydney time: both dates fall in
// daylight saving, +11:00.
//
// SECTION NUMBERS. The amending Act renumbers s72A: the 10% range rule moves
// from s72A(2) to s72A(3), evidence of reasonableness from s72A(5) to
// s72A(2)(b) and s72A(5)(b)(ii), and revisions from s72A(4) to s72A(5). The
// app cites plain "s72A" for these, which is right on both sides of the date,
// rather than a subsection that is wrong on one of them.

/** Midnight at the start of 17 November 2026, Sydney. */
export const REFORMS_FROM = new Date("2026-11-17T00:00:00+11:00");

/** Midnight at the start of 8 February 2027, Sydney: the statement of information. */
export const SOI_FROM = new Date("2027-02-08T00:00:00+11:00");

export function reformsInForce(now: Date = new Date()): boolean {
  return now.getTime() >= REFORMS_FROM.getTime();
}

/**
 * Whether the Act and Regulation text Ask the Act searches already has the 17
 * November changes in it. The copies in src/lib/legislation are the 29 June
 * 2026 Act and the 1 July 2025 Regulation. Set to true when the new versions
 * from legislation.nsw.gov.au are loaded (Adam downloads them once the site
 * shows the 17 November version).
 */
export const STORED_LEGISLATION_HAS_REFORMS = false;

/** True from 17 November until the stored legislation catches up. */
export function storedLegislationOutOfDate(now: Date = new Date()): boolean {
  return reformsInForce(now) && !STORED_LEGISLATION_HAS_REFORMS;
}

/** The line in Ask the Act from 17 November until the new text is loaded. */
export const ASK_THE_ACT_OUT_OF_DATE_LINE =
  "This copy of the Act is from before the underquoting changes that started on 17 November 2026. For sections 72 to 74, check the current Act on legislation.nsw.gov.au.";

/**
 * What s73(3) asks of the advertising after a revision, a pass-in or a
 * rejected written offer. Before 17 November: amend or retract as soon as
 * practicable after a revision. From 17 November: online ads within 1
 * business day, other ads as soon as practicable.
 */
export function advertisingFixLine(now: Date = new Date()): string {
  return reformsInForce(now)
    ? "s73(3). Online ads showing a lower figure have to be fixed or taken down within 1 business day, other ads as soon as practicable."
    : "s73(3). Anything showing a lower figure has to be amended or pulled as soon as practicable.";
}

// ── Price wording ─────────────────────────────────────────────────────────
//
// s73(2): no "offers above" or "offers over" with a price, "or similar
// symbols or words". Fair Trading's checklist names the price-plus symbol
// ("$900,000+") alongside them (Master, 9 Nov 2026). The daily website check
// already asks the reader for it; this is the same rule for what the agent
// types on the advertised price card.

const PHRASES = ["offers over", "offers above", "offers from", "o.n.o"] as const;

/**
 * A price followed by a plus sign: "$900,000+", "900,000 +", "900k+", "$1.2m+".
 * Only a price: a dollar sign, thousands separators or a k/m, so "3+ bedrooms"
 * or "2+ offers" in a note isn't mistaken for one.
 */
const PRICE_PLUS =
  /(?:\$\s?\d[\d,.]*(?:\s?(?:k|m|mil|million))?|\b\d{1,3}(?:,\d{3})+|\b\d+(?:\.\d+)?\s?(?:k|m|mil|million))\s?\+/i;

/** The banned price wording found in some text, as it appears. Empty when there is none. */
export function bannedPriceWording(text: string): string[] {
  const found: string[] = [];
  const lower = text.toLowerCase();
  for (const phrase of PHRASES) {
    if (lower.includes(phrase)) found.push(phrase);
  }
  const plus = text.match(PRICE_PLUS);
  if (plus) found.push(plus[0].trim());
  return found;
}
