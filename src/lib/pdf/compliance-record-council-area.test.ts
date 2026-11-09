import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildComplianceRecordPdf } from "@/lib/pdf/compliance-record";
import { allItemsInRuleset } from "@/lib/rules/nsw-sales";
import { councilAreaRecordLines } from "@/lib/rules/council-area";
import { pdfText } from "@/lib/testing/pdf-text";
import type { Property } from "@/lib/types";

// The council area on the compliance record, the front of the audit pack
// (Reg s12A; 0118): under the comparables card, with where to look for
// comparable sales (Reg s12D). Made-up data only.

const AFTER = new Date("2026-11-26T00:00:00Z");

async function recordText(lines: string[] | undefined) {
  const pdf = await buildComplianceRecordPdf({
    property: { id: "p1", address: "9 Made Up Parade, Sampleton", stage: 1, created_at: "2026-11-01" } as unknown as Property,
    agencyName: "Made Up Realty",
    agentName: "Ana Agent",
    logo: null,
    items: allItemsInRuleset().filter((i) => i.key === "a4c" || i.key === "a4"),
    byKey: {},
    espReasoning: null,
    comparables: [],
    signatures: { agent: null, licensee: null },
    rulesetVersion: "test",
    preparedFor: "test",
    generatedAt: AFTER,
    councilAreaLines: lines,
  });
  return pdfText(pdf).replace(/\s+/g, " ");
}

describe("the council area on the compliance record", () => {
  it("says the council area, metro or non-metro, where it came from, and where to look", async () => {
    const text = await recordText(
      councilAreaRecordLines({ council: "Uralla", from: "agent", setByName: "Ana Agent (made up)", setOn: "20 November 2026" }, AFTER),
    );
    assert.ok(
      text.includes("Council area: Uralla, a non-metropolitan area (Reg s12A). Chosen by Ana Agent (made up) on 20 November 2026."),
      text,
    );
    assert.ok(text.includes("Look for comparable sales within 5 km, sold in the last 18 months (Reg s12D)."));
  });

  it("says when none was recorded", async () => {
    const text = await recordText(councilAreaRecordLines({ council: null, from: null, setByName: null, setOn: null }, AFTER));
    assert.ok(text.includes("Council area: not recorded."));
  });

  it("leaves it out of a record built without it", async () => {
    assert.ok(!(await recordText(undefined)).includes("Council area"));
  });
});
