import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reconciliationProgress,
  reconciliationRecordsFor,
  reconciliationReminderFor,
  statusFor,
} from "@/lib/trust-account";

const doc = (id: string, createdAt: string, account = "acc1") => ({
  id,
  trust_account_id: account,
  period_month: "2026-09-01",
  created_at: createdAt,
});

test("records: the newest upload for a month is the one that counts", () => {
  const records = reconciliationRecordsFor(
    "acc1",
    [doc("old", "2026-10-01T05:00:00Z"), doc("new", "2026-10-02T05:00:00Z"), doc("other", "2026-10-03T05:00:00Z", "acc2")],
    [{ document_id: "old", signed_at: "2026-10-01T06:00:00Z" }],
  );
  const sept = records.get("2026-09-01");
  assert.equal(sept?.documentId, "new");
  assert.equal(reconciliationProgress(sept), "filed_unsigned");
});

test("progress and reminder kind for each state", () => {
  const signed = reconciliationRecordsFor(
    "acc1",
    [doc("d", "2026-10-01T05:00:00Z")],
    [{ document_id: "d", signed_at: "2026-10-01T05:37:00Z" }],
  ).get("2026-09-01");
  assert.equal(reconciliationReminderFor(reconciliationProgress(signed)), "none");

  const filed = reconciliationRecordsFor(
    "acc1",
    [doc("d", "2026-10-01T05:00:00Z")],
    [{ document_id: "d", signed_at: null }],
  ).get("2026-09-01");
  assert.equal(reconciliationReminderFor(reconciliationProgress(filed)), "ready_for_signoff");

  assert.equal(reconciliationReminderFor(reconciliationProgress(undefined)), "full");
});

test("statusFor is unchanged by the refactor", () => {
  const today = new Date("2026-10-07T00:00:00Z");
  const filed = reconciliationRecordsFor("acc1", [doc("d", "2026-10-01T05:00:00Z")], []).get("2026-09-01");
  assert.equal(statusFor("2026-09-01", undefined, today), "awaiting_upload");
  assert.equal(statusFor("2026-09-01", filed, today), "awaiting_signature");
  assert.equal(statusFor("2026-09-01", undefined, new Date("2026-10-25T00:00:00Z")), "overdue");
  assert.equal(statusFor("2026-10-01", undefined, today), "future");
});
