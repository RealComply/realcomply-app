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
 * words but never add to them. A refactor that quietly made buildReasoningDraft
 * "helpful" — a linking adjective, a summarising clause, worst of all a price
 * it worked out itself — would look like an improvement in review and be a real
 * problem in a file. So the cases below assert the ABSENCE of things, which is
 * the only kind of test that catches that.
 *
 * The difference lines are the other half: arithmetic that must not round a
 * 2m² difference into a claim, and must say nothing at all when it does not
 * know one side of the comparison.
 */

import {
  buildReasoningDraft,
  differenceLine,
  fileSpecificPrompts,
  hasSubjectDetail,
  reasoningNudge,
  similaritiesFrom,
  suburbOf,
  type Comparable,
  type SubjectAttributes,
} from "../src/lib/data/comparables";

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

// ── The draft: the agent's words, arranged ────────────────────────────────

const marked: Comparable[] = [
  comparable({ id: "a", address: "14 Smith St, Mount Colah", salePrice: 1_220_000, weighting: "relied", agentNote: "closest on land and presentation" }),
  comparable({ id: "b", address: "8 Jones Ave, Mount Colah", salePrice: 1_385_000, bedrooms: 4, bathrooms: 2, carSpaces: 2, landSizeSqm: 610, internalAreaSqm: 205, weighting: "relied" }),
  comparable({ id: "c", address: "22 High St, Asquith", salePrice: 1_560_000, weighting: "not_comparable", agentNote: "renovated throughout" }),
  comparable({ id: "d", address: "5 Rose Pl, Mount Colah", weighting: "considered" }),
];

check(
  "nothing to draft before the agent marks anything",
  buildReasoningDraft(subject, [comparable({}), comparable({})], ESP),
  "",
);

const drafted = buildReasoningDraft(subject, marked, ESP);
console.log("\n--- draft as an agent would see it ---\n" + drafted + "\n---\n");

for (const expected of [
  "Estimated selling price recorded in the agency agreement: $1,300,000 to $1,400,000.",
  "Relied on 14 Smith St and 8 Jones Ave, which sold between $1,220,000 and $1,385,000.",
  "Closest on land and presentation.",
  "8 Jones Ave — same bedrooms, bathrooms, car spaces, land and internal area.",
  "Also looked at 5 Rose Pl without treating it as decisive.",
  "Did not treat 22 High St as comparable — renovated throughout.",
]) {
  if (drafted.includes(expected)) ok(`draft contains: ${expected.slice(0, 52)}…`);
  else fail(`draft is missing: ${expected}`);
}

// DRAFT B ENDS ON A FACT, not an unfinished sentence. Adam chose this shape on
// 7 Sep 2026 so the agent can accept it and add their own view; a trailing
// "because" would be the other option he rejected.
if (/because\s*$/.test(drafted)) fail("draft ends mid-sentence — that was variant A, which was not chosen");
else ok("draft ends on a complete sentence");

// THE ONE THAT MATTERS. Everything in the output must be traceable to a figure
// in the report, arithmetic, or something the agent typed or pressed. No
// conclusion about the estimate, and no price this software worked out.
const forbidden: Array<[RegExp, string]> = [
  [/\btherefore\b/i, "a conclusion"],
  [/\breasonable\b/i, "an assertion the estimate is reasonable"],
  [/\bcomparable overall\b/i, "an overall judgement"],
  [/\bsupports?\s+(the|this)\s+(price|estimate)\b/i, "an assertion the sales support the price"],
  [/\bshould\b/i, "advice"],
  [/\bI (would|recommend|suggest)\b/i, "words put in the agent's mouth"],
];
const offending = forbidden.filter(([re]) => re.test(drafted));
if (offending.length === 0) ok("draft adds no judgement, advice or conclusion");
else fail(`draft contains ${offending.map(([, why]) => why).join(", ")}`);

// Only two kinds of figure may appear: the ESP the agent recorded, and prices
// printed in the report. Anything else means the software invented a number.
const allowed = new Set(["$1,300,000", "$1,400,000", "$1,220,000", "$1,385,000"]);
const figures = drafted.match(/\$[\d,]+/g) ?? [];
const invented = figures.filter((f) => !allowed.has(f));
if (invented.length === 0) ok("every dollar figure is one the agent or the report supplied");
else fail(`draft invented a figure: ${invented.join(", ")}`);

check(
  "no ESP line when the agreement has no figures on file",
  buildReasoningDraft(subject, [marked[0]], { low: null, high: null }).startsWith("Relied on"),
  true,
);

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

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED.`);
process.exit(failures === 0 ? 0 : 1);
