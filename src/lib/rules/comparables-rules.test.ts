import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COMPARISON_FACTORS,
  FEWER_THAN_THREE_MISSING,
  INFORMATION_USED_MISSING,
  comparablesMissing,
  comparablesPrompts,
  comparablesRecordFrom,
  comparablesRecordLines,
  comparablesRecordOf,
  comparablesRulesApply,
  espDeterminedOn,
  factorsFrom,
  factorsLine,
  monthsBefore,
  saleRecordLines,
  searchWindow,
  windowCheck,
} from "./comparables-rules";

const AS_AT = "2026-11-20";

describe("the search area (Reg s12D(2) and (4))", () => {
  it("is 2 km and 6 months (12 for earlier sales) in the metropolitan area, 5 km and 18 months outside it", () => {
    assert.deepEqual(searchWindow("metro"), { radiusM: 2000, recentMonths: 6, earlierMonths: 12 });
    assert.deepEqual(searchWindow("non_metro"), { radiusM: 5000, recentMonths: 18, earlierMonths: null });
  });

  it("counts months back on the calendar", () => {
    assert.equal(monthsBefore("2026-11-20", 6), "2026-05-20");
    assert.equal(monthsBefore("2026-11-20", 12), "2025-11-20");
    assert.equal(monthsBefore("2026-08-31", 6), "2026-02-28", "no 31 February: the month's last day");
    assert.equal(monthsBefore("2027-01-15", 18), "2025-07-15");
  });

  it("counts from when the ESP was worked out: given to the vendor, else signed, else today", () => {
    assert.equal(espDeterminedOn({ espGivenOn: "2026-11-18", agreementDate: "2026-11-19", today: AS_AT }), "2026-11-18");
    assert.equal(espDeterminedOn({ espGivenOn: null, agreementDate: "2026-11-19T00:00:00Z", today: AS_AT }), "2026-11-19");
    assert.equal(espDeterminedOn({ today: AS_AT }), AS_AT);
  });

  it("places each sale: recent, earlier, outside, or not known", () => {
    const at = (distanceM: number | null, saleDate: string | null, kind: "metro" | "non_metro" = "metro") =>
      windowCheck({ distanceM, saleDate }, kind, AS_AT);
    assert.deepEqual(at(1200, "2026-09-01"), { place: "recent", label: "Recent sale: within 2 km and 6 months." });
    assert.equal(at(2000, "2026-05-20").place, "recent", "on the line counts");
    assert.equal(at(800, "2026-02-01").place, "earlier");
    assert.match(at(800, "2026-02-01").label, /counts only if fewer than 3 recent sales are comparable \(Reg s12D\(4\)\)/);
    assert.deepEqual(at(3100, "2026-09-01"), { place: "outside", label: "Outside the search area: 3.1 km away (2 km here)." });
    assert.deepEqual(at(500, "2025-10-01"), { place: "outside", label: "Outside the search area: sold more than 12 months before." });
    assert.deepEqual(at(500, "2026-11-25"), { place: "outside", label: "Sold after the ESP was worked out." });
    assert.deepEqual(at(null, "2026-09-01"), { place: "unknown", label: "Distance not shown: check it's within 2 km." });
    assert.equal(at(null, "2025-01-01").place, "outside", "too long ago, whatever the distance");
    assert.equal(at(400, null).place, "unknown");
    // Outside the metropolitan area: 5 km and 18 months, and no "earlier" sales.
    assert.equal(at(4500, "2025-07-01", "non_metro").place, "recent");
    assert.equal(at(5200, "2026-09-01", "non_metro").place, "outside");
    assert.equal(at(1000, "2025-04-01", "non_metro").place, "outside");
  });
});

describe("the comparison factors (Reg s12D(3))", () => {
  it("are the Regulation's 15, (a) to (o)", () => {
    assert.equal(COMPARISON_FACTORS.length, 15);
    assert.equal(COMPARISON_FACTORS[0].key, "date_sold");
    assert.equal(COMPARISON_FACTORS[14].key, "zoning_frontage");
  });

  it("keeps only known ones, once each, in the Regulation's order", () => {
    assert.deepEqual(factorsFrom(["layout", "date_sold", "vibes", "layout", 3]), ["date_sold", "layout"]);
    assert.equal(factorsLine(["layout", "date_sold", "land_size"]), "Date sold, layout, land size");
    assert.equal(factorsLine(["layout", "beds_baths"]), "Layout, bedrooms and bathrooms");
    assert.equal(factorsLine(["location"]), "Location");
    assert.equal(factorsLine([]), "");
  });
});

describe("prompts about the marks (Reg s12D(4) and (5))", () => {
  const sale = (address: string, distanceM: number, saleDate: string, weighting: string, mostComparable = false) => ({
    address,
    distanceM,
    saleDate,
    weighting,
    mostComparable,
  });

  it("says when a most comparable sale is outside the search area", () => {
    const out = comparablesPrompts([sale("1 Far St (made up)", 3500, "2026-10-01", "relied", true)], "metro", AS_AT);
    assert.deepEqual(out, [
      "1 Far St (made up) is marked one of the 3 most comparable but is outside the search area. Outside the search area: 3.5 km away (2 km here).",
    ]);
  });

  it("says a recent sale counts ahead of an earlier one (s12D(5)(a))", () => {
    const out = comparablesPrompts(
      [sale("2 Old St (made up)", 900, "2026-02-01", "relied", true), sale("3 New St (made up)", 900, "2026-10-01", "relied")],
      "metro",
      AS_AT,
    );
    assert.equal(out.length, 1);
    assert.match(out[0], /^2 Old St \(made up\) is an earlier sale .* 3 New St \(made up\) is a recent sale you relied on\. A recent sale counts as more comparable than an earlier one \(Reg s12D\(5\)\(a\)\)\.$/);
  });

  it("says earlier sales count only with fewer than 3 recent ones (s12D(4))", () => {
    const recent = [1, 2, 3].map((i) => sale(`${i} Recent St (made up)`, 500, "2026-10-01", "relied"));
    const out = comparablesPrompts([...recent, sale("9 Earlier St (made up)", 500, "2026-03-01", "relied")], "metro", AS_AT);
    assert.deepEqual(out, ["You relied on 3 recent sales. Earlier sales count only when fewer than 3 recent ones are comparable (Reg s12D(4))."]);
    assert.deepEqual(comparablesPrompts(recent, "metro", AS_AT), [], "nothing to say");
  });
});

describe("fewer than 3, and the information used (Reg s12C(2), s12F)", () => {
  it("is kept trimmed, and read back", () => {
    const r = comparablesRecordFrom({ informationUsed: "  CoreLogic report (made up)  ", fewerThanThreeReason: "" });
    assert.deepEqual(r, { informationUsed: "CoreLogic report (made up)", fewerThanThreeReason: null });
    assert.deepEqual(comparablesRecordOf({ comparablesRecord: r }), r);
    assert.deepEqual(comparablesRecordOf(null), { informationUsed: null, fewerThanThreeReason: null });
  });

  it("asks for the 3 or the reason, and the information used, at Mark done", () => {
    const none = { informationUsed: null, fewerThanThreeReason: null };
    assert.deepEqual(comparablesMissing({ mostComparableCount: 1, record: none }), [FEWER_THAN_THREE_MISSING, INFORMATION_USED_MISSING]);
    assert.deepEqual(comparablesMissing({ mostComparableCount: 3, record: { ...none, informationUsed: "Report" } }), []);
    assert.deepEqual(
      comparablesMissing({ mostComparableCount: 2, record: { informationUsed: "Report", fewerThanThreeReason: "Only 2 sales nearby." } }),
      [],
    );
  });

  it("applies to agreements signed from 17 November, or unsigned once it's here", () => {
    assert.equal(comparablesRulesApply("2026-11-10", new Date("2026-11-20T00:00:00+11:00")), false);
    assert.equal(comparablesRulesApply("2026-11-17", new Date("2026-11-20T00:00:00+11:00")), true);
    assert.equal(comparablesRulesApply(null, new Date("2026-11-09T12:00:00+11:00")), false);
    assert.equal(comparablesRulesApply(null, new Date("2026-11-20T12:00:00+11:00")), true);
  });

  it("writes it for the record", () => {
    assert.deepEqual(
      saleRecordLines(
        {
          address: "1 Near St (made up)",
          distanceM: 600,
          saleDate: "2026-10-01",
          weighting: "relied",
          mostComparable: true,
          mostComparableReason: "Same street and layout.",
          comparisonFactors: ["location", "layout"],
        },
        "metro",
        AS_AT,
      ),
      [
        "Recent sale: within 2 km and 6 months.",
        "One of the 3 most comparable: Same street and layout.",
        "Comparison factors weighed: Location, layout.",
      ],
    );
    assert.deepEqual(comparablesRecordLines({ informationUsed: "Report (made up)", fewerThanThreeReason: "Only 2 nearby." }, 2), [
      "Marked as the most comparable: 2 of 3.",
      "Fewer than 3 comparable: Only 2 nearby.",
      "Information used and where it came from: Report (made up)",
    ]);
  });
});
