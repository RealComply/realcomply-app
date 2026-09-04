/**
 * Checks that Ask the Act's section index and retrieval still behave.
 *
 * FOR A DEVELOPER SESSION, NOT FOR ADAM. Run from the repo root:
 *
 *   npx tsx scripts/check-legislation-index.ts
 *
 * WHY THIS IS CHECKED IN. Every fault this has caught was invisible to
 * reading the code and obvious the moment it was run:
 *
 *   - Deduping sections by number alone silently deleted the Regulation's
 *     Schedule 1 rules of conduct, because they share numbers 1, 2, 3 with
 *     the Regulation's opening clauses.
 *   - A Division inside Schedule 2 overwrote the Schedule, so its rules were
 *     cited as "PSA Reg s 1" instead of "PSA Reg Sch 2 r 1" — a wrong
 *     citation, which is worse in a compliance tool than no answer at all.
 *   - The contents list named every Schedule before the body began, so the
 *     Regulation's own Parts were filed under Schedule 12.
 *   - The ACL prints "Schedule 2 The Australian Consumer Law" as a running
 *     header on all 140 pages, and every ACL section inherited it.
 *
 * Four faults, all in the boring plumbing, none of which a careful read
 * found. Add a case whenever a real question comes back wrong.
 */

import { allSections, findSections, isWeak } from "../src/lib/legislation/sections";

// A question, and the citation that must appear among the results.
// null means: these six sources genuinely cannot answer this, and the search
// must say so rather than offering near-misses.
const CASES: Array<[string, string | null]> = [
  ["what does the Act say about the estimated selling price?", "PSA Act s 72A"],
  ["how long is the cooling off period on an agency agreement?", "PSA Act s 59"],
  ["can I accept a gift from a solicitor I refer clients to?", "PSA Act s 53F"],
  ["what are the material facts I have to disclose to a buyer?", "PSA Reg s 60"],
  ["when do I have to do the trust account reconciliation?", "PSA Reg s 27"],
  ["what does s 72A say?", "PSA Act s 72A"],
  ["what are the penalties for underquoting?", "PSA Act s 73"],
  ["do I need a bidders record at auction?", "PSA Act s 68"],
  ["is misleading and deceptive conduct illegal?", "ACL s 18"],
  ["must an agent act honestly and fairly?", "PSA Reg Sch 1 r 3"],
  ["do I need a sales inspection report?", "PSA Reg Sch 2 r 3"],
  ["what has to be attached to the contract for sale?", "Sale of Land Reg s 4"],
  ["do I need professional indemnity insurance?", "PSA Act s 22"],
  ["how much notice to terminate a residential tenancy?", "RT Act s 82"],
  ["how many CPD hours do I need?", null],
  ["what is the capital of France?", null],
];

// Provisions this product cites constantly. If any of these stop being
// indexed, something in the chunker has broken, whatever the questions say.
const MUST_EXIST = [
  "PSA Act s 72A",
  "PSA Act s 73",
  "PSA Reg Sch 1 r 3",
  "PSA Reg Sch 2 r 3",
  "PSA Reg s 27",
  "ACL s 18",
  "RT Act s 82",
  "Sale of Land Reg s 4",
];

const CITATION = /^[A-Za-z ']+ (s \d{1,3}[A-Z]{0,3}|Sch \d+[A-Z]? r \d{1,3}[A-Z]{0,3})$/;

let failures = 0;
const fail = (message: string) => {
  console.log(`FAIL  ${message}`);
  failures += 1;
};

const sections = allSections();
console.log(`Indexed ${sections.length} sections across 6 sources.\n`);

if (sections.length < 1200) fail(`only ${sections.length} sections indexed — the chunker has lost something`);

const malformed = sections.filter((s) => !CITATION.test(s.citation));
if (malformed.length > 0) {
  fail(`${malformed.length} malformed citations, e.g. ${JSON.stringify(malformed[0].citation)}`);
}

for (const citation of MUST_EXIST) {
  if (!sections.some((s) => s.citation === citation)) fail(`${citation} is not in the index at all`);
}

for (const [question, expected] of CASES) {
  const hits = findSections(question);
  const weak = isWeak(hits);
  const top = hits[0]?.score ?? 0;

  if (expected === null) {
    if (weak) console.log(`ok    ${String(Math.round(top)).padStart(4)}  (correctly found nothing)  ${question}`);
    else fail(`"${question}" should have found nothing, but returned ${hits[0].section.citation} at ${Math.round(top)}`);
    continue;
  }

  const rank = hits.findIndex((h) => h.section.citation === expected);
  if (rank < 0) fail(`"${question}" did not return ${expected} (top: ${hits[0]?.section.citation ?? "nothing"})`);
  else if (weak) fail(`"${question}" found ${expected} but scored too low to be used (${Math.round(top)})`);
  else console.log(`ok    ${String(Math.round(top)).padStart(4)}  #${String(rank + 1).padEnd(2)} ${expected.padEnd(22)} ${question}`);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED.`);
process.exit(failures === 0 ? 0 : 1);
