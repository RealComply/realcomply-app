import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { sgPdfFileName, sgPdfInput, versionSaid } from "@/lib/sg-document/export";
import { buildSgDocumentPdf, pdfTitle, wrapText } from "@/lib/pdf/sg-document";
import { changeLogRows, sgChangeLog, versionSignedOf } from "@/lib/sg-document/change-log";
import type { SgAmendment } from "@/lib/sg-document/amendments";
import type { SgReview } from "@/lib/sg-document/annual-review";

// Supervision guidelines part 4b (Adam's mockup, screens 2 and 5): Export
// PDF, the current document with amendments merged in, then the change log
// at the back. Made-up office, people and wording.

const SECTIONS = [
  {
    position: 0,
    number: "4",
    title: "Trust money",
    paragraphs: [
      "4.1 All money received for a client is banked by the end of the next business day.",
      "4.2 Receipts are issued on the day the money is received, and the receipt book is reconciled monthly.",
    ],
  },
  { position: 1, number: "6", title: "Complaints", paragraphs: ["6.1 Complaints are logged on the register."] },
];

const amendment = (over: Partial<SgAmendment>): SgAmendment => ({
  id: "a2",
  documentId: "d1",
  refNo: 2,
  sectionPosition: 0,
  paragraphIndex: 1,
  sectionLabel: "4. Trust money",
  previousText: SECTIONS[0].paragraphs[1],
  newText: "4.2 Receipts are issued on the day the money is received, and the receipt book is reconciled with the trust account every week.",
  reason: "audit_finding",
  reasonOther: null,
  startsOn: "2026-11-03",
  status: "approved",
  createdByName: "Priya Nair",
  createdAt: "2026-11-03T00:00:00Z",
  approvedByName: "Priya Nair",
  approvedAs: "licensee",
  approvedAt: "2026-11-03T01:00:00Z",
  ...over,
});
const A2 = amendment({});
const A1 = amendment({
  id: "a1",
  refNo: 1,
  sectionPosition: 1,
  paragraphIndex: 1,
  sectionLabel: "6. Complaints",
  previousText: "",
  newText: "6.2 A complaint is acknowledged in writing within 2 business days.",
  reason: "complaint",
  startsOn: "2026-09-12",
  approvedByName: "Marcus Tran",
  approvedAs: "office_manager",
  approvedAt: "2026-09-12T02:00:00Z",
});
const DRAFT = amendment({ id: "d", refNo: null, status: "draft", paragraphIndex: 0, newText: "4.1 Never printed." });

const REVIEW: SgReview = {
  id: "r1",
  documentId: "d1",
  note: "Reviewed with Marcus after the trust audit.",
  reviewedByName: "Priya Nair",
  reviewedAs: "licensee",
  reviewedAt: "2027-07-20T01:00:00Z",
};

const SAVED = [{ id: "d1", docType: "sg_and_procedures" as const, versionLabel: "v7.3", savedAt: "2026-08-14T01:00:00Z", savedByName: "Priya Nair", manualVersionId: "mv1" }];

const LOG = sgChangeLog({
  savedDocs: SAVED,
  approved: [A1, A2],
  reviews: [REVIEW],
  signers: new Map([
    ["a1", ["lee", "ana", "max"]],
    ["a2", ["lee"]],
  ]),
  staffIds: ["lee", "ana", "max"],
  versionSigned: versionSignedOf(
    [{ id: "mv1", file_path: "o1/_sg-manual/1.pdf" }],
    [{ id: "sd1", file_path: "o1/_sg-manual/1.pdf" }],
    [
      { document_id: "sd1", signed_at: "2026-08-15T00:00:00Z" },
      { document_id: "sd1", signed_at: null },
    ],
  ),
});

const input = () =>
  sgPdfInput({
    officeName: "Harbour & Vale Realty (made up)",
    docType: "sg_and_procedures",
    versionLabel: "v7.3",
    savedAt: "2026-08-13T15:00:00Z",
    savedByName: "Priya Nair",
    sections: SECTIONS,
    amendments: [A2, A1, DRAFT],
    nextReviewDue: "2028-07-20",
    exportedBy: "Priya Nair",
    today: "2026-11-11",
    changeLog: LOG,
  });

describe("what Export PDF prints", () => {
  it("the heading: office, kind of document, version, amendments, next review, saved and exported", () => {
    const i = input();
    assert.equal(i.officeName, "Harbour & Vale Realty (made up)");
    assert.equal(i.title, "Supervision guidelines and procedures manual");
    assert.equal(i.versionSaid, "v7.3");
    assert.deepEqual(i.details, ["2 amendments merged in", "Next review due 20 July 2028"]);
    assert.equal(i.savedLine, "Saved to RealComply 14 August 2026 by Priya Nair.", "the day is Sydney's");
    assert.equal(i.exportedLine, "Exported 11 November 2026 by Priya Nair.");
    assert.equal(pdfTitle(i), "Supervision guidelines and procedures manual v7.3");
  });

  it("every approved amendment merged into its place, marked; drafts never", () => {
    const [trust, complaints] = input().sections;
    assert.equal(trust.heading, "4. Trust money");
    assert.deepEqual(
      trust.paragraphs.map((p) => [p.text, p.amendedLine]),
      [
        [SECTIONS[0].paragraphs[0], null],
        [A2.newText, "Amended A2 · From 3 November 2026 · Reason: audit finding · Approved by Priya Nair"],
      ],
    );
    assert.deepEqual(
      complaints.paragraphs.map((p) => p.text),
      ["6.1 Complaints are logged on the register.", A1.newText],
    );
    assert.equal(complaints.paragraphs[1].amendedLine, "Amended A1 · From 12 September 2026 · Reason: complaint · Approved by Marcus Tran (office manager)");
    assert.ok(!JSON.stringify(input().sections).includes("Never printed"));
  });

  it("the change log at the back, the same rows the page shows", () => {
    assert.deepEqual(
      LOG.map((r) => [r.starts, r.ref, r.whatChanged, r.approvedBy, r.staffSigned]),
      [
        ["20 Jul 2027", "Review", "Reviewed, no changes needed. Note: Reviewed with Marcus after the trust audit.", "Priya Nair", "Not needed"],
        ["3 Nov 2026", "A2", "4.2 reworded (4. Trust money)", "Priya Nair", "1 of 3"],
        ["12 Sep 2026", "A1", "6.2 added (6. Complaints)", "Marcus Tran (office manager)", "3 of 3"],
        ["14 Aug 2026", "v7.3", "Uploaded to RealComply", "Priya Nair", "1 of 2"],
      ],
    );
    assert.deepEqual(input().changeLog, LOG);
  });

  it("with no amendments, version or saved date: still says what it is", () => {
    const i = sgPdfInput({
      officeName: " ",
      docType: null,
      versionLabel: "3",
      savedAt: null,
      savedByName: null,
      sections: SECTIONS,
      amendments: [],
      nextReviewDue: null,
      exportedBy: "Max Manager",
      today: "2026-11-11",
      changeLog: [],
    });
    assert.equal(i.officeName, "Your office");
    assert.equal(i.title, "Supervision guidelines");
    assert.equal(i.versionSaid, "Version 3");
    assert.deepEqual(i.details, []);
    assert.equal(i.savedLine, null);
    assert.ok(i.sections.every((s) => s.paragraphs.every((p) => p.amendedLine === null)));
    assert.equal(versionSaid(null), null);
    assert.equal(versionSaid("  "), null);
  });

  it("the file's name: plain, safe to download", () => {
    assert.equal(sgPdfFileName(input()), "Supervision guidelines and procedures manual v7.3.pdf");
    assert.equal(sgPdfFileName({ title: "Procedures manual", versionSaid: 'v2/"Café"' }), "Procedures manual v2 Cafe.pdf");
    assert.equal(sgPdfFileName({ title: "Supervision guidelines", versionSaid: null }), "Supervision guidelines.pdf");
  });

  it("no em dashes and no internal ids in anything printed", () => {
    const printed = JSON.stringify({ ...input(), changeLog: input().changeLog.map((r) => [r.starts, r.ref, r.document, r.whatChanged, r.reason, r.approvedBy, r.staffSigned]) });
    assert.ok(!printed.includes("—"));
    for (const id of ["a1", "a2", "d1", "mv1", "sd1", "r1"]) assert.ok(!printed.includes(`"${id}"`), id);
  });
});

describe("the PDF", () => {
  it("opens, is titled, and has the change log on its own page at the back", async () => {
    const bytes = await buildSgDocumentPdf(input());
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getTitle(), "Supervision guidelines and procedures manual v7.3");
    assert.equal(doc.getPageCount(), 2);
  });

  it("a long document runs onto more pages, and a long change log repeats its heading", async () => {
    const long = Array.from({ length: 60 }, (_, k) => ({
      position: k,
      number: String(k + 1),
      title: `Section ${k + 1}`,
      paragraphs: [`${k + 1}.1 ${"The licensee in charge checks this every month. ".repeat(12)}`],
    }));
    const rows = changeLogRows(
      [],
      Array.from({ length: 80 }, (_, k) =>
        ({
          amendment: amendment({ id: `x${k}`, refNo: k + 1, startsOn: "2026-11-03" }),
          document: { docType: "sg" as const, versionLabel: "v1" },
          signed: { signed: 1, of: 2 },
        }),
      ),
    );
    const bytes = await buildSgDocumentPdf({ ...input(), sections: input().sections.concat(sgPdfInput({ ...baseArgs(), sections: long }).sections), changeLog: rows });
    const doc = await PDFDocument.load(bytes);
    assert.ok(doc.getPageCount() > 8, `${doc.getPageCount()} pages`);
  });

  it("names and wording the font can't draw don't stop it", async () => {
    const bytes = await buildSgDocumentPdf({
      ...input(),
      officeName: "Nguyễn Realty 不動産 (made up)",
      sections: [{ heading: "1. Intro “quoted”", paragraphs: [{ text: "Tab\there, emoji 🏠, and a very-long-unbroken-word-".repeat(5) + "x".repeat(400), amendedLine: null }] }],
    });
    assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 2);
  });

  it("a word too long for the line is broken, never run off the page", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const lines = wrapText(`short ${"w".repeat(300)} end`, font, 10, 200);
    assert.ok(lines.length > 2);
    assert.ok(lines.every((l) => font.widthOfTextAtSize(l, 10) <= 200), "every line fits");
    assert.equal(lines.join("").replace(/\s/g, ""), `short${"w".repeat(300)}end`);
  });
});

function baseArgs() {
  return {
    officeName: "Harbour & Vale Realty (made up)",
    docType: "sg_and_procedures" as const,
    versionLabel: "v7.3",
    savedAt: null,
    savedByName: null,
    sections: SECTIONS,
    amendments: [],
    nextReviewDue: null,
    exportedBy: "Priya Nair",
    today: "2026-11-11",
    changeLog: [],
  };
}
