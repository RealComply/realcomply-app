import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ADD_REVISION,
  ALL_IN_ERROR_HELP,
  IN_ERROR_PILL,
  LATEST_PILL,
  approvalLines,
  cancelledApprovalLines,
  cancelledBecause,
  espPackRows,
  espRange,
  espVersions,
  inErrorLine,
  recordedLine,
  replaceWarning,
  revisionFrom,
  revisionsInForce,
  revisionsOrCard,
  type EspRevision,
} from "@/lib/esp-history";

// ESP revision history (Adam, 3 Nov 2026; the approved mockup; 0110).

const rev = (no: number, low: number, high: number, givenOn: string, recordedAt: string, by = "Dana Whitlock"): EspRevision => ({
  no,
  low,
  high,
  givenOn,
  noticePath: `o/p/d3/${no}.pdf`,
  noticeFileName: `Revised ESP notice ${no}.pdf`,
  enteredManually: false,
  recordedByName: by,
  recordedAt,
});

// 14 Oct, 10:03am and 28 Oct, 4:12pm in Sydney (AEDT, UTC+11).
const R1 = rev(1, 1300000, 1360000, "2026-10-14", "2026-10-13T23:03:00Z");
const R2 = rev(2, 1250000, 1300000, "2026-10-28", "2026-10-28T05:12:00Z");
const ORIGINAL = { low: 1400000, high: 1450000, agreementDate: "2026-10-02", file: { path: "o/p/a3/a.pdf", name: "Agency agreement.pdf" } };

describe("the card lists every version, newest first", () => {
  it("marks the latest for checks, the older ones replaced, and the original at the bottom", () => {
    const v = espVersions(ORIGINAL, [R1, R2]);
    assert.deepEqual(
      v.map((x) => [x.label, x.range, x.pill]),
      [
        ["Revision 2", "$1,250,000 to $1,300,000", LATEST_PILL],
        ["Revision 1", "$1,300,000 to $1,360,000", "Replaced 28 Oct"],
        ["Original ESP", "$1,400,000 to $1,450,000", "Replaced 14 Oct"],
      ],
    );
    assert.deepEqual(v[0].lines, ["Notice given 28 October 2026", "Recorded by Dana Whitlock, 28 Oct, 4:12pm"]);
    assert.deepEqual(v[1].lines, ["Notice given 14 October 2026", "Recorded by Dana Whitlock, 14 Oct, 10:03am"]);
    assert.deepEqual(v[2].lines, ["From the agency agreement, 2 October 2026"]);
    assert.equal(v[0].latest, true);
    assert.equal(v.filter((x) => x.latest).length, 1);
  });

  it("an existing listing with one revision shows it as Revision 1, with nothing else changed", () => {
    const card = {
      evidence_path: "o/p/d3/9.pdf",
      data: { espRevised: true, revisedEspLow: 940000, revisedEspHigh: 1025000, noticeServedOn: "2026-10-19", evidenceFileName: "Notice.pdf" },
    };
    const revisions = revisionsOrCard([], card);
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0].no, 1);
    const v = espVersions({ ...ORIGINAL, file: null }, revisions);
    assert.deepEqual(v.map((x) => x.label), ["Revision 1", "Original ESP"]);
    assert.equal(v[0].range, "$940,000 to $1,025,000");
    assert.equal(v[0].pill, LATEST_PILL);
    // Once the database has rows, those are what show.
    assert.equal(revisionsOrCard([R1, R2], card).length, 2);
    // A card answered No, or with no notice, has no revision.
    assert.deepEqual(revisionsOrCard([], { evidence_path: "x", data: { espRevised: false } }), []);
    assert.deepEqual(revisionsOrCard([], { evidence_path: null, data: { espRevised: true, revisedEspLow: 1, revisedEspHigh: 2 } }), []);
  });

  it("reads the database row, and says a single figure once", () => {
    const r = revisionFrom({
      revision_no: 1,
      esp_low: "1350000",
      esp_high: 1350000,
      notice_given_on: null,
      notice_path: "o/p/d3/x.heic",
      notice_file_name: "IMG_9352.HEIC",
      recorded_by_name: "Adam",
      recorded_at: "2026-08-26T05:23:28Z",
    });
    assert.equal(r?.low, 1350000);
    assert.equal(espRange(r!.low, r!.high), "$1,350,000");
    assert.equal(revisionFrom({ revision_no: 1 }), null);
    assert.equal(recordedLine({ recordedByName: null, recordedAt: "" }), null);
  });
});

describe("adding a revision (Master, 3 Nov 2026)", () => {
  it("the button on the card says what Master asked for, word for word", () => {
    assert.equal(ADD_REVISION, "Add new estimated selling price revision");
  });
});

describe("before saving", () => {
  it("says what Adam asked for, word for word", () => {
    assert.equal(
      replaceWarning(1),
      "Saving this replaces Revision 1 as the latest. Revision 1 and its notice stay on the file. The price statement approval is cancelled and needs approving again against the new figure.",
    );
    assert.match(replaceWarning(null), /^Saving this replaces the original ESP as the latest\./);
  });
});

describe("the audit pack's page", () => {
  it("lists every version oldest first, with what each links to", () => {
    const rows = espPackRows({ low: 1400000, high: 1450000, agreementDate: "2026-10-02", agreementPath: "o/p/a3/a.pdf" }, [R2, R1]);
    assert.deepEqual(
      rows.map((r) => [r.version, r.esp, r.date, r.recordedBy, r.evidencePath, r.evidenceLabel]),
      [
        ["Original", "$1,400,000 to $1,450,000", "2 October 2026", "From the agency agreement", "o/p/a3/a.pdf", "Agency agreement"],
        ["Revision 1", "$1,300,000 to $1,360,000", "14 October 2026", "Dana Whitlock", "o/p/d3/1.pdf", "Revised ESP notice"],
        ["Revision 2 (latest)", "$1,250,000 to $1,300,000", "28 October 2026", "Dana Whitlock", "o/p/d3/2.pdf", "Revised ESP notice"],
      ],
    );
  });

  it("lists the price statement approvals and cancellations in date order, naming the revision", () => {
    const lines = approvalLines([
      { kind: "approved", at: "2026-10-29T00:00:00Z", by: "Dana Whitlock", because: null },
      { kind: "cancelled", at: R2.recordedAt, by: null, because: cancelledBecause({ because: "esp_changed", becauseItemKey: "d3", cancelledAt: R2.recordedAt }, [R1, R2]) },
      { kind: "approved", at: "2026-10-02T23:00:00Z", by: "Dana Whitlock", because: null },
      { kind: "cancelled", at: R1.recordedAt, by: null, because: cancelledBecause({ because: "esp_changed", becauseItemKey: "d3", cancelledAt: R1.recordedAt }, [R1, R2]) },
      { kind: "approved", at: "2026-10-14T22:00:00Z", by: "Dana Whitlock", because: null },
    ]);
    assert.deepEqual(lines, [
      "Approved 3 October 2026 by Dana Whitlock",
      "Cancelled 14 October 2026: Revision 1 recorded",
      "Approved 15 October 2026 by Dana Whitlock",
      "Cancelled 28 October 2026: Revision 2 recorded",
      "Approved 29 October 2026 by Dana Whitlock",
    ]);
    assert.equal(cancelledBecause({ because: "reopened", becauseItemKey: "a4", cancelledAt: R1.recordedAt }, []), "the ESP card was changed");
  });
});

describe("each revision: the ESP before it and the evidence (s72A(5); 0117)", () => {
  it("the notice has to state the ESP before the revision from 17 November, and it should match the file", async () => {
    const { previousEspProblem, previousEspDiffers, PREVIOUS_ESP_MISSING } = await import("./esp-history");
    const none = { low: null, high: null };
    const after = new Date("2026-11-20T09:00:00+11:00");
    assert.equal(previousEspProblem(none, "2026-11-17", after), PREVIOUS_ESP_MISSING);
    assert.match(PREVIOUS_ESP_MISSING, /\(s72A\)/);
    assert.equal(previousEspProblem(none, "2026-11-16", after), null, "a notice given before 17 November isn't asked for it");
    assert.equal(
      previousEspProblem(none, "2026-11-20", new Date("2026-11-10T09:00:00+11:00")),
      null,
      "nothing before midnight on 17 November, whatever date was typed",
    );
    assert.equal(previousEspProblem(none, null, new Date("2026-11-10T00:00:00+11:00")), null);
    assert.equal(previousEspProblem(none, null, new Date("2026-11-18T00:00:00+11:00")), PREVIOUS_ESP_MISSING);
    assert.equal(previousEspProblem({ low: 1_400_000, high: 1_450_000 }, "2026-11-18", after), null);
    const onFile = { low: 1_400_000, high: 1_450_000 };
    assert.equal(previousEspDiffers({ low: 1_400_000, high: 1_450_000 }, onFile), null);
    assert.equal(
      previousEspDiffers({ low: 1_400_000, high: 1_460_000 }, onFile),
      "The notice gives the ESP before the revision as $1,400,000 to $1,460,000, but the file has $1,400,000 to $1,450,000. Check the notice.",
    );
    assert.equal(previousEspDiffers(none, onFile), null);
    assert.equal(previousEspDiffers({ low: 1_400_000, high: 1_460_000 }, null), null);
  });

  it("the evidence is a file or part of the notice, from 17 November", async () => {
    const { revisionEvidenceProblem, EVIDENCE_MISSING } = await import("./esp-history");
    const after = new Date("2026-11-20T09:00:00+11:00");
    assert.equal(revisionEvidenceProblem({ evidencePath: null, inNotice: false, givenOn: "2026-11-17" }, after), EVIDENCE_MISSING);
    assert.equal(revisionEvidenceProblem({ evidencePath: "o/p/d3/e.pdf", inNotice: false, givenOn: "2026-11-17" }, after), null);
    assert.equal(revisionEvidenceProblem({ evidencePath: null, inNotice: true, givenOn: "2026-11-17" }, after), null);
    assert.equal(revisionEvidenceProblem({ evidencePath: null, inNotice: false, givenOn: "2026-11-16" }, after), null);
    assert.equal(
      revisionEvidenceProblem({ evidencePath: null, inNotice: false, givenOn: "2026-11-20" }, new Date("2026-11-10T09:00:00+11:00")),
      null,
      "nothing before midnight on 17 November",
    );
  });

  it("the history shows the ESP before it and the evidence", async () => {
    const { espVersions } = await import("./esp-history");
    const [latest] = espVersions({ low: 1_400_000, high: 1_450_000, agreementDate: null, file: null }, [
      {
        no: 1, low: 1_300_000, high: 1_360_000, givenOn: "2026-11-18", noticePath: "o/p/d3/n.pdf", noticeFileName: "Notice.pdf",
        enteredManually: false, recordedByName: "Ana Agent", recordedAt: "2026-11-18T01:00:00Z",
        previousLow: 1_400_000, previousHigh: 1_450_000, evidencePath: "o/p/d3/e.pdf", evidenceFileName: "Comparables.pdf", evidenceInNotice: false,
      },
    ]);
    assert.ok(latest.lines.includes("ESP before it, on the notice: $1,400,000 to $1,450,000"));
    assert.ok(!latest.lines.includes("Not the ESP on file before it"));
    assert.deepEqual(latest.evidence, { path: "o/p/d3/e.pdf", name: "Comparables.pdf" });
  });

  it("the history says when the ESP before it on the notice isn't the one on file", async () => {
    const { espVersions } = await import("./esp-history");
    const base = {
      noticeFileName: "Notice.pdf", enteredManually: false, recordedByName: "Ana Agent",
      evidencePath: null, evidenceFileName: null, evidenceInNotice: true,
    };
    const versions = espVersions({ low: 1_400_000, high: 1_450_000, agreementDate: null, file: null }, [
      { ...base, no: 1, low: 1_300_000, high: 1_360_000, givenOn: "2026-11-18", noticePath: "o/p/d3/1.pdf", recordedAt: "2026-11-18T01:00:00Z", previousLow: 1_400_000, previousHigh: 1_450_000 },
      { ...base, no: 2, low: 1_250_000, high: 1_300_000, givenOn: "2026-11-25", noticePath: "o/p/d3/2.pdf", recordedAt: "2026-11-25T01:00:00Z", previousLow: 1_350_000, previousHigh: 1_400_000 },
    ]);
    const [two, one] = versions;
    assert.ok(two.lines.includes("Not the ESP on file before it"), "revision 2's notice gives a figure that isn't revision 1's");
    assert.ok(!one.lines.includes("Not the ESP on file before it"), "revision 1's notice gives the original");
    assert.ok(two.lines.includes("Evidence: in the notice"));
  });
});

describe("market feedback on a revision (Reg s12G(1)(f))", () => {
  it("is read off the revision and shown with its version", async () => {
    const { revisionFrom, espVersions } = await import("./esp-history");
    const r = revisionFrom({
      revision_no: 1, esp_low: 1_300_000, esp_high: 1_360_000, notice_given_on: "2026-11-25", notice_path: "o/p/d3/n.pdf",
      notice_file_name: "Notice.pdf", entered_manually: false, recorded_by_name: "Ana Agent", recorded_at: "2026-11-25T01:00:00Z",
      market_feedback: [{ who: "Sam Buyer (made up)", contact: null, on: "2026-11-24", what: "Kitchen needs work.", why: "Three buyers said so.", how: "Lowered the top." }],
    });
    assert.ok(r);
    assert.equal(r!.marketFeedback?.length, 1);
    const [latest] = espVersions({ low: 1_400_000, high: 1_450_000, agreementDate: null, file: null }, [r!]);
    assert.equal(latest.feedback?.[0].who, "Sam Buyer (made up)");
  });
});

describe("entered in error (Master, 10 Nov 2026; 0124)", () => {
  // Revision 2 marked by the agent on 29 Oct, 9:30am in Sydney.
  const MARKED_AT = "2026-10-28T22:30:00Z";
  const R2X: EspRevision = { ...R2, inError: { byName: "Ana Agent", at: MARKED_AT, reason: "Typed from the wrong listing's notice." } };
  const R3 = rev(3, 1280000, 1320000, "2026-11-02", "2026-11-02T01:00:00Z");

  it("reads who marked it, when and why off the database row", () => {
    const r = revisionFrom({
      revision_no: 2,
      esp_low: 1250000,
      esp_high: 1300000,
      notice_given_on: "2026-10-28",
      notice_path: "o/p/d3/2.pdf",
      notice_file_name: null,
      entered_manually: false,
      recorded_by_name: "Dana Whitlock",
      recorded_at: R2.recordedAt,
      entered_in_error_at: MARKED_AT,
      entered_in_error_by_name: "Ana Agent",
      entered_in_error_reason: "Typed from the wrong listing's notice.",
    });
    assert.deepEqual(r?.inError, { byName: "Ana Agent", at: MARKED_AT, reason: "Typed from the wrong listing's notice." });
    assert.equal(revisionFrom({ revision_no: 1, esp_low: 1, esp_high: 2, notice_path: "x" })?.inError ?? null, null);
  });

  it("says it as Master asked: Entered in error by [name], [date]: [reason]", () => {
    assert.equal(inErrorLine(R2X.inError!), "Entered in error by Ana Agent, 29 October 2026: Typed from the wrong listing's notice.");
  });

  it("every check uses only the revisions that stand", () => {
    assert.deepEqual(revisionsInForce([R2X, R1]).map((r) => r.no), [1]);
    assert.deepEqual(revisionsInForce([R3, R2X, R1]).map((r) => r.no), [1, 3]);
    assert.deepEqual(revisionsInForce([{ ...R1, inError: R2X.inError }, R2X]), []);
    // The card's own Revision 1 is never made up while the rows are all marked.
    assert.equal(revisionsInForce(revisionsOrCard([R2X], { evidence_path: "x", data: { espRevised: true, revisedEspLow: 1, revisedEspHigh: 2 } })).length, 0);
  });

  it("stays on the card, struck through and marked, and the one before it is the latest again", () => {
    const v = espVersions(ORIGINAL, [R1, R2X]);
    assert.deepEqual(
      v.map((x) => [x.label, x.pill, x.latest, x.inError ?? false]),
      [
        ["Revision 2", IN_ERROR_PILL, false, true],
        ["Revision 1", LATEST_PILL, true, false],
        ["Original ESP", "Replaced 14 Oct", false, false],
      ],
    );
    assert.deepEqual(v[0].inErrorLines, ["Entered in error by Ana Agent, 29 October 2026: Typed from the wrong listing's notice."]);
    // Its own details stay, as recorded.
    assert.deepEqual(v[0].lines, ["Notice given 28 October 2026", "Recorded by Dana Whitlock, 28 Oct, 4:12pm"]);
    assert.equal(v[0].revisionNo, 2);
    assert.equal(v[0].file?.path, "o/p/d3/2.pdf");
  });

  it("a later revision replaces the one before the mark, never the one marked", () => {
    const v = espVersions(ORIGINAL, [R1, R2X, R3]);
    assert.deepEqual(
      v.map((x) => [x.label, x.pill]),
      [
        ["Revision 3", LATEST_PILL],
        ["Revision 2", IN_ERROR_PILL],
        ["Revision 1", "Replaced 2 Nov"],
        ["Original ESP", "Replaced 14 Oct"],
      ],
    );
  });

  it("every revision marked: the original ESP is used for checks again", () => {
    const v = espVersions(ORIGINAL, [{ ...R1, inError: R2X.inError }, R2X]);
    assert.deepEqual(v.map((x) => [x.label, x.pill]), [
      ["Revision 2", IN_ERROR_PILL],
      ["Revision 1", IN_ERROR_PILL],
      ["Original ESP", LATEST_PILL],
    ]);
    assert.equal(v.filter((x) => x.latest).length, 1);
    assert.match(ALL_IN_ERROR_HELP, /stay on the file, struck through, and no check uses them/);
  });

  it("says when the approval was cancelled by recording it, and by marking it", () => {
    const cancellations = [
      { becauseItemKey: "d3", cancelledAt: R2.recordedAt },
      { becauseItemKey: "d3", cancelledAt: MARKED_AT },
      { becauseItemKey: "a4", cancelledAt: "2026-10-20T00:00:00Z" },
    ];
    assert.deepEqual(cancelledApprovalLines(R2X, cancellations), [
      "Recording this revision cancelled the price statement approval on 28 October 2026. Marking it entered in error doesn't bring that approval back.",
      "Marking it entered in error cancelled the price statement approval on 29 October 2026. Approve the price statement again against the ESP now on file.",
    ]);
    // No approval to cancel then: nothing said.
    assert.deepEqual(cancelledApprovalLines(R2X, [{ becauseItemKey: "a4", cancelledAt: R2.recordedAt }]), []);
    const v = espVersions(ORIGINAL, [R1, R2X], cancellations.slice(0, 1));
    assert.equal(v[0].inErrorLines?.length, 2);
    assert.match(v[0].inErrorLines?.[1] ?? "", /^Recording this revision cancelled/);
    // Marked a minute after it was recorded: each cancellation is said once, for what it was.
    const quick: EspRevision = { ...R2, inError: { byName: "Ana Agent", at: "2026-10-28T05:13:00Z", reason: "Wrong notice." } };
    const once = cancelledApprovalLines(quick, [{ becauseItemKey: "d3", cancelledAt: "2026-10-28T05:13:00Z" }]);
    assert.equal(once.length, 1);
    assert.match(once[0], /^Marking it entered in error cancelled/);
  });

  it("the audit pack keeps it, labelled, and names the latest that stands", () => {
    const rows = espPackRows({ low: 1400000, high: 1450000, agreementDate: "2026-10-02", agreementPath: "o/p/a3/a.pdf" }, [R2X, R1]);
    assert.deepEqual(
      rows.map((r) => r.version),
      ["Original", "Revision 1 (latest)", "Revision 2 (entered in error)"],
    );
    assert.equal(rows[2].evidencePath, "o/p/d3/2.pdf");
  });

  it("an approval cancelled by marking one says so in the pack", () => {
    assert.equal(
      cancelledBecause({ because: "esp_changed", becauseItemKey: "d3", cancelledAt: MARKED_AT }, [R1, R2X]),
      "Revision 2 marked entered in error",
    );
    assert.equal(
      cancelledBecause({ because: "esp_changed", becauseItemKey: "d3", cancelledAt: R2.recordedAt }, [R1, R2X]),
      "Revision 2 recorded",
    );
  });
});
