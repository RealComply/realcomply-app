import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  differencesFrom,
  fileSpecificPrompts,
  similaritiesFrom,
  subjectAttributesFrom,
  withSubjectStrataLand,
  type Comparable,
} from "@/lib/data/comparables";
import { draftEspReasoning, draftProblems, type EspDraft } from "@/lib/data/esp-draft";
import { SOI_STRATA_LAND, soiContentFrom, soiDraft } from "@/lib/rules/soi";
import { STRATA_LAND_NOT_SHOWN, isStrataDwelling, strataLandHidden, withStrataLand } from "./strata-land";

// Units and townhouses (Adam, 10 Nov 2026): on a unit, apartment, townhouse,
// villa, duplex or terrace on strata, a land size over 500 m² is usually the
// whole strata site, not the lot. It is not shown or used, the listing's own
// or a sale's: not in the comparison, the drafted reasoning or the Statement
// of Information. Floor area is unchanged. Made-up properties only.

const unitRow = (over: Record<string, unknown> = {}) => ({
  address: "4/12 Made Up Rd, Sampleton",
  property_type: "Unit",
  is_strata: true,
  bedrooms: 2,
  bathrooms: 1,
  car_spaces: 1,
  land_size_sqm: 2400,
  internal_area_sqm: 85,
  attributes_confirmed_at: "2026-11-01T00:00:00Z",
  ...over,
});

let seq = 0;
function sale(over: Partial<Comparable>): Comparable {
  seq += 1;
  return {
    id: `s${seq}`,
    address: `${seq}/40 Sample St, Sampleton`,
    salePrice: 720_000,
    saleDate: "2026-09-10",
    bedrooms: 2,
    bathrooms: 1,
    carSpaces: 1,
    landSizeSqm: 1800,
    internalAreaSqm: 80,
    distanceM: 300,
    propertyType: "Unit",
    source: "report",
    weighting: null,
    agentNote: null,
    position: seq,
    mostComparable: false,
    mostComparableReason: null,
    comparisonFactors: [],
    ...over,
  };
}

describe("which listings the rule covers", () => {
  it("a unit, apartment, townhouse, villa, duplex or terrace, on strata", () => {
    for (const t of ["Unit", "Apartment", "Townhouse", "Town house", "Villa", "Duplex", "Terrace"]) {
      assert.equal(isStrataDwelling(t, true), true, t);
    }
  });

  it("not a house or land, and not a unit recorded as not on strata, or not answered", () => {
    assert.equal(isStrataDwelling("House", true), false);
    assert.equal(isStrataDwelling("Land", true), false);
    assert.equal(isStrataDwelling("Unit", false), false);
    assert.equal(isStrataDwelling("Unit", null), false);
    assert.equal(isStrataDwelling(null, true), false);
  });

  it("over 500 m² only: 500 itself is shown", () => {
    assert.equal(strataLandHidden(501, true), true);
    assert.equal(strataLandHidden(500, true), false);
    assert.equal(strataLandHidden(210, true), false);
    assert.equal(strataLandHidden(null, true), false);
    assert.equal(strataLandHidden(2400, false), false);
    assert.deepEqual(withStrataLand({ landSizeSqm: 650 }, true), { landSizeSqm: null, landSizeHidden: true });
    assert.deepEqual(withStrataLand(withStrataLand({ landSizeSqm: 650 }, true), true), { landSizeSqm: null, landSizeHidden: true });
  });
});

describe("the listing and its sales, as the card sees them", () => {
  it("the listing's own whole-site land is not shown or used; floor area is kept", () => {
    const s = subjectAttributesFrom(unitRow());
    assert.equal(s.landSizeSqm, null);
    assert.equal(s.landSizeHidden, true);
    assert.equal(s.internalAreaSqm, 85);
    assert.equal(s.bedrooms, 2);
  });

  it("a lot's own land size is kept, and so is a unit not on strata", () => {
    assert.equal(subjectAttributesFrom(unitRow({ land_size_sqm: 210 })).landSizeSqm, 210);
    assert.equal(subjectAttributesFrom(unitRow({ is_strata: false })).landSizeSqm, 2400);
    assert.equal(subjectAttributesFrom(unitRow({ property_type: "House" })).landSizeSqm, 2400);
  });

  it("the report's suggested whole-site figure isn't offered, so it can't be accepted", () => {
    const s = subjectAttributesFrom(unitRow({ land_size_sqm: null, bedrooms: null, bathrooms: null, car_spaces: null, internal_area_sqm: null, attribute_suggestions: { bedrooms: 2, landSizeSqm: 3100 } }));
    assert.equal(s.suggestions?.landSizeSqm, null);
    assert.equal(s.suggestions?.landSizeHidden, true);
    assert.equal(s.suggestions?.bedrooms, 2);
  });

  it("each sale's land over 500 m² is hidden on a strata listing, and only then", () => {
    const strata = subjectAttributesFrom(unitRow());
    const [big, small] = withSubjectStrataLand(strata, [sale({ landSizeSqm: 1800 }), sale({ landSizeSqm: 190 })]);
    assert.equal(big.landSizeSqm, null);
    assert.equal(big.landSizeHidden, true);
    assert.equal(small.landSizeSqm, 190);
    assert.equal(small.landSizeHidden, undefined);

    const house = subjectAttributesFrom(unitRow({ property_type: "House" }));
    assert.equal(withSubjectStrataLand(house, [sale({ landSizeSqm: 1800 })])[0].landSizeSqm, 1800);
  });

  it("the comparison leaves land out, and still compares floor area", () => {
    const subject = subjectAttributesFrom(unitRow());
    const [c] = withSubjectStrataLand(subject, [sale({ landSizeSqm: 1800, internalAreaSqm: 110 })]);
    const all = [...differencesFrom(subject, c), ...similaritiesFrom(subject, c)].join(" | ");
    assert.doesNotMatch(all, /land/i, all);
    assert.match(all, /internal area|floor/i, all);
    assert.ok(!fileSpecificPrompts(subject, [c]).some((p) => /land/i.test(p)));
  });

  it("the card's words for it", () => {
    assert.equal(STRATA_LAND_NOT_SHOWN, "Land size not shown (likely the whole strata site)");
  });
});

describe("Draft my reasoning on a strata listing", () => {
  const subject = subjectAttributesFrom(unitRow());
  const comparables = [
    sale({ address: "1/40 Sample St, Sampleton", salePrice: 700_000, landSizeSqm: 1800, internalAreaSqm: 80 }),
    sale({ address: "6/9 Example Ave, Sampleton", salePrice: 745_000, landSizeSqm: 2600, internalAreaSqm: 95 }),
    sale({ address: "2/3 Test Pl, Sampleton", salePrice: 730_000, landSizeSqm: 650, internalAreaSqm: 85 }),
  ];
  const input = {
    esp: { low: 700_000, high: 760_000 },
    subject,
    subjectType: "Unit",
    comparables,
    listings: [],
    agreementDate: "2026-11-20",
    noneOnMarketConfirmed: false,
  };

  it("mentions no land size at all, and doesn't call it missing", () => {
    const d = draftEspReasoning(input) as EspDraft;
    assert.equal(d.kind, "draft");
    assert.deepEqual(draftProblems(d, input), []);
    assert.doesNotMatch(d.text, /land/i, d.text);
    assert.doesNotMatch(d.text, /1,800|2,600|2,400|650m²/, d.text);
    assert.match(d.text, /internal area/, "floor area is still compared");
  });

  it("the same when a caller hands it the sales as read", () => {
    // The listing page hides them before the card drafts; the server's own
    // check of the draft (actions/compliance.ts) passes them as read.
    const asRead = draftEspReasoning({ ...input, comparables }) as EspDraft;
    const hidden = draftEspReasoning({ ...input, comparables: withSubjectStrataLand(subject, comparables) }) as EspDraft;
    assert.equal(asRead.text, hidden.text);
  });
});

describe("the Statement of Information on a strata listing", () => {
  const listing = [
    { address: "1/40 Sample St, Sampleton", salePrice: 700_000, saleDate: "2026-09-10", bedrooms: 2, bathrooms: 1, carSpaces: 1, landSizeSqm: 1800, internalAreaSqm: 80, mostComparable: true, mostComparableReason: "Same building." },
    { address: "2/3 Test Pl, Sampleton", salePrice: 730_000, saleDate: "2026-08-02", bedrooms: 2, bathrooms: 1, carSpaces: 1, landSizeSqm: 210, internalAreaSqm: 85, mostComparable: true, mostComparableReason: "Same street." },
  ];
  const base = { propertyType: "Unit", listing, firstEspFewerReason: "Only two in the building.", revisions: [], previous: null, register: { building: false, pest: false, strata: false } };

  it("leaves a whole-site land size out of the form, and says which", () => {
    const d = soiDraft({ ...base, strataDwelling: true });
    assert.equal(d.comparables[0].landSizeSqm, null);
    assert.equal(d.comparables[0].floorAreaSqm, 80);
    assert.equal(d.comparables[1].landSizeSqm, 210);
    assert.deepEqual(d.landNotShown, ["1/40 Sample St, Sampleton"]);

    const house = soiDraft({ ...base, propertyType: "House" });
    assert.equal(house.comparables[0].landSizeSqm, 1800);
    assert.deepEqual(house.landNotShown, []);
  });

  it("won't make a statement with one typed back in, and says why", () => {
    const form = (land: number | null) => ({
      propertyType: "unit",
      comparables: JSON.stringify([
        { address: "1/40 Sample St, Sampleton", bedrooms: 2, bathrooms: 1, parking: 1, landSizeSqm: land, floorAreaSqm: 80, soldPrice: 700000, soldOn: "2026-09-10", reasons: "Same building." },
      ]),
      fewerReason: "Only one in the building.",
      reports: [],
      checked: "on",
    });
    const fixed = { address: "4/12 Made Up Rd, Sampleton", area: "metro" as const, preparedOn: "2027-02-10", preparedBy: "Ana Agent (made up)", espRevisionNo: 0 };
    assert.deepEqual(soiContentFrom(form(1800), { ...fixed, strata: true }), { error: SOI_STRATA_LAND });
    assert.ok("content" in soiContentFrom(form(210), { ...fixed, strata: true }));
    assert.ok("content" in soiContentFrom(form(null), { ...fixed, strata: true }));
    assert.ok("content" in soiContentFrom(form(1800), fixed), "a house's land is its own");
  });
});
