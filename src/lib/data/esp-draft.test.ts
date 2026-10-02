import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Comparable, SubjectAttributes } from "./comparables";
import type { MarketListing } from "./market-listings";
import { draftEspReasoning, draftProblems, type EspDraft, type EspDraftInput } from "./esp-draft";

// A Mount Colah house, agreement signed 12 August 2026, ESP $1.3m–$1.4m.

const subject: SubjectAttributes = {
  bedrooms: 4,
  bathrooms: 2,
  carSpaces: 2,
  landSizeSqm: 600,
  internalAreaSqm: 210,
  conditionNote: null,
  address: "42 Landra Ave, Mount Colah",
  addressSuburb: "mount colah",
  propertyType: "House",
  suggestions: null,
  confirmedAt: "2026-09-07T00:00:00Z",
};

let seq = 0;
function sale(over: Partial<Comparable>): Comparable {
  seq += 1;
  return {
    id: `s${seq}`,
    address: `${seq} Smith St, Mount Colah`,
    salePrice: 1_350_000,
    saleDate: "2026-06-14",
    bedrooms: 4,
    bathrooms: 2,
    carSpaces: 2,
    landSizeSqm: 600,
    internalAreaSqm: 210,
    distanceM: 400,
    propertyType: "House",
    source: "report",
    weighting: null,
    agentNote: null,
    position: seq,
    ...over,
  };
}

function listing(over: Partial<MarketListing>): MarketListing {
  return {
    id: "m1",
    address: "3 Oak St, Mount Colah",
    askingPrice: "$1.3m - $1.4m",
    saleMethod: null,
    listedDate: "2026-07-22",
    bedrooms: 4,
    bathrooms: 2,
    carSpaces: 2,
    landSizeSqm: 610,
    internalAreaSqm: null,
    distanceM: 300,
    propertyType: "House",
    source: "report",
    weighting: null,
    agentNote: null,
    asAt: null,
    position: 0,
    ...over,
  };
}

function input(over: Partial<EspDraftInput> = {}): EspDraftInput {
  return {
    esp: { low: 1_300_000, high: 1_400_000 },
    subject,
    subjectType: "House",
    comparables: [
      sale({ address: "14 Smith St, Mount Colah", salePrice: 1_350_000 }),
      sale({ address: "8 Jones Ave, Mount Colah", salePrice: 1_385_000, saleDate: "2026-07-02", landSizeSqm: 640 }),
      sale({ address: "5 Rose Pl, Mount Colah", salePrice: 1_310_000, saleDate: "2026-05-20", bedrooms: 3 }),
      sale({ address: "22 High St, Asquith", salePrice: 1_520_000, saleDate: "2025-12-01", landSizeSqm: 820, distanceM: 2100 }),
    ],
    listings: [listing({ weighting: "competition" })],
    agreementDate: "2026-08-12",
    noneOnMarketConfirmed: false,
    ...over,
  };
}

/** Draft it, and hold every draft to limits (a)–(f) whatever else the test checks. */
function draft(i: EspDraftInput): EspDraft {
  const result = draftEspReasoning(i);
  assert.equal(result.kind, "draft", result.kind === "unavailable" ? result.message : "");
  const d = result as EspDraft;
  assert.deepEqual(draftProblems(d, i), [], d.text);
  return d;
}

describe("Draft my reasoning", () => {
  it("no marks: draws on the closest sales by type, size, location and date, and says why", () => {
    const d = draft(input());

    assert.equal(d.drawnOn.length, 3);
    assert.ok(!d.text.includes("22 High St sold for"), "the far, older, bigger sale is not drawn on");
    assert.match(d.sections.sales, /closest to this property in type, size, location and date/);
    assert.match(d.sections.sales, /22 High St \(\$1,520,000, December 2025\) is in a different suburb, has 220m² more land/);
    assert.equal(d.evidence, "supports");
    assert.match(d.sections.estimate, /recorded in the agency agreement, is \$1,300,000 to \$1,400,000/);
    assert.match(d.sections.estimate, /I consider it is supported by them/);
    assert.equal(d.warning, null);
    assert.match(d.text, /^The sales I've drawn on most are /, "first person, as the agent");
  });

  it("with marks: relies only on sales marked Relied on, and keeps the agent's notes as theirs", () => {
    const comparables = [
      sale({ id: "a", address: "14 Smith St, Mount Colah", salePrice: 1_350_000, weighting: "relied", agentNote: "closest on land and presentation" }),
      sale({ id: "b", address: "8 Jones Ave, Mount Colah", salePrice: 1_390_000, weighting: "relied" }),
      sale({ id: "c", address: "5 Rose Pl, Mount Colah", salePrice: 1_310_000, weighting: "considered" }),
      sale({ id: "d", address: "9 Ash St, Mount Colah", salePrice: 1_330_000 }),
    ];
    const d = draft(input({ comparables }));

    assert.deepEqual(d.drawnOn, ["a", "b"], "only the Relied on sales, even though 9 Ash St is just as alike");
    assert.match(d.sections.sales, /^The sales I relied on are 14 Smith St and 8 Jones Ave\./);
    assert.match(d.sections.sales, /My note: “closest on land and presentation”/);
    assert.match(d.sections.sales, /5 Rose Pl .*I considered it but didn't rely on it/);
    assert.match(d.sections.sales, /9 Ash St .*I didn't mark it as relied on/);
  });

  it("sales mostly above the estimate: says so, doesn't argue support, and warns the agent", () => {
    const comparables = [
      sale({ salePrice: 1_450_000 }),
      sale({ salePrice: 1_480_000 }),
      sale({ salePrice: 1_390_000 }),
    ];
    const d = draft(input({ comparables }));

    assert.equal(d.evidence, "mostly_above");
    assert.match(d.sections.estimate, /two above it/);
    assert.match(d.sections.estimate, /two above it.*Most of these sales sold above my estimate, so on this evidence they don.t support it/);
    assert.doesNotMatch(d.text, /I consider it is supported/);
    assert.match(d.warning ?? "", /sold above your estimated selling price/);
  });

  it("sales mostly below the estimate: same honesty the other way", () => {
    const comparables = [sale({ salePrice: 1_150_000 }), sale({ salePrice: 1_200_000 }), sale({ salePrice: 1_320_000 })];
    const d = draft(input({ comparables }));

    assert.equal(d.evidence, "mostly_below");
    assert.match(d.sections.estimate, /Most of these sales sold below my estimate/);
    assert.match(d.warning ?? "", /sold below your estimated selling price/);
  });

  it("fewer than two sales: too few to judge, said plainly, with a note to the agent", () => {
    const d = draft(input({ comparables: [sale({ address: "14 Smith St, Mount Colah", salePrice: 1_350_000 })] }));

    assert.equal(d.evidence, "too_few");
    assert.match(d.sections.estimate, /only one priced sale, at \$1,350,000, which is too few sales to judge the estimate on sales alone/);
    assert.doesNotMatch(d.text, /\bsupported\b/);
    assert.match(d.warning ?? "", /aren't enough comparable sales/);

    const none = draft(input({ comparables: [] }));
    assert.equal(none.evidence, "too_few");
    assert.match(none.sections.sales, /no sales with a sale price/);
  });

  it("no estimate recorded: no draft — the agency agreement is needed first", () => {
    const result = draftEspReasoning(input({ esp: { low: null, high: null } }));

    assert.equal(result.kind, "unavailable");
    assert.equal(result.kind === "unavailable" && result.reason, "no_estimate");
    assert.match(result.kind === "unavailable" ? result.message : "", /agency agreement is needed first/);
  });

  it("attributes not confirmed: no draft, and says what is missing rather than guessing", () => {
    const bare = { ...subject, bedrooms: null, bathrooms: null, carSpaces: null, landSizeSqm: null, internalAreaSqm: null, confirmedAt: null };

    const onlySuggested = draftEspReasoning(input({ subject: { ...bare, suggestions: { bedrooms: 4, bathrooms: 2 } } }));
    assert.equal(onlySuggested.kind === "unavailable" && onlySuggested.reason, "attributes_unconfirmed");
    assert.match(
      onlySuggested.kind === "unavailable" ? onlySuggested.message : "",
      /aren't confirmed yet.*nothing is used until you accept them with "Use these details"/,
      "the report's suggested figures are never used unaccepted",
    );

    const nothing = draftEspReasoning(input({ subject: bare }));
    assert.match(
      nothing.kind === "unavailable" ? nothing.message : "",
      /aren't recorded yet \(bedrooms, bathrooms, car spaces, land size and internal area\)\. Add them in Edit listing details/,
    );

    // Typed at listing set-up (never stamped confirmedAt) is the agent's own figure, and drafts.
    const typedAtSetup = draft(input({ subject: { ...subject, confirmedAt: null, internalAreaSqm: null } }));
    assert.match(typedAtSetup.sections.sales, /doesn't record the listing's internal area, so I haven't compared the sales on it/);
    assert.doesNotMatch(typedAtSetup.sections.sales, /internal area\./, "no comparison on a figure the file doesn't have");
  });

  it("on-market listings: described as published, never set against the estimate", () => {
    const d = draft(input({ listings: [listing({ weighting: "competition", agentNote: "same street" }), listing({ id: "m2", address: "9 Elm Rd, Mount Colah", askingPrice: null, saleMethod: "Auction", listedDate: null })] }));

    assert.match(d.sections.market, /On the market at the agreement date \(12 August 2026\): 3 Oak St, advertised as “\$1\.3m - \$1\.4m”, listed for 21 days, which I treat as direct competition/);
    assert.match(d.sections.market, /9 Elm Rd, for sale by auction with no price advertised, days listed not recorded/);
    assert.doesNotMatch(d.sections.market, /estimate/i);
  });

  it("no on-market listings recorded: says none are recorded, claims nothing more", () => {
    const d = draft(input({ listings: [] }));
    assert.equal(d.sections.market, "No properties on the market at the agreement date (12 August 2026) are recorded in this file.");
  });

  it('"none" confirmed: states the agent checked and there were none', () => {
    const d = draft(input({ listings: [], noneOnMarketConfirmed: true }));
    assert.equal(
      d.sections.market,
      "I checked what was on the market at the agreement date (12 August 2026), and there were no comparable properties for sale.",
    );
  });

  it("never contains guarantee words, and the checker would catch them", () => {
    const d = draft(input());
    assert.doesNotMatch(d.text, /\b(compliant|correct|accurate)\b/i);

    const tampered = { ...d, text: `${d.text} The estimate is accurate.` };
    assert.ok(draftProblems(tampered, input()).some((p) => p.startsWith("(e)")));
  });

  it("the checker catches a different estimate and an asking price used as support", () => {
    const d = draft(input());
    const otherEstimate = { ...d, sections: { ...d.sections, estimate: d.sections.estimate.replace("$1,400,000", "$1,450,000") } };
    assert.ok(draftProblems(otherEstimate, input()).some((p) => p.startsWith("(a)")));

    const askingAsSupport = { ...d, sections: { ...d.sections, market: `${d.sections.market} That supports my estimate.` } };
    assert.ok(draftProblems(askingAsSupport, input()).some((p) => p.startsWith("(c)")));
  });
});
