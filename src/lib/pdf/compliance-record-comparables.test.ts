import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildComplianceRecordPdf } from "@/lib/pdf/compliance-record";
import { allItemsInRuleset } from "@/lib/rules/nsw-sales";
import { comparablesRecordLines, saleRecordLines } from "@/lib/rules/comparables-rules";
import { pdfText } from "@/lib/testing/pdf-text";
import type { Property } from "@/lib/types";

// The comparable sales on the compliance record, the front of the audit pack,
// under the 17 November rules (Reg s12C to s12F; 0119). Made-up data only.

const AS_AT = "2026-11-20";
const near = {
  address: "1 Near Street (made up)",
  salePrice: 1_250_000,
  saleDate: "2026-10-01",
  distanceM: 600,
  weighting: "relied" as const,
  agentNote: "Same street.",
  mostComparable: true,
  mostComparableReason: "Same street and layout, sold 7 weeks ago.",
  comparisonFactors: ["date_sold", "location", "layout"],
};
const far = {
  address: "9 Far Road (made up)",
  salePrice: 1_100_000,
  saleDate: "2026-09-01",
  distanceM: 3400,
  weighting: "considered" as const,
  agentNote: null,
  mostComparable: false,
  mostComparableReason: null,
  comparisonFactors: [],
};

async function recordText() {
  const pdf = await buildComplianceRecordPdf({
    property: { id: "p1", address: "9 Made Up Parade, Sampleton", stage: 1, created_at: "2026-11-18" } as unknown as Property,
    agencyName: "Made Up Realty",
    agentName: "Ana Agent",
    logo: null,
    items: allItemsInRuleset().filter((i) => i.key === "a4c"),
    byKey: {},
    espReasoning: null,
    comparables: [near, far].map((c) => ({ ...c, ruleLines: saleRecordLines(c, "metro", AS_AT) })),
    comparablesLines: comparablesRecordLines(
      { informationUsed: "Comparable-sales report (made up), and our own sales.", fewerThanThreeReason: "Only one other sale in 2 km." },
      1,
    ),
    signatures: { agent: null, licensee: null },
    rulesetVersion: "test",
    preparedFor: "test",
    generatedAt: new Date("2026-11-26T00:00:00Z"),
  });
  return pdfText(pdf).replace(/\s+/g, " ");
}

describe("the comparable sales on the compliance record", () => {
  it("says where each sale sits against the search area, and why one is among the 3 most comparable", async () => {
    const text = await recordText();
    assert.ok(text.includes("Recent sale: within 2 km and 6 months."), text);
    assert.ok(text.includes("One of the 3 most comparable: Same street and layout, sold 7 weeks ago."));
    assert.ok(text.includes("Comparison factors weighed: Date sold, location, layout."));
    assert.ok(text.includes("Outside the search area: 3.4 km away (2 km here)."));
  });

  it("says how many are marked, why fewer than 3, and the information used", async () => {
    const text = await recordText();
    assert.ok(text.includes("Marked as the most comparable: 1 of 3."));
    assert.ok(text.includes("Fewer than 3 comparable: Only one other sale in 2 km."));
    assert.ok(text.includes("Information used and where it came from: Comparable-sales report (made up), and our own sales."));
  });
});
