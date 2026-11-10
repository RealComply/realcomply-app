import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  amendmentFrom,
  amendmentLine,
  amendmentRef,
  approvedBySaid,
  changeHeadline,
  clauseOf,
  currentWording,
  paragraphCount,
  reasonSaid,
  signedOf,
  whatChanged,
  withAmendments,
  wordDiff,
  type SgAmendment,
} from "@/lib/sg-document/amendments";
import { changeLogRows, documentSaid, nextReviewDue, nextReviewSaid, twelveMonthsAfter } from "@/lib/sg-document/change-log";

// Supervision guidelines part 2 (Adam's mockup, signed off 6 Nov 2026,
// screens 2, 3, 5 and 6; 0125). Made-up office, people and wording.

const SECTIONS = [
  {
    position: 0,
    number: "4",
    title: "Trust money",
    paragraphs: [
      "4.1 All money received for a client is banked into the trust account by the end of the next business day.",
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
  newText:
    "4.2 Receipts are issued on the day the money is received, and the receipt book is reconciled with the trust account every week by the office manager, then checked by the licensee in charge.",
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

describe("the live document with its amendments in place (screen 2)", () => {
  it("shows the newest wording, the amendment, and the wording before it", () => {
    const live = withAmendments(SECTIONS, [A2, A1]);
    const trust = live[0];
    assert.deepEqual(trust.refs, ["A2"]);
    assert.equal(trust.live[0].amendment, null);
    assert.equal(trust.live[1].text, A2.newText);
    assert.equal(trust.live[1].amendment?.id, "a2");
    assert.deepEqual(trust.live[1].previous, [{ ref: null, text: SECTIONS[0].paragraphs[1] }]);
    assert.equal(amendmentLine(A2), "From 3 November 2026 · Reason: audit finding · Approved by Priya Nair");
  });

  it("a paragraph added comes after the section's own, and the side list marks it", () => {
    const complaints = withAmendments(SECTIONS, [A2, A1])[1];
    assert.deepEqual(complaints.refs, ["A1"]);
    assert.deepEqual(
      complaints.live.map((p) => p.text),
      ["6.1 Complaints are logged on the register.", "6.2 A complaint is acknowledged in writing within 2 business days."],
    );
    assert.deepEqual(complaints.live[1].previous, [], "nothing before an added paragraph");
  });

  it("amended twice: the newest shows, and both earlier wordings are kept, newest first", () => {
    const A3 = amendment({ id: "a3", refNo: 3, previousText: A2.newText, newText: "4.2 Receipts are reconciled daily." });
    const p = withAmendments(SECTIONS, [A2, A3])[0].live[1];
    assert.equal(p.text, "4.2 Receipts are reconciled daily.");
    assert.equal(p.amendment?.refNo, 3);
    assert.deepEqual(
      p.previous.map((w) => w.ref),
      ["A2", null],
    );
  });

  it("drafts change nothing anyone reads", () => {
    const draft = amendment({ id: "d", refNo: null, status: "draft", newText: "4.2 Never." });
    assert.equal(withAmendments(SECTIONS, [draft])[0].live[1].text, SECTIONS[0].paragraphs[1]);
    assert.equal(amendmentRef(draft), "Draft");
  });
});

describe("the quick amendment form (screen 3)", () => {
  it("starts from the wording as it stands, and adds after amendments that added one", () => {
    assert.equal(currentWording(SECTIONS, [A2], 0, 1), A2.newText);
    assert.equal(currentWording(SECTIONS, [A2], 0, 0), SECTIONS[0].paragraphs[0]);
    assert.equal(paragraphCount(SECTIONS[1], [A1]), 2);
    assert.equal(paragraphCount(SECTIONS[0], [A1]), 2);
  });

  it("before and after, word by word", () => {
    const parts = wordDiff(SECTIONS[0].paragraphs[1], A2.newText);
    assert.equal(parts.filter((p) => p.kind === "del").map((p) => p.text.trim()).join(" "), "monthly.");
    assert.ok(parts.some((p) => p.kind === "ins" && p.text.includes("with the trust account every week")));
    assert.equal(
      parts.filter((p) => p.kind !== "ins").map((p) => p.text).join(""),
      SECTIONS[0].paragraphs[1],
      "the before side gives the old wording back",
    );
    assert.equal(parts.filter((p) => p.kind !== "del").map((p) => p.text).join(""), A2.newText, "the after side gives the new");
    assert.deepEqual(wordDiff("", "New."), [{ kind: "ins", text: "New." }]);
  });
});

describe("the change log (screen 5)", () => {
  it("says what changed, why and who approved it, as the mockup does", () => {
    assert.equal(whatChanged(A2), "4.2 reworded (4. Trust money)");
    assert.equal(whatChanged(A1), "6.2 added (6. Complaints)");
    assert.equal(whatChanged({ previousText: "Receipts monthly.", newText: "Receipts weekly.", sectionLabel: "Trust" }), "Paragraph reworded (Trust)");
    assert.equal(reasonSaid(A2), "Audit finding");
    assert.equal(reasonSaid(amendment({ reason: "other", reasonOther: "New bank" })), "Other: New bank");
    assert.equal(approvedBySaid(A1), "Marcus Tran (office manager)");
    assert.equal(approvedBySaid(A2), "Priya Nair");
    assert.equal(clauseOf("4.2 Receipts"), "4.2");
    assert.equal(clauseOf("Receipts 4.2"), null);
  });

  it("lists every version and amendment, newest first, with the staff who signed", () => {
    const rows = changeLogRows(
      [
        {
          id: "v73",
          docType: "sg_and_procedures",
          versionLabel: "v7.3",
          savedAt: "2026-08-14T01:00:00Z",
          savedByName: "Priya Nair",
          signed: { signed: 6, of: 6 },
        },
      ],
      [
        { amendment: A1, document: { docType: "sg_and_procedures", versionLabel: "v7.3" }, signed: { signed: 6, of: 6 } },
        { amendment: A2, document: { docType: "sg_and_procedures", versionLabel: "v7.3" }, signed: { signed: 4, of: 6 } },
      ],
    );
    assert.deepEqual(
      rows.map((r) => [r.starts, r.ref, r.document, r.whatChanged, r.reason, r.approvedBy, r.staffSigned]),
      [
        ["3 Nov 2026", "A2", "SG and procedures manual v7.3", "4.2 reworded (4. Trust money)", "Audit finding", "Priya Nair", "4 of 6"],
        ["12 Sep 2026", "A1", "SG and procedures manual v7.3", "6.2 added (6. Complaints)", "Complaint", "Marcus Tran (office manager)", "6 of 6"],
        ["14 Aug 2026", "v7.3", "SG and procedures manual", "Uploaded to RealComply", "First upload", "Priya Nair", "6 of 6"],
      ],
    );
    assert.equal(documentSaid("procedures", "v2"), "Procedures manual v2");
  });

  it("counts only the office's people now", () => {
    assert.deepEqual(signedOf(["lee", "ana", "gone"], ["lee", "ana", "max"]), { signed: 2, of: 3 });
  });
});

describe("staff sign each change (screen 6)", () => {
  it("a short headline naming the change", () => {
    assert.equal(changeHeadline(A2), "A2, from 3 November 2026: 4.2 reworded (4. Trust money)");
  });
});

describe("the next review (2.1.2: at least every 12 months)", () => {
  it("12 months after the latest of sign-up, a version saved and an amendment approved", () => {
    assert.equal(nextReviewDue("2026-07-01T00:00:00Z", ["2026-08-13T15:00:00Z", A2.approvedAt]), "2027-11-03");
    // 14 Aug in Sydney is still 13 Aug in UTC at 3pm: the day is Sydney's.
    assert.equal(nextReviewDue("2026-07-01T00:00:00Z", ["2026-08-13T15:00:00Z"]), "2027-08-14");
    assert.equal(nextReviewDue("2026-07-01T00:00:00Z", []), "2027-07-01");
    assert.equal(nextReviewDue(null, []), null);
    assert.equal(twelveMonthsAfter("2028-02-29"), "2029-02-28");
    assert.equal(nextReviewSaid("2027-08-14"), "Next review due 14 August 2027");
  });
});

describe("reading rows back", () => {
  it("takes a database row, and nothing that isn't one", () => {
    const a = amendmentFrom({
      id: "x",
      document_id: "d1",
      ref_no: 2,
      section_position: 0,
      paragraph_index: 1,
      section_label: "4. Trust money",
      previous_text: "Old.",
      new_text: "New.",
      reason: "staffing",
      reason_other: null,
      starts_on: "2026-11-03",
      status: "approved",
      approved_by_name: "Priya Nair",
      approved_as: "licensee",
      approved_at: "2026-11-03T01:00:00Z",
    });
    assert.equal(a?.refNo, 2);
    assert.equal(a?.reason, "staffing");
    assert.equal(amendmentFrom({ id: "x", new_text: "New.", reason: "made_up", status: "approved" }), null);
    assert.equal(amendmentFrom({ id: "x", new_text: "New.", reason: "staffing", status: "discarded" }), null);
  });

  it("no em dashes anywhere the office reads", () => {
    const words = [amendmentLine(A2), changeHeadline(A1), whatChanged(A2), approvedBySaid(A1), nextReviewSaid("2027-01-01") ?? ""];
    assert.ok(words.every((w) => !w.includes("—")));
  });
});
