/**
 * Checks the comparable-sales logic — the parts that produce words a licensee
 * will put their name to.
 *
 * FOR A DEVELOPER SESSION, NOT FOR ADAM. Run from the repo root:
 *
 *   npx tsx scripts/check-comparables.ts
 *
 * WHY THIS IS CHECKED IN. Two of these functions write text into a compliance
 * record, and the rule they have to obey is not a coding rule, it is a legal
 * one: the reasoning must be the agent's, and the software may arrange their
 * words but never add to them. A refactor that quietly made assembleReasoning
 * "helpful" — a linking adjective, a summarising clause, worst of all a price
 * — would look like an improvement in review and be a real problem in a file.
 * So the last case below asserts the absence of things, which is the only kind
 * of test that catches that.
 *
 * The difference lines are the other half: arithmetic that must not round a
 * 2m² difference into a claim, and must say nothing at all when it does not
 * know one side of the comparison.
 */

import {
  assembleReasoning,
  differenceLine,
  fileSpecificPrompts,
  hasSubjectDetail,
  reasoningNudge,
  type Comparable,
  type SubjectAttributes,
} from "../src/lib/data/comparables";

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

// ── Assembly: the agent's words, arranged ─────────────────────────────────

const marked: Comparable[] = [
  comparable({ id: "a", address: "14 Smith St, Mount Colah", weighting: "relied", agentNote: "closest in land size" }),
  comparable({ id: "b", address: "8 Jones Ave, Mount Colah", weighting: "relied", agentNote: "sold six weeks ago" }),
  comparable({ id: "c", address: "22 High St, Asquith", weighting: "not_comparable", agentNote: "renovated throughout" }),
  comparable({ id: "d", address: "5 Rose Pl, Mount Colah", weighting: "considered" }),
];

check(
  "nothing to assemble before the agent marks anything",
  assembleReasoning([comparable({}), comparable({})]),
  "",
);

const assembled = assembleReasoning(marked);
check(
  "assembles relied-on sales and the reasons the agent gave",
  assembled,
  [
    "Relied on 14 Smith St and 8 Jones Ave.",
    "14 Smith St — closest in land size",
    "8 Jones Ave — sold six weeks ago",
    "",
    "Did not treat 22 High St as comparable — renovated throughout",
  ].join("\n"),
);

// THE ONE THAT MATTERS. Everything in the output must be traceable to
// something a person typed or pressed. No price, no adjectives of quality, no
// conclusion about the estimate.
const forbidden = [
  /\$/, // never a figure
  /\bestimate[ds]?\b/i,
  /\btherefore\b/i,
  /\bcomparable overall\b/i,
  /\bsupports?\b/i,
  /\breasonable\b/i,
  /\bshould\b/i,
];
const offending = forbidden.filter((re) => re.test(assembled));
if (offending.length === 0) ok("assembled text adds no figure, judgement or conclusion");
else fail(`assembled text contains something the agent did not say: ${offending.map(String).join(", ")}`);

const noteless = assembleReasoning([
  comparable({ id: "e", address: "1 Alpha St, Berowra", weighting: "relied" }),
]);
check("a relied-on sale with no note still names the sale", noteless, "Relied on 1 Alpha St.");

// ── Prompts: drawn from this file ─────────────────────────────────────────

const prompts = fileSpecificPrompts(subject, marked);
if (prompts.some((p) => p.includes("$1,220,000"))) ok("prompts quote the actual price range on this file");
else fail(`prompts did not mention the file's own price range: ${JSON.stringify(prompts)}`);

if (prompts.some((p) => /larger land/.test(p))) ok("prompts notice the subject has more land than every sale");
else fail(`prompts missed the land difference: ${JSON.stringify(prompts)}`);

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

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED.`);
process.exit(failures === 0 ? 0 : 1);
