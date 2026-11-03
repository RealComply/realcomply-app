import { describe, it } from "node:test";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { buildComplianceRecordPdf, type ComplianceRecordInput } from "@/lib/pdf/compliance-record";
import type { PackDocument } from "@/lib/pdf/pack-documents";
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

  it("the cover says X trading as Y when the office has a licensed entity name (14 Oct 2026)", async () => {
    const text = pdfText(await pack({ agencyLine: "HR Holdings Pty Ltd trading as Harbour Realty" })).replace(/\s+/g, " ");
    assert.ok(text.includes("HR Holdings Pty Ltd trading as Harbour Realty"));
  });

  it("every page carries the RealComply band and its place in the record", async () => {
    const pages = await pdfPageTexts(await pack());
    assert.ok(pages.length > 1, "the test needs more than one page");

    pages.forEach((text, i) => {
      assert.equal(count(text, "realcomply.com.au"), 1, `page ${i + 1}`);
      assert.ok(text.includes(`Page ${i + 1} of ${pages.length}`), `page ${i + 1}`);
    });
  });

  it("the documents after the record are left alone, and not counted as pages of the record", async () => {
    const recordPages = (await pdfPageTexts(await pack())).length;
    const bytes = await onePagePdf();
    const pages = await pdfPageTexts(
      await pack({
        documents: [doc({ fileName: "cma.pdf", cardTitle: "Comparable sales report" })],
        loadDocument: async () => ({ bytes }),
      }),
    );
    assert.equal(pages.length, recordPages + 3, "the contents, a separator page and the document");
    pages.slice(0, recordPages).forEach((text, i) => assert.ok(text.includes(`Page ${i + 1} of ${recordPages}`)));
    assert.ok(!pages[recordPages + 2].includes("realcomply.com.au") && !pages[recordPages + 2].includes("Page "), "the document as it is");
  });

  it("an unsigned pack says so on every page, beside the page number", async () => {
    const bytes = await pack({ signatures: { agent: null, licensee: null } });
    assert.ok(pdfText(bytes).includes("Compliance record - DRAFT"));
    (await pdfPageTexts(bytes)).forEach((text, i) => {
      assert.ok(text.includes("DRAFT - not yet signed off"), `page ${i + 1}`);
    });
  });
});

// EVERY DOCUMENT ON THE LISTING (Adam, 2 Nov 2026): a contents page straight
// after the record, one line per document, each a link to its separator page;
// a separator page before each document with "Back to contents"; nothing left
// out silently.

const PROPERTY_ID = "4b926ebd-8331-4739-85b6-7c17acd77f6e";
function doc(over: Partial<PackDocument> = {}): PackDocument {
  return {
    stage: "Listing set-up",
    cardTitle: "Agency agreement signed",
    fileName: "Exclusive Sales Agreement (made up).pdf",
    uploadedBy: "Ana Agent",
    uploadedAt: "2026-10-01T01:00:00Z",
    path: `agency-uuid/${PROPERTY_ID}/a3/1759280400000-agreement.pdf`,
    kind: "pdf",
    ...over,
  };
}

/** Each page's link annotations, as the page numbers (1-based) they go to. */
async function linksOn(bytes: Uint8Array): Promise<number[][]> {
  const pdf = await PDFDocument.load(bytes);
  const pages = pdf.getPages();
  const numberOf = new Map(pages.map((pg, i) => [pg.ref.toString(), i + 1]));
  return pages.map((pg) => {
    const annots = pg.node.Annots();
    if (!annots) return [];
    const out: number[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookup(i, PDFDict);
      const dest = annot.lookup(PDFName.of("Dest"), PDFArray);
      out.push(numberOf.get(dest.get(0).toString()) ?? -1);
    }
    return out;
  });
}

describe("every document on the listing, inside the one PDF (2 Nov 2026)", () => {
  it("contents after the record, one linked line per document, and Back to contents on each separator", async () => {
    const recordPages = (await pdfPageTexts(await pack())).length;
    const twoPages = await PDFDocument.create();
    twoPages.addPage([300, 300]);
    twoPages.addPage([300, 300]);
    const report: Array<[string, boolean]> = [];
    const bytes = await pack({
      documents: [
        doc(),
        doc({ stage: "Pre-market", cardTitle: "Contract of sale prepared with prescribed documents", fileName: "contract.pdf", path: "a/p/b1/2-contract.pdf" }),
        doc({ stage: "On market", cardTitle: "Building, pest or strata reports", fileName: "Proposal (made up).docx", path: "a/p/f3/3-proposal.docx", kind: "other" }),
      ],
      loadDocument: async (d) => ({ bytes: d.fileName === "contract.pdf" ? await twoPages.save() : await onePagePdf() }),
      report: (path, included) => report.push([path, included]),
    });
    const pages = await pdfPageTexts(bytes);
    const contents = pages[recordPages].replace(/\s+/g, " ");
    assert.ok(contents.includes("Contents"));
    // Record, contents, then: separator + 1 page, separator + 2 pages, separator only.
    const first = recordPages + 2;
    assert.equal(pages.length, recordPages + 1 + 2 + 3 + 1);
    assert.ok(contents.includes("Listing set-up · Agency agreement signed"), contents);
    assert.ok(contents.includes("Exclusive Sales Agreement (made up).pdf · Uploaded by Ana Agent, 1 October 2026"), contents);
    assert.ok(contents.includes(`page ${first}`) && contents.includes(`page ${first + 2}`) && contents.includes(`page ${first + 5}`), contents);
    assert.ok(contents.includes("not included in this PDF"), contents);
    const links = await linksOn(bytes);
    assert.deepEqual(links[recordPages], [first, first + 2, first + 5], "each line goes to its document's separator page");
    for (const sep of [first, first + 2, first + 5]) {
      assert.deepEqual(links[sep - 1], [recordPages + 1], `Back to contents on page ${sep}`);
      assert.ok(pages[sep - 1].includes("Back to contents"));
    }
    const word = pages[first + 4].replace(/\s+/g, " ");
    assert.ok(word.includes("Not included in this PDF: Word document (.docx). Kept in RealComply."), word);
    assert.deepEqual(report, [
      [doc().path, true],
      ["a/p/b1/2-contract.pdf", true],
      ["a/p/f3/3-proposal.docx", false],
    ]);
  });

  it("a damaged, empty or password-protected PDF says why on its separator page, and the pack still builds", async () => {
    const locked = await encryptedPdf();
    const bytes = await pack({
      documents: [
        doc({ fileName: "damaged.pdf", path: "a/p/a3/1-damaged.pdf" }),
        doc({ fileName: "empty.pdf", path: "a/p/b1/2-empty.pdf" }),
        doc({ fileName: "locked.pdf", path: "a/p/b1a/3-locked.pdf" }),
        doc({ fileName: "fine.pdf", path: "a/p/d3/4-fine.pdf" }),
      ],
      loadDocument: async (d) =>
        d.fileName === "damaged.pdf"
          ? { bytes: new TextEncoder().encode("%PDF-1.7\nthis is not a pdf at all\n%%EOF") }
          : d.fileName === "empty.pdf"
            ? { problem: "it came through empty" }
            : d.fileName === "locked.pdf"
              ? { bytes: locked }
              : { bytes: await onePagePdf() },
    });
    const text = pdfText(bytes).replace(/\s+/g, " ");
    assert.ok(text.includes("This document couldn't be added: it's damaged or incomplete. Kept in RealComply."), text.slice(-1500));
    assert.ok(text.includes("This document couldn't be added: it came through empty. Kept in RealComply."));
    assert.ok(text.includes("This document couldn't be added: it's password-protected. Kept in RealComply."));
    assert.ok(text.includes("Someone else's document"), "the good one is still in");
  });

  it("photos become pages", async () => {
    const recordPages = (await pdfPageTexts(await pack())).length;
    const bytes = await pack({
      documents: [doc({ fileName: "IMG_0001.png", kind: "image", path: "a/p/c1/1-photo.png" })],
      loadDocument: async () => ({ bytes: TINY_PNG }),
    });
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), recordPages + 3, "contents, separator, the photo's page");
  });

  it("a document that would take the pack over its size limit is named, not dropped; smaller ones after it still go in", async () => {
    const small = await onePagePdf();
    // A one-page PDF of 1.5 MB: the padding is random, so it can't be compressed away.
    const big = await PDFDocument.create();
    big.addPage([300, 300]).drawText("The big one", { x: 20, y: 150, size: 12 });
    await big.attach(randomBytes(1.5 * 1024 * 1024), "padding.bin", { mimeType: "application/octet-stream" });
    const bigBytes = await big.save();
    assert.ok(bigBytes.length > 1024 * 1024);
    const report: Array<[string, boolean]> = [];
    const bytes = await pack({
      documents: [
        doc({ fileName: "first.pdf", path: "a/p/a1/1-first.pdf" }),
        doc({ fileName: "too big.pdf", path: "a/p/a2/2-big.pdf" }),
        doc({ fileName: "last.pdf", path: "a/p/a7/3-last.pdf" }),
      ],
      loadDocument: async (d) => ({ bytes: d.fileName === "too big.pdf" ? bigBytes : small }),
      maxDocumentBytes: 1024 * 1024,
      report: (path, included) => report.push([path, included]),
    });
    const text = pdfText(bytes).replace(/\s+/g, " ");
    assert.ok(!text.includes("The big one"), "the big one is not inside");
    assert.ok(text.includes("Not included in this PDF: the audit pack is at its size limit (1 MB). Kept in RealComply."), text.slice(-1200));
    assert.ok(text.includes("too big.pdf · Uploaded by Ana Agent, 1 October 2026 · not included in this PDF"), "named on the contents page");
    assert.equal((text.match(/Someone else's document/g) ?? []).length, 2, "the small ones before and after it are both in");
    assert.deepEqual(report, [
      ["a/p/a1/1-first.pdf", true],
      ["a/p/a2/2-big.pdf", false],
      ["a/p/a7/3-last.pdf", true],
    ]);
  });

  it("no internal ids in the pack: names, titles and dates only", async () => {
    const text = pdfText(
      await pack({ documents: [doc()], loadDocument: async () => ({ bytes: await onePagePdf() }) }),
    );
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text), "no uuid");
    assert.ok(!text.includes("1759280400000"), "no stored file name");
  });
});

/** A one-page PDF with an owner password, made the way PDF tools mark encryption: an /Encrypt entry in the trailer. */
async function encryptedPdf(): Promise<Uint8Array> {
  const one = await PDFDocument.create();
  one.addPage([300, 300]).drawText("A locked document", { x: 20, y: 150, size: 12 });
  // A classic trailer (no object streams), so the Encrypt entry has somewhere to go.
  const plain = await one.save({ useObjectStreams: false });
  const text = new TextDecoder("latin1").decode(plain);
  // pdf-lib refuses to load a document whose trailer names an Encrypt dictionary.
  const withEncrypt = text.replace(/trailer\s*<</, "trailer\n<<\n/Encrypt << /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>");
  return Uint8Array.from(withEncrypt, (ch) => ch.charCodeAt(0));
}

// 1x1 transparent PNG.
const TINY_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
  (c) => c.charCodeAt(0),
);

describe("a licensee signature given through a copied link (option 2, Adam 3 Nov 2026; 0107)", () => {
  it("says so under the signature, with who copied it and when", async () => {
    const text = pdfText(
      await pack({
        signatures: {
          ...signed,
          licensee: { ...signed.licensee, copiedLink: { by: "Alex Agent", at: "2026-10-11T23:30:00Z" } },
        },
      }),
    ).replace(/\s+/g, " ");
    assert.ok(
      text.includes("Signed through a link Alex Agent copied on 12 October 2026 and sent outside RealComply's email."),
    );
  });

  it("says nothing of the kind when the link went only by email", async () => {
    const text = pdfText(await pack()).replace(/\s+/g, " ");
    assert.ok(!text.includes("Signed through a link"));
  });
});
