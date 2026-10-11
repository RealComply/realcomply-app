import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditOwed,
  buildMonths,
  reconciliationProgress,
  reconciliationRecordsFor,
  reconciliationReminderFor,
  statusFor,
  sydneyToday,
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

test("sydneyToday is Sydney's calendar date, not UTC's", () => {
  // 21:40 UTC on the 17th is 8:40am on the 18th in Sydney (AEDT).
  assert.equal(sydneyToday(new Date("2026-10-17T21:40:00Z")).toISOString(), "2026-10-18T00:00:00.000Z");
  // And before daylight saving: 30 Sep 21:40 UTC is 7:40am on 1 Oct (AEST).
  assert.equal(sydneyToday(new Date("2026-09-30T21:40:00Z")).toISOString(), "2026-10-01T00:00:00.000Z");
  // At 9am on the 22nd in Sydney, a month due on the 21st is overdue.
  const sydney22nd9am = sydneyToday(new Date("2026-10-21T22:00:00Z"));
  assert.equal(statusFor("2026-09-01", undefined, sydney22nd9am), "overdue");
});

test("months that ended before the account opened are not owed", () => {
  const today = new Date("2026-10-10T00:00:00Z");
  const months = buildMonths("2027-06-30", new Map(), today, "2026-10-01");
  const status = Object.fromEntries(months.map((m) => [m.month, m.status]));
  assert.equal(status["2026-07-01"], "not_applicable");
  assert.equal(status["2026-08-01"], "not_applicable");
  assert.equal(status["2026-09-01"], "not_applicable");
  assert.equal(status["2026-10-01"], "future");
  assert.equal(months[0].dueOn, null);

  // Opened part way through September: September is owed.
  const mid = buildMonths("2027-06-30", new Map(), today, "2026-09-15");
  assert.equal(mid.find((m) => m.month === "2026-09-01")?.status, "awaiting_upload");

  // No date: already open, everything owed as before.
  const open = buildMonths("2027-06-30", new Map(), today);
  assert.equal(open.find((m) => m.month === "2026-07-01")?.status, "overdue");

  // Something filed for a month before opening still shows as filed.
  const filed = reconciliationRecordsFor(
    "acc1",
    [{ ...doc("d", "2026-10-01T05:00:00Z"), period_month: "2026-08-01" }],
    [],
  );
  const withFiled = buildMonths("2027-06-30", filed, today, "2026-10-01");
  assert.equal(withFiled.find((m) => m.month === "2026-08-01")?.status, "overdue");
});

test("an audit is owed for a year the account was open in", () => {
  assert.equal(auditOwed("2026-06-30", null), true);
  assert.equal(auditOwed("2026-06-30", "2026-10-01"), false);
  assert.equal(auditOwed("2026-06-30", "2026-06-30"), true);
  assert.equal(auditOwed("2027-06-30", "2026-10-01"), true);
});
