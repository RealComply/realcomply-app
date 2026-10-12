import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { buildComplianceRecordPdf, type ComplianceRecordInput } from "@/lib/pdf/compliance-record";
import { allItemsInRuleset } from "@/lib/rules/nsw-sales";
import { pdfPageTexts, pdfText } from "@/lib/testing/pdf-text";
import type { Property } from "@/lib/types";

// The audit pack's masthead and footer, to the design Adam approved on 12 Oct
// 2026: the agency at the top, RealComply in a band at the foot of every
// page with "Page 1 of N". Built from data only: no database.

const signed = {
  agent: { typedName: "Alex Agent", signedAt: "2026-10-12T02:00:00Z" },
  licensee: { typedName: "Lee Licensee", signedAt: "2026-10-12T03:00:00Z" },
};

async function onePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]).drawText("Someone else's document", { x: 20, y: 150, size: 12 });
  return doc.save();
}

async function pack(overrides: Partial<ComplianceRecordInput> = {}) {
  return buildComplianceRecordPdf({
    property: { id: "p1", address: "12 Example Street, Exampleville", stage: 2, created_at: "2026-08-01" } as unknown as Property,
    agencyName: "Harbour Realty",
    agentName: "Alex Agent",
    logo: null,
    // Enough cards to run past one page.
    items: allItemsInRuleset().slice(0, 40),
    byKey: {},
    espReasoning: null,
    comparables: [],
    signatures: signed,
    attachments: [],
    rulesetVersion: "test",
    preparedFor: "test",
    generatedAt: new Date("2026-10-12T00:00:00Z"),
    ...overrides,
  });
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("the audit pack's branding", () => {
  it("the agency leads at the top; RealComply is no longer a line in the masthead", async () => {
    const text = pdfText(await pack());
    assert.ok(text.includes("Harbour Realty"));
    assert.ok(text.includes("Finalised compliance record"));
    assert.ok(!text.includes("Powered by RealComply"), "moved to the band at the foot of every page");
  });

  it("every page carries the RealComply band and its place in the record", async () => {
    const pages = await pdfPageTexts(await pack());
    assert.ok(pages.length > 1, "the test needs more than one page");

    pages.forEach((text, i) => {
      assert.equal(count(text, "realcomply.com.au"), 1, `page ${i + 1}`);
      assert.ok(text.includes(`Page ${i + 1} of ${pages.length}`), `page ${i + 1}`);
    });
  });

  it("appended documents are left alone, and not counted as pages of the record", async () => {
    const recordPages = (await pdfPageTexts(await pack())).length;

    const pages = await pdfPageTexts(
      await pack({
        attachments: [{ title: "Comparable sales report", fileName: "cma.pdf", bytes: await onePagePdf(), kind: "pdf" }],
      }),
    );
    assert.equal(pages.length, recordPages + 2, "a separator page and the document");

    pages.slice(0, recordPages).forEach((text, i) => assert.ok(text.includes(`Page ${i + 1} of ${recordPages}`)));
    for (const text of pages.slice(recordPages)) assert.ok(!text.includes("realcomply.com.au") && !text.includes("Page "));
  });

  it("an unsigned pack says so on every page, beside the page number", async () => {
    const bytes = await pack({ signatures: { agent: null, licensee: null } });
    assert.ok(pdfText(bytes).includes("Compliance record - DRAFT"));
    (await pdfPageTexts(bytes)).forEach((text, i) => {
      assert.ok(text.includes("DRAFT - not yet signed off"), `page ${i + 1}`);
    });
  });
});
