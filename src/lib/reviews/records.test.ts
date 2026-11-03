import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPLAINT_SIGN_OFF_WORDS,
  complaintAwaitsSignOff,
  complaintRecordLines,
  giftReviewedLine,
} from "@/lib/reviews/records";

// Who and when, for gift reviews and complaints (Adam, 3 Nov 2026; 0108).

test("the sign-off is Adam's words, with no em dash", () => {
  assert.equal(COMPLAINT_SIGN_OFF_WORDS, "I've reviewed how this complaint was handled and resolved.");
});

test("a gift review says who and when, and an earlier one says nothing", () => {
  assert.equal(
    giftReviewedLine({ status: "reviewed", reviewed_by_name: "Lee Licensee", reviewed_at: "2026-11-02T22:00:00Z" }),
    "Reviewed by Lee Licensee, 3 November 2026",
  );
  assert.equal(giftReviewedLine({ status: "reviewed", reviewed_by_name: null, reviewed_at: null }), null);
  assert.equal(giftReviewedLine({ status: "flagged", reviewed_by_name: null, reviewed_at: null }), null);
});

test("a complaint's lines: under review, resolved, then waiting for or given the sign-off", () => {
  const base = {
    under_review_by_name: "Max Manager",
    under_review_at: "2026-11-01T22:00:00Z",
    resolved_by_name: null,
    resolved_at: null,
    signed_off_name: null,
    signed_off_at: null,
  };
  assert.deepEqual(complaintRecordLines({ ...base, status: "open", under_review_by_name: null, under_review_at: null }), []);
  assert.deepEqual(complaintRecordLines({ ...base, status: "under_review" }), ["Under review by Max Manager, 2 November 2026"]);
  const resolved = { ...base, status: "resolved" as const, resolved_by_name: "Max Manager", resolved_at: "2026-11-02T22:00:00Z" };
  assert.deepEqual(complaintRecordLines(resolved), [
    "Under review by Max Manager, 2 November 2026",
    "Resolved by Max Manager, 3 November 2026",
    "Waiting for the licensee's sign-off",
  ]);
  assert.equal(complaintAwaitsSignOff({ status: "resolved", signed_off_at: null }), true);
  const signed = { ...resolved, signed_off_name: "Lee Licensee", signed_off_at: "2026-11-03T01:00:00Z" };
  assert.equal(complaintRecordLines(signed).at(-1), "Signed off by Lee Licensee, 3 November 2026");
  assert.equal(complaintAwaitsSignOff({ status: "resolved", signed_off_at: signed.signed_off_at }), false);
  // Resolved before 0108: no names to give, still waiting for the sign-off.
  assert.deepEqual(
    complaintRecordLines({ ...base, status: "resolved", under_review_by_name: null, under_review_at: null }),
    ["Waiting for the licensee's sign-off"],
  );
});

test("signed in a monthly pack, the record says which (0109)", () => {
  assert.equal(
    giftReviewedLine({ status: "reviewed", reviewed_by_name: "Lee Licensee", reviewed_at: "2026-11-02T22:00:00Z" }, "2026-10-01"),
    "Reviewed by Lee Licensee, 3 November 2026, in the October pack",
  );
  const signed = {
    status: "resolved" as const,
    under_review_by_name: null,
    under_review_at: null,
    resolved_by_name: null,
    resolved_at: null,
    signed_off_name: "Lee Licensee",
    signed_off_at: "2026-11-02T22:00:00Z",
  };
  assert.equal(complaintRecordLines(signed, "2026-10-01").at(-1), "Signed off by Lee Licensee, 3 November 2026, in the October pack");
});

