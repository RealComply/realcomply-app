import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FEWER_THAN_THREE_MISSING, INFORMATION_USED_MISSING } from "./comparables-rules";
import {
  BAD_SALE,
  MOST_REASON_MISSING,
  NOT_BEFORE_MISSING,
  TOO_MANY_MOST,
  addressKey,
  newSincePrevious,
  previousAddresses,
  revisionComparablesFrom,
  revisionComparablesLines,
  revisionComparablesOf,
  revisionComparablesProblem,
  saleLine,
  type RevisionComparable,
} from "./revision-comparables";

const sale = (address: string, over: Partial<RevisionComparable> = {}): RevisionComparable => ({
  address,
  soldOn: "2026-10-01",
  soldPrice: 1250000,
  distanceM: 600,
  most: false,
  mostReason: null,
  factors: [],
  notBeforeReason: null,
  ...over,
});

describe("a revision's comparable sales, as the form sends them (Reg s12G(1)(a))", () => {
  it("keeps each sale, trimmed, with reasons only where they belong", () => {
    const parsed = revisionComparablesFrom(
      JSON.stringify([
        { address: " 14 Near Street (made up) ", soldOn: "2026-10-01", soldPrice: "$1,250,000", distanceM: 600, most: true, mostReason: " Same street. ", factors: ["layout", "vibes", "location"] },
        { address: "3 New Avenue (made up)", soldOn: "", soldPrice: "", most: false, mostReason: "ignored", factors: ["layout"], notBeforeReason: "Sold after." },
      ]),
    );
    assert.ok("entries" in parsed);
    if (!("entries" in parsed)) return;
    assert.deepEqual(parsed.entries[0], {
      address: "14 Near Street (made up)",
      soldOn: "2026-10-01",
      soldPrice: 1250000,
      distanceM: 600,
      most: true,
      mostReason: "Same street.",
      factors: ["location", "layout"],
      notBeforeReason: null,
    });
    assert.deepEqual(parsed.entries[1], { ...sale("3 New Avenue (made up)"), soldOn: null, soldPrice: null, distanceM: null, notBeforeReason: "Sold after." });
  });

  it("refuses a sale without an address, a bad date or price, and a fourth most comparable", () => {
    assert.deepEqual(revisionComparablesFrom(JSON.stringify([{ address: " " }])), { error: BAD_SALE });
    assert.deepEqual(revisionComparablesFrom(JSON.stringify([{ address: "1 A St", soldOn: "1/10/2026" }])), { error: BAD_SALE });
    assert.deepEqual(revisionComparablesFrom(JSON.stringify([{ address: "1 A St", soldPrice: "lots" }])), { error: BAD_SALE });
    assert.deepEqual(revisionComparablesFrom("not json"), { error: BAD_SALE });
    const four = [1, 2, 3, 4].map((i) => ({ address: `${i} A St`, most: true, mostReason: "Close." }));
    assert.deepEqual(revisionComparablesFrom(JSON.stringify(four)), { error: TOO_MANY_MOST });
    assert.deepEqual(revisionComparablesFrom(""), { entries: [] });
  });

  it("reads back what a revision kept, leaving out anything that isn't a sale", () => {
    assert.deepEqual(revisionComparablesOf([sale("1 A St"), "nonsense", { no: "address" }]), [sale("1 A St")]);
    assert.deepEqual(revisionComparablesOf(null), []);
  });
});

describe("what's new since the previous ESP (Reg s12G(1)(c))", () => {
  it("matches addresses whatever the case, spacing or punctuation", () => {
    assert.equal(addressKey("14 Near St., Hornsby (made up)"), addressKey("14 near st hornsby"));
    const entries = [sale("14 Near St, Hornsby"), sale("3 New Avenue, Hornsby")];
    assert.deepEqual(newSincePrevious(entries, ["14 NEAR ST HORNSBY"]).map((e) => e.address), ["3 New Avenue, Hornsby"]);
  });

  it("compares with the latest earlier revision that kept its own sales, else the first ESP's", () => {
    const first = ["1 First St"];
    assert.deepEqual(previousAddresses([], first), first);
    assert.deepEqual(previousAddresses([{ no: 1, comparables: [] }], first), first, "revision 1 kept none");
    assert.deepEqual(
      previousAddresses([{ no: 1, comparables: [sale("2 One St")] }, { no: 2, comparables: [sale("3 Two St")] }], first),
      ["3 Two St"],
    );
  });
});

describe("what saving a revision needs (Reg s12C, s12G)", () => {
  const three = [
    sale("1 A St", { most: true, mostReason: "Close." }),
    sale("2 B St", { most: true, mostReason: "Same layout." }),
    sale("3 C St", { most: true, mostReason: "Recent.", notBeforeReason: "Sold after the first ESP." }),
  ];
  const base = { previousAddresses: ["1 A St", "2 B St"], infoUsed: "Report (made up)", fewerReason: null, underReforms: true };

  it("passes with the 3, their reasons, the information used, and why the new one wasn't used before", () => {
    assert.equal(revisionComparablesProblem({ ...base, entries: three }), null);
  });

  it("asks for each missing part, under the 17 November rules", () => {
    assert.equal(revisionComparablesProblem({ ...base, entries: three, infoUsed: null }), INFORMATION_USED_MISSING);
    assert.equal(revisionComparablesProblem({ ...base, entries: three.slice(0, 2) }), FEWER_THAN_THREE_MISSING);
    assert.equal(revisionComparablesProblem({ ...base, entries: three.slice(0, 2), fewerReason: "Only 2 nearby." }), null);
    assert.equal(
      revisionComparablesProblem({ ...base, entries: [...three.slice(0, 2), { ...three[2], notBeforeReason: null }] }),
      NOT_BEFORE_MISSING,
    );
    assert.equal(revisionComparablesProblem({ ...base, entries: [{ ...three[0], mostReason: null }, ...three.slice(1)] }), MOST_REASON_MISSING);
  });

  it("before 17 November, only checks what was typed", () => {
    assert.equal(revisionComparablesProblem({ ...base, entries: [], infoUsed: null, underReforms: false }), null);
    assert.equal(
      revisionComparablesProblem({ ...base, entries: [{ ...three[0], mostReason: null }], underReforms: false }),
      MOST_REASON_MISSING,
    );
  });
});

describe("the record of a revision's comparable sales", () => {
  it("writes a line for each sale, the fewer-than-3 reason and the information used", () => {
    assert.equal(saleLine(sale("1 A St")), "1 A St, sold 1 October 2026 for $1,250,000");
    assert.equal(saleLine({ address: "1 A St", soldOn: null, soldPrice: null }), "1 A St");
    assert.deepEqual(
      revisionComparablesLines(2, {
        comparables: [
          sale("1 A St (made up)", { most: true, mostReason: "Same street.", factors: ["location", "layout"] }),
          sale("3 C St (made up)", { notBeforeReason: "It sold after the first ESP." }),
        ],
        comparablesInfoUsed: "Report (made up)",
        comparablesFewerReason: "Only 1 is close enough.",
      }),
      [
        "Revision 2, comparable sale taken into account: 1 A St (made up), sold 1 October 2026 for $1,250,000. One of the 3 most comparable: Same street. Comparison factors weighed: Location, layout.",
        "Revision 2, comparable sale taken into account: 3 C St (made up), sold 1 October 2026 for $1,250,000. Not used for the previous ESP because: It sold after the first ESP.",
        "Revision 2, fewer than 3 comparable: Only 1 is close enough.",
        "Revision 2, information used and where it came from: Report (made up)",
      ],
    );
    assert.deepEqual(revisionComparablesLines(1, {}), []);
  });
});
