import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CARRIED_IN, compareVersions, comparedWith, missingLine, normalise, sectionRuns, similarity } from "@/lib/sg-document/compare";
import type { SgAmendment } from "@/lib/sg-document/amendments";

// Supervision guidelines part 3 (Adam's mockup, signed off 6 Nov 2026, screen
// 4): a new full version compared section by section with v7.3 and its
// amendments. Made-up office and wording.

const sec = (position: number, number: string, title: string, paragraphs: string[]) => ({ position, number, title, paragraphs });

const LIVE = [
  sec(0, "1", "Introduction", ["1.1 These are the procedures of Harbourside Realty (made up)."]),
  sec(1, "2", "Licensee in charge", ["2.1 The licensee in charge is Priya Nair."]),
  sec(2, "3", "Listing a property", ["3.1 Every listing has a signed agency agreement before marketing."]),
  sec(3, "4", "Trust money", [
    "4.1 All money is banked by the end of the next business day.",
    "4.2 Receipts are issued on the day, and the receipt book is reconciled monthly.",
  ]),
  sec(4, "5", "Advertising", ["5.1 Every advertisement is checked by the listing agent."]),
  sec(5, "6", "Complaints", ["6.1 Complaints are logged on the register."]),
  sec(6, "7", "Staff training and CPD", ["7.1 CPD is completed by 30 June."]),
  sec(7, "8", "Record keeping", ["8.1 Records are kept for 3 years."]),
];

const amendment = (over: Partial<SgAmendment>): SgAmendment => ({
  id: "a",
  documentId: "d",
  refNo: 1,
  sectionPosition: 0,
  paragraphIndex: 0,
  sectionLabel: "",
  previousText: "",
  newText: "",
  reason: "audit_finding",
  reasonOther: null,
  startsOn: "2026-11-03",
  status: "approved",
  createdByName: null,
  createdAt: "2026-11-03T00:00:00Z",
  approvedByName: "Priya Nair",
  approvedAs: "licensee",
  approvedAt: "2026-11-03T01:00:00Z",
  ...over,
});

const A1 = amendment({
  id: "a1",
  refNo: 1,
  sectionPosition: 5,
  paragraphIndex: 1,
  sectionLabel: "6. Complaints",
  newText: "6.2 A complaint is acknowledged in writing within 2 business days.",
  approvedAt: "2026-09-12T02:00:00Z",
});
const A2 = amendment({
  id: "a2",
  refNo: 2,
  sectionPosition: 3,
  paragraphIndex: 1,
  sectionLabel: "4. Trust money",
  previousText: LIVE[3].paragraphs[1],
  newText: "4.2 Receipts are issued on the day, and the receipt book is reconciled with the trust account every week.",
});

// v8.0: A2 carried in, A1 left out, 5 changed, a new section 9, 1 to 3, 7 and 8 the same.
const NEW = [
  ...LIVE.slice(0, 3),
  sec(3, "4", "Trust money", [LIVE[3].paragraphs[0], A2.newText]),
  sec(4, "5", "Advertising", ["5.1 Every advertisement is checked by the listing agent.", "5.4 Advertised prices match the ESP on file."]),
  sec(5, "6", "Complaints", ["6.1 Complaints are logged on the register."]),
  ...LIVE.slice(6),
  sec(8, "9", "Property management", ["9.1 Rent is receipted the day it arrives."]),
];

describe("a new full version compared with the live one (screen 4)", () => {
  it("flags an amendment left out, and says which were carried in", () => {
    const c = compareVersions(LIVE, [A1, A2], NEW, "v7.3");
    assert.equal(c.amendmentCount, 2);
    assert.deepEqual(
      c.missing.map((m) => m.ref),
      ["A1"],
    );
    const rows = Object.fromEntries(c.rows.map((r) => [r.section, r]));
    assert.equal(rows["4. Trust money"].tag, "Carried in");
    assert.match(rows["4. Trust money"].detail[0], /^A2 \(4\.2 Receipts are issued/);
    assert.equal(rows["5. Advertising"].tag, "Changed");
    assert.ok(rows["5. Advertising"].before && rows["5. Advertising"].after?.includes("5.4 Advertised prices"));
    assert.equal(rows["6. Complaints"].tag, "A1 missing");
    assert.equal(rows["6. Complaints"].change, "missing");
    assert.equal(rows["9. Property management"].tag, "New section");
    assert.equal(rows["1 to 3, 7, 8"].tag, "No change");
  });

  it("says when the old wording is back, before the amendment", () => {
    const back = [...LIVE.slice(0, 3), sec(3, "4", "Trust money", LIVE[3].paragraphs), ...LIVE.slice(4)];
    const c = compareVersions(LIVE, [A2], back, "v7.3");
    const trust = c.rows.find((r) => r.section === "4. Trust money");
    assert.equal(trust?.tag, "A2 missing");
    assert.deepEqual(trust?.detail, ["Wording matches v7.3 before A2."]);
  });

  it("a section taken out is listed, with any amendment in it missing", () => {
    const c = compareVersions(LIVE, [A1], LIVE.filter((s) => s.number !== "6"), "v7.3");
    const gone = c.rows.find((r) => r.section === "6. Complaints");
    assert.equal(gone?.tag, "Removed, A1 missing");
    assert.deepEqual(c.missing.map((m) => m.ref), ["A1"]);
  });

  it("finds an amendment's wording even where the section was renumbered", () => {
    const moved = [...LIVE.slice(0, 5), sec(5, "10", "Complaints handling", ["6.1 Complaints are logged on the register.", A1.newText])];
    assert.deepEqual(compareVersions(LIVE, [A1], moved, "v7.3").missing, []);
  });

  it("the same version again: nothing but No change", () => {
    const c = compareVersions(LIVE, [], LIVE, "v7.3");
    assert.deepEqual(c.rows.map((r) => [r.section, r.tag]), [["1 to 8", "No change"]]);
    assert.deepEqual(c.missing, []);
  });

  it("drafts don't count", () => {
    const draft = amendment({ id: "d", refNo: null, status: "draft", sectionPosition: 5, newText: "6.9 Never." });
    assert.deepEqual(compareVersions(LIVE, [draft], LIVE, "v7.3").missing, []);
  });
});

describe("the words on screen", () => {
  it("the warning, and what it was compared with", () => {
    const m = compareVersions(LIVE, [A1, A2], NEW, "v7.3").missing[0];
    assert.deepEqual(missingLine(m, "v8.0"), {
      head: "A1 isn't in v8.0.",
      body: "Amendment A1 (6. Complaints: 6.2 A complaint is acknowledged in writing within 2 business days.) was approved on 12 September 2026 but its wording isn't in the new version. Check whether it was left out on purpose.",
    });
    assert.equal(missingLine(m, "").head, "A1 isn't in the new version.");
    assert.equal(comparedWith("v7.3", 2), "Compared section by section with v7.3 and its 2 amendments");
    assert.equal(comparedWith(null, 0), "Compared section by section with the current version");
  });

  it("sections with no change, as runs", () => {
    assert.equal(sectionRuns([{ number: "1", title: "" }, { number: "2", title: "" }, { number: "3", title: "" }, { number: "7", title: "" }, { number: "8", title: "" }]), "1 to 3, 7, 8");
    assert.equal(sectionRuns([{ number: null, title: "Intro" }]), "Intro");
  });

  it("the same words whatever the spacing, quotes or dashes", () => {
    assert.equal(normalise("  It’s  a  “test” – OK "), "it's a \"test\" - ok");
    assert.equal(similarity("4.2 Receipts are issued daily.", "4.2  Receipts are issued daily."), 1);
    assert.ok(similarity("4.2 Receipts are issued on the day and reconciled weekly.", "4.2 Receipts are issued on the day and reconciled weekly") >= CARRIED_IN);
    assert.ok(similarity("Receipts monthly.", "Rent is receipted the day it arrives.") < CARRIED_IN);
  });

  it("no em dashes", () => {
    const c = compareVersions(LIVE, [A1, A2], NEW, "v7.3");
    const words = [...c.rows.flatMap((r) => [r.section, r.tag, ...r.detail]), missingLine(c.missing[0], "v8.0").body];
    assert.ok(words.every((w) => !w.includes("—")));
  });
});
