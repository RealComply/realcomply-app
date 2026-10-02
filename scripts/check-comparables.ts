/**
 * Checks the comparable-sales logic — the parts that produce words a licensee
 * will put their name to.
 *
 * FOR A DEVELOPER SESSION, NOT FOR ADAM. Run from the repo root:
 *
 *   node --import ./scripts/test-hooks.mjs scripts/check-comparables.ts
 *
 * WHY THIS IS CHECKED IN. "Draft my reasoning" writes text the agent may adopt
 * as their s72A reasoning. Until 2 Oct 2026 the rule was that the draft only
 * arranged the agent's own fragments, and the checks here asserted it stated
 * no price and no conclusion. That rule was reversed (founder decision,
 * 2 Oct 2026 — see src/lib/data/esp-draft.ts): the draft now concludes. So
 * the checks now hold it to the limits that replaced the old rule. It never
 * states an estimate other than the agreement's, never uses an asking price as
 * support, says so plainly (and warns the agent) when the sales don't support
 * the estimate, and contains no guarantee words. A refactor that made it
 * "more persuasive" would read as an improvement in review, which is why
 * these assert the ABSENCE of things.
 *
 * The difference lines are the other half: arithmetic that must not round a
 * 2m² difference into a claim, and must say nothing at all when it does not
 * know one side of the comparison.
 */

import {
  differenceLine,
  fileSpecificPrompts,
  hasSubjectDetail,
  proseComparison,
  reasoningNudge,
  similaritiesFrom,
  streetAddressOf,
  suburbOf,
  type Comparable,
  type SubjectAttributes,
} from "../src/lib/data/comparables";
import { daysOnMarket, onMarketHeading, type MarketListing } from "../src/lib/data/market-listings";
import { draftEspReasoning, draftProblems, type EspDraft, type EspDraftInput } from "../src/lib/data/esp-draft";

const ESP = { low: 1_300_000, high: 1_400_000 };

let failures = 0;
const fail = (message: string) => {
  console.log(`FAIL  ${message}`);
  failures += 1;
};
const ok = (message: string) => console.log(`ok    ${message}`);

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) ok(name);
  else fail(`${name}\n        expected ${e}\n        got      ${a}`);
}

const subject: SubjectAttributes = {
  bedrooms: 4,
  bathrooms: 2,
  carSpaces: 2,
  landSizeSqm: 600,
  internalAreaSqm: 210,
  conditionNote: "Renovated kitchen and bathrooms",
  address: "42 Landra Ave, Mount Colah",
  addressSuburb: "mount colah",
  suggestions: null,
  confirmedAt: "2026-09-07T00:00:00Z",
};

const blank: SubjectAttributes = {
  bedrooms: null,
  bathrooms: null,
  carSpaces: null,
  landSizeSqm: null,
  internalAreaSqm: null,
  conditionNote: null,
  address: null,
  addressSuburb: null,
  suggestions: null,
  confirmedAt: null,
};

function comparable(over: Partial<Comparable>): Comparable {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    address: "14 Smith St, Mount Colah",
    salePrice: 1_220_000,
    saleDate: "2026-06-14",
    bedrooms: 3,
    bathrooms: 1,
    carSpaces: 1,
    landSizeSqm: 480,
    internalAreaSqm: 180,
    distanceM: 400,
    propertyType: "house",
    source: "report",
    weighting: null,
    agentNote: null,
    position: 0,
    ...over,
  };
}

// ── Differences: arithmetic, never opinion ────────────────────────────────

check(
  "difference line reads in plain English",
  differenceLine(subject, comparable({})),
  "1 bedroom fewer, 1 bathroom fewer, 1 car space fewer, 120m² less land, 30m² less internal area",
);

check(
  "says nothing when the subject is unknown",
  differenceLine(blank, comparable({})),
  "",
);

check(
  "a 2m² difference is not a difference",
  differenceLine(
    { ...subject, bedrooms: 3, bathrooms: 1, carSpaces: 1, internalAreaSqm: 180 },
    comparable({ landSizeSqm: 602 }),
  ),
  "",
);

check(
  "a bigger comparable reads as more, not less",
  differenceLine({ ...subject, bathrooms: 1, carSpaces: 1, internalAreaSqm: 180 }, comparable({ bedrooms: 5, bathrooms: 1, carSpaces: 1, landSizeSqm: 600, internalAreaSqm: 180 })),
  "1 bedroom more",
);

check("hasSubjectDetail is false on an empty subject", hasSubjectDetail(blank), false);
check("hasSubjectDetail is true once anything is known", hasSubjectDetail(subject), true);

// ── Similarities, the other column ────────────────────────────────────────

check(
  "similarities name what actually matches",
  similaritiesFrom(subject, comparable({ bedrooms: 4, bathrooms: 2, carSpaces: 2, landSizeSqm: 598, internalAreaSqm: 180 })),
  ["4 bedrooms", "2 bathrooms", "2 car spaces", "about the same land", "same suburb"],
);

check(
  "a different suburb is not a similarity",
  similaritiesFrom(subject, comparable({ address: "22 High St, Asquith", bedrooms: 3, bathrooms: 1, carSpaces: 1, landSizeSqm: 480, internalAreaSqm: 180 })),
  [],
);

check("suburb is read off the address", suburbOf("14 Smith St, Mount Colah"), "mount colah");
check("a state suffix does not break it", suburbOf("14 Smith St, Mount Colah NSW 2079"), "mount colah");
check("an address with no suburb says so", suburbOf("14 Smith St"), null);

// THE 18/4-10 POUND ROAD CASE (Adam, 8 Sep 2026). Four sales in the same
// building were each written up as "a different suburb", because the suburb
// sat in its own comma part ahead of the state and the last part — "NSW 2077"
// — was taken for a place name. The draft then asserted a difference from
// what was really a parse failure.
check("the suburb survives its own comma", suburbOf("3/4-10 Pound Road, Hornsby, NSW 2077"), "hornsby");
check("a trailing postcode alone is not a suburb", suburbOf("3/4-10 Pound Road, Hornsby, 2077"), "hornsby");
check("a state on its own is not a suburb", suburbOf("3/4-10 Pound Road, NSW"), null);

check(
  "a unit number is not part of the building",
  streetAddressOf("18/4-10 Pound Road, Hornsby"),
  "4-10 pound road",
);
check("a house has a street address too", streetAddressOf("14 Smith St, Mount Colah"), "14 smith st");
check("a bare number is not an address", streetAddressOf("12"), null);

// Same block, and it must be SAID rather than merely not denied.
const poundSubject: SubjectAttributes = {
  ...blank,
  bedrooms: 2,
  bathrooms: 1,
  carSpaces: 1,
  address: "18/4-10 Pound Road, Hornsby, NSW 2077",
  addressSuburb: suburbOf("18/4-10 Pound Road, Hornsby, NSW 2077"),
};
const poundNeighbour = comparable({
  address: "3/4-10 Pound Road, Hornsby, NSW 2077",
  bedrooms: 2,
  bathrooms: 1,
  carSpaces: 1,
  landSizeSqm: null,
  internalAreaSqm: null,
});

check(
  "a flat in the same block reads as the same building",
  similaritiesFrom(poundSubject, poundNeighbour),
  ["2 bedrooms", "1 bathroom", "1 car space", "same building"],
);

const poundProse = proseComparison(poundSubject, poundNeighbour);
if (poundProse.place === "in a different suburb") {
  fail("the 18/4-10 Pound Road bug is back — same building called a different suburb");
} else ok("a flat in the same block is not called a different suburb");
check("the draft says they are in the same building", poundProse.place, "in the same building");

// And the other half of the same rule: an unknown suburb says NOTHING. It
// must not fall through to a claim of difference.
const unknownSuburb = proseComparison(poundSubject, comparable({ address: "7 Nowhere Lane" }));
check("an unreadable suburb is left unsaid", unknownSuburb.place, null);

// A genuinely different suburb still gets said, or the fix would have gone
// too far the other way.
const realDifference = proseComparison(subject, comparable({ address: "22 High St, Asquith" }));
check("a known different suburb is still stated", realDifference.place, "in a different suburb");

// ── The draft: limits (a)–(f) ──────────────────────────────────────────────
//
// The old assertions here (no price, no conclusion) belonged to the 7 Sep
// rule, reversed on 2 Oct 2026. These replace them.

const marked: Comparable[] = [
  comparable({ id: "a", address: "14 Smith St, Mount Colah", salePrice: 1_350_000, weighting: "relied", agentNote: "closest on land and presentation" }),
  comparable({ id: "b", address: "8 Jones Ave, Mount Colah", salePrice: 1_385_000, bedrooms: 4, bathrooms: 2, carSpaces: 2, landSizeSqm: 610, internalAreaSqm: 205, weighting: "relied" }),
  comparable({ id: "c", address: "22 High St, Asquith", salePrice: 1_560_000, weighting: "not_comparable", agentNote: "renovated throughout" }),
  comparable({ id: "d", address: "5 Rose Pl, Mount Colah", salePrice: 1_220_000, weighting: "considered" }),
];

function draftInput(over: Partial<EspDraftInput> = {}): EspDraftInput {
  return {
    esp: ESP,
    subject,
    subjectType: "House",
    comparables: marked,
    listings: [],
    agreementDate: "2026-08-12",
    noneOnMarketConfirmed: false,
    ...over,
  };
}

function drafted(name: string, input: EspDraftInput): EspDraft | null {
  const result = draftEspReasoning(input);
  if (result.kind !== "draft") {
    fail(`${name}: expected a draft, got "${result.message}"`);
    return null;
  }
  const problems = draftProblems(result, input);
  if (problems.length === 0) ok(`${name}: within limits (a)–(f)`);
  else fail(`${name}: ${problems.join("; ")}`);
  return result;
}

const supported = drafted("sales that support the estimate", draftInput());
if (supported) console.log("\n--- draft as an agent would see it ---\n" + supported.text + "\n---\n");

// (a) The only estimate is the agreement's. Every other figure is a sale price.
if (supported) {
  const estimateFigures = supported.sections.estimate.match(/\$\d{1,3}(?:,\d{3})+/g) ?? [];
  const allowed = new Set(["$1,300,000", "$1,400,000", ...marked.map((c) => `$${c.salePrice?.toLocaleString("en-AU")}`)]);
  const stray = estimateFigures.filter((f) => !allowed.has(f));
  if (stray.length === 0) ok("(a) the draft contains no estimate other than the agreement's");
  else fail(`(a) the draft contains a figure that is not the agreement's estimate or a sale price: ${stray.join(", ")}`);
}
const noEstimate = draftEspReasoning(draftInput({ esp: { low: null, high: null } }));
check("(a) with no estimate on file there is no draft", noEstimate.kind, "unavailable");
if (noEstimate.kind === "unavailable" && /agency agreement is needed first/.test(noEstimate.message)) {
  ok("(a) and it says the agency agreement is needed first");
} else fail("(a) the no-estimate message does not point at the agency agreement");

// (b) Unsupported estimates are flagged, to the agent and in the draft.
const above = drafted("sales mostly above the estimate", draftInput({
  comparables: [comparable({ id: "x1", salePrice: 1_450_000, weighting: "relied" }), comparable({ id: "x2", salePrice: 1_490_000, weighting: "relied" })],
}));
const below = drafted("sales mostly below the estimate", draftInput({
  comparables: [comparable({ id: "y1", salePrice: 1_150_000, weighting: "relied" }), comparable({ id: "y2", salePrice: 1_190_000, weighting: "relied" })],
}));
const tooFew = drafted("one sale only", draftInput({ comparables: [comparable({ id: "z1", salePrice: 1_350_000 })] }));
for (const [name, d, verdict] of [["above", above, "mostly_above"], ["below", below, "mostly_below"], ["too few", tooFew, "too_few"]] as const) {
  if (!d) continue;
  check(`(b) ${name}: the verdict is honest`, d.evidence, verdict);
  if (d.warning) ok(`(b) ${name}: the card shows the agent a note`);
  else fail(`(b) ${name}: no note to the agent`);
  if (/I consider it is supported/.test(d.text)) fail(`(b) ${name}: the draft defends an estimate the sales don't support`);
  else ok(`(b) ${name}: the draft does not argue the estimate is supported`);
}
if (supported?.warning === null) ok("(b) no warning when the sales do support the estimate");
else fail("(b) a warning was shown on sales that support the estimate");

// (c) Asking prices are never support, and never set against the estimate.
const onMarketDraft = drafted("with on-market listings", draftInput({
  listings: [
    listing({ id: "m1", address: "3 Oak St, Mount Colah", askingPrice: "$1.3m - $1.4m", weighting: "competition", listedDate: "2026-07-22" }),
    listing({ id: "m2", address: "9 Elm Rd, Mount Colah", askingPrice: "Contact agent" }),
  ],
}));
if (onMarketDraft) {
  if (onMarketDraft.sections.sales.includes("$1.3m") || onMarketDraft.sections.estimate.includes("$1.3m")) {
    fail("(c) an asking price was used as evidence for the estimate");
  } else ok("(c) the draft never uses an asking price to support the estimate");
  if (/listed for 21 days/.test(onMarketDraft.sections.market) && /“\$1\.3m - \$1\.4m”/.test(onMarketDraft.sections.market)) {
    ok("(c) listings are described: address, the advertised price as written, days listed");
  } else fail(`(c) listing description is missing facts: ${onMarketDraft.sections.market}`);
}

// (d) Only facts in the file — and no draft until the listing's details are confirmed.
const unconfirmed = draftEspReasoning(draftInput({ subject: { ...blank, suggestions: { bedrooms: 4, landSizeSqm: 600 } } }));
check("(d) no draft from figures the report suggested but nobody accepted", unconfirmed.kind, "unavailable");
// The agent's own quoted notes are theirs and are taken out first.
const ours = (d: EspDraft) => d.agentQuotes.reduce((t, q) => t.split(q).join(""), d.text);
if (supported && !/condition|renovat|presentation|market (is|has)/i.test(ours(supported))) {
  ok("(d) no condition or market commentary the file does not hold");
} else if (supported) fail("(d) the draft volunteers condition or market commentary");

// (e) No guarantee words, in any of the drafts above.
const all = [supported, above, below, tooFew, onMarketDraft].filter((d): d is EspDraft => d !== null);
const guarantee = all.filter((d) => /\b(compliant|correct|accurate)\b/i.test(d.text));
if (guarantee.length === 0) ok("(e) no draft contains guarantee words");
else fail("(e) a draft says the estimate is compliant, correct or accurate");

// (f) Marks are respected: only Relied on sales are relied on.
if (supported) check("(f) only the sales marked Relied on are drawn on", supported.drawnOn, ["a", "b"]);

// ── Prompts: drawn from this file ─────────────────────────────────────────

const prompts = fileSpecificPrompts(subject, marked);
if (prompts.some((p) => p.includes("$1,220,000"))) ok("prompts quote the actual price range on this file");
else fail(`prompts did not mention the file's own price range: ${JSON.stringify(prompts)}`);

// Only when it is actually true of every sale still in play. 8 Jones Ave above
// has MORE land than the subject, so the marked set must not trigger this —
// a prompt asking why the larger land is worth something, on a file where one
// comparable is larger, would be the software mis-stating the file back at the
// agent.
if (!prompts.some((p) => /larger land/.test(p))) ok("no larger-land prompt when one sale is bigger");
else fail(`claimed larger land while 8 Jones Ave is bigger: ${JSON.stringify(prompts)}`);

const allSmaller = fileSpecificPrompts(subject, [
  comparable({ id: "s1", address: "1 Alpha St, Mount Colah", landSizeSqm: 470, salePrice: 1_150_000, weighting: "relied" }),
  comparable({ id: "s2", address: "2 Beta St, Mount Colah", landSizeSqm: 500, salePrice: 1_240_000, weighting: "relied" }),
]);
if (allSmaller.some((p) => /larger land/.test(p))) ok("prompts notice when the subject has more land than every sale");
else fail(`prompts missed the land difference: ${JSON.stringify(allSmaller)}`);

check(
  "no prompts when every sale was ruled out",
  fileSpecificPrompts(subject, [comparable({ weighting: "not_comparable" })]),
  [],
);

// ── The nudge: a note, never a block ──────────────────────────────────────

check("nothing written yet is not nagged", reasoningNudge("", marked), null);

if (reasoningNudge("Comparable sales support the price.", marked)) ok("thin reasoning is flagged");
else fail("thin reasoning was not flagged");

check(
  "a full paragraph with sales marked is left alone",
  reasoningNudge(
    "Relied on 14 Smith St and 8 Jones Ave, both within 400m and sold in the last six weeks. This property has 120m² more land than either and a renovated kitchen, which is why I have set the range where I have.",
    marked,
  ),
  null,
);

if (
  reasoningNudge(
    "Relied on the three closest sales in the street, all of which are smaller on land than this one and none renovated to the same standard as here.",
    [comparable({}), comparable({})],
  )
)
  ok("unmarked sales are pointed out");
else fail("unmarked sales were not pointed out");

// ── On the market (29 Sep 2026) ────────────────────────────────────────────
//
// Same line as the sales, plus one of its own: an asking price is another
// agent's advertised figure. The draft may quote it; it must never compare it
// with the ESP or turn it into a number of its own.

function listing(over: Partial<MarketListing>): MarketListing {
  return {
    id: "l",
    address: "3 Oak St, Mount Colah",
    askingPrice: null,
    saleMethod: null,
    listedDate: null,
    bedrooms: null,
    bathrooms: null,
    carSpaces: null,
    landSizeSqm: null,
    internalAreaSqm: null,
    distanceM: null,
    propertyType: null,
    source: "report",
    weighting: null,
    agentNote: null,
    asAt: null,
    position: 0,
    ...over,
  };
}

const onMarket = {
  asAtLabel: "12 August 2026",
  listings: [
    listing({ id: "m1", address: "3 Oak St, Mount Colah", askingPrice: "$1.3m - $1.4m", weighting: "competition", agentNote: "same street, similar block" }),
    listing({ id: "m2", address: "9 Elm Rd, Mount Colah", askingPrice: "Contact agent", weighting: "considered" }),
    listing({ id: "m3", address: "1 Ash Cl, Mount Colah", askingPrice: "$2,100,000" }),
  ],
};

// KEPT FROM 29 SEP: an on-market asking price is never compared with the
// estimate as evidence. Held now against the new draft's market paragraph.
const withListings = drafted("on-market listings", draftInput({ listings: onMarket.listings }));
if (withListings) {
  console.log("\n--- draft with listings ---\n" + withListings.sections.market + "\n---\n");
  const compares = /(below|above|under|over|within|support|justif)\w*\s+(the|our|this|my)\s+(estimate|esp|price)/i;
  if (compares.test(withListings.sections.market) || /estimate/i.test(withListings.sections.market)) {
    fail("an asking price was compared with the estimate as evidence");
  } else ok("on-market asking prices are never compared with the estimate as evidence");
  for (const v of ["$1,300,000", "$1,400,000"]) {
    if (withListings.sections.market.includes(v)) fail("the estimate appears beside the asking prices");
  }
  if (withListings.sections.market.includes("“$2,100,000”")) ok("an advertised price is quoted exactly as published");
  else fail("an advertised price was not quoted as published");
}

check("days on market to the agreement date", daysOnMarket("2026-07-01", "2026-08-12"), 42);
check("no days on market without a listed date", daysOnMarket(null, "2026-08-12"), null);
check("no negative days on market", daysOnMarket("2026-09-01", "2026-08-12"), null);
check("heading uses the agreement date", onMarketHeading("2026-08-12"), "On the market as at 12 August 2026");
check(
  "heading says so when the agreement date is missing",
  onMarketHeading(null),
  "On the market as at the agency agreement date (not yet recorded)",
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED.`);
process.exit(failures === 0 ? 0 : 1);
