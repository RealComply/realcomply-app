import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildComplianceRecordPdf, type ComplianceRecordInput } from "@/lib/pdf/compliance-record";
import { getItem, type ComplianceItem } from "@/lib/rules/nsw-sales";
import { priceApproval } from "@/lib/rules/price-statement";
import { pdfText } from "@/lib/testing/pdf-text";
import type { Property, PropertyItem } from "@/lib/types";

// The audit pack says what price statement the licensee approved, and how
// (12 Oct 2026). Built from data only: no database, no email.

const b4 = getItem("b4") as ComplianceItem;

const pack = (row: Partial<PropertyItem>) => {
  const b4Row = { item_key: "b4", ...row } as PropertyItem;
  const input: ComplianceRecordInput = {
    property: { id: "p1", address: "42 Landra Ave, Mount Colah", stage: 2, created_at: "2026-08-01" } as unknown as Property,
    agencyName: "Hornsby Realty",
    agentName: "Sam Agent",
    logo: null,
    items: [b4],
    byKey: { b4: b4Row },
    espReasoning: null,
    comparables: [],
    priceApproval: priceApproval(b4Row),
    signatures: { agent: null, licensee: null },
    attachments: [],
    rulesetVersion: "test",
    preparedFor: "test",
    generatedAt: new Date("2026-10-12T00:00:00Z"),
  };
  return buildComplianceRecordPdf(input);
};

describe("the price statement approval in the audit pack", () => {
  it("prints the words and the emailed link they were approved through", async () => {
    const text = pdfText(
      await pack({
        status: "done",
        completed_by: null,
        data: {
          note: "Guide $750,000 – $790,000",
          signedName: "Lee Licensee",
          signedVia: "link",
          signoffRequestId: "r1",
          signedAt: "2026-10-12T02:15:00Z",
          sentTo: "lee@example.com",
        },
      }),
    );
    assert.ok(text.includes('Approved price statement: "Guide $750,000 - $790,000"'), text);
    assert.ok(text.includes("Approved by Lee Licensee through the emailed link to lee@example.com"));
    assert.ok(text.includes("(Sydney time)"));
  });

  it("says an approval given in the app was given in RealComply", async () => {
    const text = pdfText(
      await pack({ status: "done", completed_by: "u1", data: { note: "Offers over $1m", signedAt: "2026-10-12T02:15:00Z" } }),
    );
    assert.ok(text.includes('Approved price statement: "Offers over $1m"'));
    assert.ok(text.includes("Approved in RealComply by the licensee in charge"));
    assert.ok(!text.includes("through the emailed link"));
  });

  it("prints nothing of the kind while b4 is open", async () => {
    const text = pdfText(await pack({ status: "open", data: { note: "Guide $1m", signedVia: "link", signoffRequestId: "r1" } }));
    assert.ok(text.includes("Licensee approved the price statement"), "positive control: the card is listed");
    assert.ok(!text.includes("Approved price statement"));
  });
});
