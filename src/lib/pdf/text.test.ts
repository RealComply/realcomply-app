import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFPage, StandardFonts, type PDFFont } from "pdf-lib";
import { pdfText } from "./text";
import { buildComplianceRecordPdf, type ComplianceRecordInput } from "./compliance-record";
import { buildCertificatePdf, NAME_NOT_DRAWABLE, type DeletionCounts } from "@/lib/subscription-end/certificate";
import type { Property } from "@/lib/types";

// Code review fixes, part C (12 Oct 2026): typed text on a PDF is drawn as
// near as the font allows and never stops the document being made. The
// compliance record and the deletion certificate used to flatten names to
// plain ASCII ("José" printed as "Jos"); they now keep every letter the font
// can draw, as the signed copy has since 10 Oct. Finding 40: a name the font
// can't draw at all must not fail the certificate, or leave it unnamed. Built
// from made-up names only.

let helvetica: PDFFont;
beforeEach(async () => {
  helvetica = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
});

describe("pdfText", () => {
  it("keeps accented letters the font has, and takes the accent off one it hasn't", () => {
    assert.equal(pdfText("José Müller", helvetica), "José Müller");
    assert.equal(pdfText("Nguyễn Văn An", helvetica), "Nguyen Van An");
  });

  it("drops what it can't draw at all, and never throws", () => {
    assert.equal(pdfText("李氏地产 Realty 😀", helvetica), " Realty ");
  });

  it("the app's curly quotes and dashes, and a line break in a note", () => {
    assert.equal(pdfText("Smith’s “guide” – see\nnotes", helvetica), `Smith's "guide" - see notes`);
  });
});

// Every string drawn on the page, as it was handed to pdf-lib.
let drawn: string[];
const original = PDFPage.prototype.drawText;
beforeEach(() => {
  drawn = [];
  PDFPage.prototype.drawText = function (this: PDFPage, text: string, options = {}) {
    drawn.push(text);
    return original.call(this, text, options);
  };
});
afterEach(() => {
  PDFPage.prototype.drawText = original;
});

const counts: DeletionCounts = {
  listings: 3,
  pm_properties: 0,
  documents: 12,
  gifts: 0,
  complaints: 0,
  breaches: 0,
  training_and_cpd: 1,
  licence_records: 2,
  trust_reconciliations: 0,
  trust_audits: 0,
  other_signoff_documents: 0,
  user_accounts: 2,
};

const certificate = (subscriberName: string) =>
  buildCertificatePdf({
    certificateNumber: "DC-TEST-0001",
    subscriberName,
    endedAt: new Date("2026-10-01T00:00:00Z"),
    deletedAt: new Date("2026-10-15T00:00:00Z"),
    counts,
    activityDeleteAfter: "2033-10-15",
  });

describe("the deletion certificate", () => {
  it("names the subscriber with its accents", async () => {
    await certificate("Café Müller Realty");
    assert.ok(drawn.includes("Café Müller Realty"), drawn.join(" | "));
  });

  it("a name the font can't draw any of: the certificate is still made, and says where the name is", async () => {
    const pdf = await certificate("李氏地产 😀");
    assert.ok(pdf.length > 0);
    assert.ok(drawn.join(" ").includes(NAME_NOT_DRAWABLE), "not a blank subscriber line");
  });

  it("a long name wraps in its column rather than running off the page", async () => {
    const name = "The Very Long Name Real Estate Agency of the Upper North Shore and Northern Beaches Pty Ltd";
    await certificate(name);
    const subscriberLines = drawn.filter((t) => name.includes(t) && t.length > 4);
    assert.ok(subscriberLines.length >= 2, drawn.join(" | "));
    assert.equal(subscriberLines.join(" "), name);
  });
});

const record = (over: Partial<ComplianceRecordInput>) =>
  buildComplianceRecordPdf({
    property: { id: "p1", address: "1 Rue de l'Église, Exampleville", stage: 2, created_at: "2026-08-01" } as unknown as Property,
    agencyName: "Café Realty",
    agentName: "Zoë Agent",
    logo: null,
    items: [],
    byKey: {},
    espReasoning: null,
    comparables: [
      { address: "3 Côte Rd, Exampleville", salePrice: 800000, saleDate: "2026-07-01", weighting: "relied", agentNote: "Same street,\nnewer kitchen" },
    ],
    signatures: { agent: { typedName: "Nguyễn Văn An", signedAt: "2026-10-12T01:00:00Z" }, licensee: null },
    attachments: [],
    rulesetVersion: "test",
    preparedFor: "test",
    generatedAt: new Date("2026-10-12T00:00:00Z"),
    ...over,
  });

describe("the compliance record", () => {
  it("prints names, addresses and notes with their accents", async () => {
    await record({});
    for (const expected of ["Café Realty", "Zoë Agent", "1 Rue de l'Église, Exampleville", "3 Côte Rd, Exampleville", "Same street, newer kitchen"]) {
      assert.ok(drawn.includes(expected), `${expected} missing from: ${drawn.join(" | ")}`);
    }
  });

  it("a signature the handwriting face can't draw is printed in the italic, spelt as near as it can be", async () => {
    await record({});
    assert.ok(drawn.includes("Nguyen Van An"), drawn.join(" | "));
  });

  it("names in a script the font has none of: the record is still made", async () => {
    const pdf = await record({
      agencyName: "李氏地产",
      agentName: "李明 😀",
      signatures: { agent: { typedName: "李明", signedAt: "2026-10-12T01:00:00Z" }, licensee: null },
    });
    assert.ok(pdf.length > 0);
  });
});
