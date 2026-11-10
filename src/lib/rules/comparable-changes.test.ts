import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildComplianceRecordPdf } from "@/lib/pdf/compliance-record";
import { allItemsInRuleset } from "@/lib/rules/nsw-sales";
import { pdfText } from "@/lib/testing/pdf-text";
import { draftEspReasoning, type EspDraft } from "@/lib/data/esp-draft";
import { withChangeLines, type Comparable, type SubjectAttributes } from "@/lib/data/comparables";
import type { Property } from "@/lib/types";
import { DETAIL_FIELDS, changeLinesBySale, changePhrase, parseDetail, type ComparableChange } from "./comparable-changes";

// Edit a comparable's details (Adam, 10 Nov 2026; 0123): bedrooms, bathrooms,
// parking, land size, floor area, sold price and sale date. What was read
// from the report is kept, and the record says "Changed by [name], [date]:
// land size 650 m² (read from report) to 210 m²". Made-up data only.

const TODAY = "2026-11-10";
const change = (over: Partial<ComparableChange>): ComparableChange => ({
  comparableId: "c1",
  field: "land_size_sqm",
  oldValue: "650.00",
  newValue: "210.00",
  wasFromReport: true,
  changedByName: "Ana Agent",
  changedAt: "2026-11-10T03:00:00Z",
  ...over,
});

describe("what can be changed", () => {
  it("the seven figures, in this order", () => {
    assert.deepEqual(
      DETAIL_FIELDS.map((f) => f.label),
      ["Bedrooms", "Bathrooms", "Parking", "Land size, m²", "Floor area, m²", "Sold price", "Sale date"],
    );
  });

  it("reads what's typed as it is stored, and empty as none", () => {
    assert.deepEqual(parseDetail("bedrooms", " 3 ", TODAY), { value: 3 });
    assert.deepEqual(parseDetail("landSizeSqm", "210", TODAY), { value: 210 });
    assert.deepEqual(parseDetail("landSizeSqm", "1,250.5 m²", TODAY), { value: 1250.5 });
    assert.deepEqual(parseDetail("salePrice", "$1,250,000", TODAY), { value: 1_250_000 });
    assert.deepEqual(parseDetail("saleDate", "2026-10-01", TODAY), { value: "2026-10-01" });
    assert.deepEqual(parseDetail("carSpaces", "", TODAY), { value: null });
    assert.deepEqual(parseDetail("carSpaces", "0", TODAY), { value: 0 });
  });

  it("says plainly what's wrong with a figure it can't use", () => {
    assert.deepEqual(parseDetail("bedrooms", "2.5", TODAY), { error: "Give the bedrooms as a whole number, 0 to 50." });
    assert.deepEqual(parseDetail("bathrooms", "two", TODAY), { error: "Give the bathrooms as a number." });
    assert.deepEqual(parseDetail("landSizeSqm", "-5", TODAY), { error: "Give the land size as a number." });
    assert.deepEqual(parseDetail("internalAreaSqm", "0", TODAY), { error: "The floor area can't be 0. Leave it empty if it isn't known." });
    assert.deepEqual(parseDetail("saleDate", "2026-02-30", TODAY), { error: "Give the sale date as a real day." });
    assert.deepEqual(parseDetail("saleDate", "2026-11-11", TODAY), { error: "The sale date can't be after today." });
  });
});

describe("how a change is said", () => {
  it("Adam's example, word for word", () => {
    assert.equal(changePhrase(change({})), "land size 650 m² (read from report) to 210 m²");
    assert.deepEqual(changeLinesBySale([change({})]).get("c1"), [
      "Changed by Ana Agent, 10 November 2026: land size 650 m² (read from report) to 210 m²",
    ]);
  });

  it("every figure in its own words", () => {
    const said = (field: string, oldValue: string | null, newValue: string | null, wasFromReport = true) =>
      changePhrase({ field, oldValue, newValue, wasFromReport });
    assert.equal(said("bedrooms", "3", "2"), "bedrooms 3 (read from report) to 2");
    assert.equal(said("car_spaces", "1", null), "parking 1 (read from report) to none");
    assert.equal(said("internal_area_sqm", null, "85.00"), "floor area none in the report to 85 m²");
    assert.equal(said("sale_price", "700000.00", "705000.00"), "sold price $700,000 (read from report) to $705,000");
    assert.equal(said("sale_date", "2026-09-10", "2026-09-12"), "sale date 10 September 2026 (read from report) to 12 September 2026");
    assert.equal(said("land_size_sqm", "210.00", "205.50", false), "land size 210 m² to 205.5 m²", "changed again, or typed by the agent");
  });

  it("one line per save, the figures in the form's order, oldest save first", () => {
    const lines = changeLinesBySale([
      change({ field: "sale_price", oldValue: "700000.00", newValue: "705000.00", changedAt: "2026-11-12T01:00:00Z", changedByName: "Lou Licensee" }),
      change({}),
      change({ field: "bedrooms", oldValue: "3", newValue: "2", changedAt: "2026-11-12T01:00:00Z", changedByName: "Lou Licensee" }),
      change({ comparableId: "c2", field: "bathrooms", oldValue: "1", newValue: "2", wasFromReport: false }),
    ]);
    assert.deepEqual(lines.get("c1"), [
      "Changed by Ana Agent, 10 November 2026: land size 650 m² (read from report) to 210 m²",
      "Changed by Lou Licensee, 12 November 2026: bedrooms 3 (read from report) to 2; sold price $700,000 (read from report) to $705,000",
    ]);
    assert.deepEqual(lines.get("c2"), ["Changed by Ana Agent, 10 November 2026: bathrooms 1 to 2"]);
  });

  it("the date is Sydney's: a change at 11:30 pm on the 10th is the 10th", () => {
    assert.match(changeLinesBySale([change({ changedAt: "2026-11-10T12:30:00Z" })]).get("c1")![0], /, 10 November 2026:/);
    assert.match(changeLinesBySale([change({ changedAt: "2026-11-10T13:30:00Z" })]).get("c1")![0], /, 11 November 2026:/);
  });

  it("no internal ids, and nothing but plain text", () => {
    const line = changeLinesBySale([change({})]).get("c1")![0];
    assert.doesNotMatch(line, /c1|[0-9a-f]{8}-/);
    assert.doesNotMatch(line, /[<>]/);
  });
});

describe("on the compliance record, and so the audit pack", () => {
  it("each sale's changes are printed under it", async () => {
    const pdf = await buildComplianceRecordPdf({
      property: { id: "p1", address: "4/12 Made Up Road, Sampleton", stage: 1, created_at: "2026-11-01" } as unknown as Property,
      agencyName: "Made Up Realty",
      agentName: "Ana Agent",
      logo: null,
      items: allItemsInRuleset().filter((i) => i.key === "a4c"),
      byKey: {},
      espReasoning: null,
      comparables: [
        {
          address: "1/40 Sample Street (made up)",
          salePrice: 705_000,
          saleDate: "2026-09-12",
          weighting: "relied",
          agentNote: null,
          changeLines: changeLinesBySale([change({})]).get("c1"),
        },
      ],
      signatures: { agent: null, licensee: null },
      rulesetVersion: "test",
      preparedFor: "test",
      generatedAt: new Date("2026-11-26T00:00:00Z"),
    });
    const text = pdfText(pdf).replace(/\s+/g, " ");
    assert.ok(text.includes("Changed by Ana Agent, 10 November 2026: land size 650 m"), text);
    assert.ok(text.includes("(read from report) to 210 m"), text);
  });
});

describe("the edited figures are used from then on", () => {
  it("in the drafted reasoning, with the change on the sale", () => {
    const subject: SubjectAttributes = {
      bedrooms: 2, bathrooms: 1, carSpaces: 1, landSizeSqm: null, internalAreaSqm: 85, conditionNote: null,
      address: "4/12 Made Up Road, Sampleton", addressSuburb: "sampleton", propertyType: "Unit",
      suggestions: null, confirmedAt: "2026-11-01",
    };
    const edited: Comparable = {
      id: "c1", address: "1/40 Sample Street, Sampleton", salePrice: 705_000, saleDate: "2026-09-12", bedrooms: 2,
      bathrooms: 1, carSpaces: 1, landSizeSqm: 210, internalAreaSqm: 80, distanceM: 300, propertyType: "Unit",
      source: "report", weighting: "relied", agentNote: null, position: 1, mostComparable: false,
      mostComparableReason: null, comparisonFactors: [],
    };
    const [withLines] = withChangeLines([edited], [change({ field: "sale_price", oldValue: "700000.00", newValue: "705000.00" })]);
    assert.deepEqual(withLines.changes, ["Changed by Ana Agent, 10 November 2026: sold price $700,000 (read from report) to $705,000"]);
    const d = draftEspReasoning({
      esp: { low: 690_000, high: 720_000 }, subject, subjectType: "Unit", comparables: [withLines], listings: [],
      agreementDate: "2026-11-20", noneOnMarketConfirmed: false,
    }) as EspDraft;
    assert.match(d.text, /1\/40 Sample Street sold for \$705,000 in September 2026/);
    assert.doesNotMatch(d.text, /\$700,000/);
  });
});
