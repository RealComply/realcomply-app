import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LATEST_PILL,
  approvalLines,
  cancelledBecause,
  espPackRows,
  espRange,
  espVersions,
  recordedLine,
  replaceWarning,
  revisionFrom,
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
