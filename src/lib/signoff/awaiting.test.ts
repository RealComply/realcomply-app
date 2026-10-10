import { test } from "node:test";
import assert from "node:assert/strict";
import { documentsWaitingOn, notAskedToSign, notNeededReason, stillWaiting } from "@/lib/signoff/awaiting";

// Who a sign-off document is still waiting on (check of 10 Oct 2026).

const SIGNED = "2026-10-10T01:00:00Z";

test("a licensee-only document signed by one licensee is not waiting on the other", () => {
  const rows = [
    { document_id: "rec", signer_id: "lic1", signed_at: SIGNED },
    { document_id: "rec", signer_id: "lic2", signed_at: null },
  ];
  assert.equal(notNeededReason(rows[1], "licensee_only", rows), "another_licensee_signed");
  assert.equal(stillWaiting(rows[1], "licensee_only", rows), false);
  assert.equal(documentsWaitingOn("lic2", rows, new Set(["rec"])), 0);
});

test("a licensee-only document nobody has signed is waiting on every licensee", () => {
  const rows = [
    { document_id: "rec", signer_id: "lic1", signed_at: null },
    { document_id: "rec", signer_id: "lic2", signed_at: null },
  ];
  assert.equal(documentsWaitingOn("lic1", rows, new Set(["rec"])), 1);
  assert.equal(documentsWaitingOn("lic2", rows, new Set(["rec"])), 1);
});

test("on an all-staff document, someone else signing does not let you off", () => {
  const rows = [
    { document_id: "sg", signer_id: "lic1", signed_at: SIGNED },
    { document_id: "sg", signer_id: "ag1", signed_at: null },
  ];
  assert.equal(notNeededReason(rows[1], "all_staff", rows), null);
  assert.equal(documentsWaitingOn("ag1", rows, new Set()), 1);
});

test("a signature on a different licensee-only document does not count for this one", () => {
  const rows = [
    { document_id: "july", signer_id: "lic1", signed_at: SIGNED },
    { document_id: "aug", signer_id: "lic2", signed_at: null },
  ];
  assert.equal(documentsWaitingOn("lic2", rows, new Set(["july", "aug"])), 1);
});

test("someone who left is not waited on, and their row is not counted as signed", () => {
  const rows = [
    { document_id: "sg", signer_id: "ag1", signed_at: SIGNED },
    { document_id: "sg", signer_id: "gone", signed_at: null },
  ];
  assert.equal(notNeededReason(rows[1], "all_staff", rows, new Set(["gone"])), "left_the_office");
  assert.equal(stillWaiting(rows[1], "all_staff", rows, new Set(["gone"])), false);
});

test("a signature given before leaving stays a signature", () => {
  const row = { document_id: "sg", signer_id: "gone", signed_at: SIGNED };
  assert.equal(notNeededReason(row, "all_staff", [row], new Set(["gone"])), null);
});

test("people not asked to sign: present staff with no row, never anyone who left", () => {
  const people = [
    { id: "lic", archived_at: null },
    { id: "ag1", archived_at: null },
    { id: "ag2", archived_at: null },
    { id: "gone", archived_at: "2026-09-01T00:00:00Z" },
  ];
  const rows = [{ signer_id: "ag1" }];
  assert.deepEqual(
    notAskedToSign(people, rows).map((p) => p.id),
    ["lic", "ag2"],
  );
});
