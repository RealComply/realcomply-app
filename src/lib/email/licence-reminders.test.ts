import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runLicenceReminders,
  sendLicenceReminderTest,
  type LicenceReminderDeps,
} from "@/lib/email/licence-reminders";
import { dueThreshold, nextReminderDate, REMINDER_THRESHOLDS } from "@/lib/licence-reminders";
import { decideLicenceRead, sanitiseLicenceRead } from "@/lib/licence-read";
import { fakeSupabase } from "@/lib/testing/fake-supabase";
import type { SendEmailInput } from "@/lib/email/send";
import type { Agency, Profile } from "@/lib/types";

type Row = Record<string, unknown>;

function world(expiry: string | null) {
  const tables: Record<string, Row[]> = {
    agencies: [{ id: "ag1", name: "Cass Property", corporation_licence_expiry: null }],
    profiles: [
      { id: "lic", agency_id: "ag1", email: "lic@example.com", full_name: "Lee Licensee", is_licensee_in_charge: true, archived_at: null, licence_expiry: null, licence_type: "class_1", licence_number: null },
      { id: "jane", agency_id: "ag1", email: "jane@example.com", full_name: "Jane Smith", is_licensee_in_charge: false, archived_at: null, licence_expiry: expiry, licence_type: "class_2", licence_number: "20123456" },
    ],
    licence_reminders: [],
  };
  const sent: SendEmailInput[] = [];
  const deps: LicenceReminderDeps = {
    supabase: fakeSupabase(tables),
    send: async (input) => {
      sent.push(input);
      return true;
    },
  };
  return { tables, sent, deps };
}

const day = (iso: string) => new Date(`${iso}T21:30:00Z`);

// ── The schedule ────────────────────────────────────────────────────────────

test("the schedule is 90, 30, 14, 7 and 0 days", () => {
  assert.deepEqual([...REMINDER_THRESHOLDS], [90, 30, 14, 7, 0]);
});

test("the 14-day threshold fires at 14 days, and only the most urgent crossed one is sent", () => {
  assert.equal(dueThreshold("2026-10-15", new Date("2026-10-01T00:00:00Z")), 14);
  assert.equal(dueThreshold("2026-10-16", new Date("2026-10-01T00:00:00Z")), 30);
  // Entered late, 10 days out: one reminder (the 14), not the 90, 30 and 14.
  assert.equal(dueThreshold("2026-10-11", new Date("2026-10-01T00:00:00Z")), 14);
  // After the 30 has gone, the next promised date is the 14-day one.
  assert.equal(nextReminderDate("2026-10-20", new Date("2026-10-01T00:00:00Z")), "2026-10-06");
});

test("the 14-day reminder is sent once, then the 7-day one later", async () => {
  const { tables, sent, deps } = world("2026-10-15");
  await runLicenceReminders(day("2026-10-01"), deps);
  await runLicenceReminders(day("2026-10-02"), deps); // same threshold, nothing new
  assert.deepEqual(tables.licence_reminders.map((r) => r.threshold_days), [14]);
  assert.equal(sent.length, 2); // holder + licensee
  await runLicenceReminders(day("2026-10-08"), deps);
  assert.deepEqual(tables.licence_reminders.map((r) => r.threshold_days), [14, 7]);
});

// ── After a read ────────────────────────────────────────────────────────────

test("an expiry date saved from a read is picked up by the schedule with no extra step", async () => {
  const { tables, sent, deps } = world(null);
  const decision = decideLicenceRead({
    read: sanitiseLicenceRead({ documentIs: "licence", holderName: "Jane Smith", licenceType: "class_2", licenceNumber: "20123456", expiryDate: "2027-01-09" }),
    subject: "person",
    expectedNames: ["Jane Smith"],
    previous: null,
    by: "jane",
    at: "2026-10-01T00:00:00.000Z",
    fileName: "licence.jpg",
    today: new Date("2026-10-01T00:00:00Z"),
  });
  assert.equal(decision.kind, "save");
  if (decision.kind !== "save") return;
  // What the upload action writes to the profile.
  tables.profiles[1].licence_expiry = decision.values.expiry;

  // The card's "Next reminder" line, computed from the saved date.
  assert.equal(nextReminderDate(decision.values.expiry as string, new Date("2026-10-01T00:00:00Z")), "2026-10-11");
  await runLicenceReminders(day("2026-10-01"), deps); // 100 days out: nothing yet
  assert.equal(sent.length, 0);
  await runLicenceReminders(day("2026-10-11"), deps); // 90 days out
  assert.equal(tables.licence_reminders.length, 1);
  assert.equal(tables.licence_reminders[0].threshold_days, 90);
  assert.equal(tables.licence_reminders[0].expiry_date, "2027-01-09");
  assert.deepEqual(sent.map((s) => s.to).sort(), ["jane@example.com", "lic@example.com"]);
});

// ── Renewal ─────────────────────────────────────────────────────────────────

test("renewal stops reminders for the old date and starts the schedule again for the new one", async () => {
  const { tables, sent, deps } = world("2026-10-31");
  await runLicenceReminders(day("2026-10-01"), deps); // 30 days before the old date
  assert.deepEqual(tables.licence_reminders.map((r) => [r.expiry_date, r.threshold_days]), [["2026-10-31", 30]]);

  // The renewed licence is uploaded and read: the new, later date is saved.
  tables.profiles[1].licence_expiry = "2029-10-31";
  const before = sent.length;

  // Every remaining threshold of the OLD date passes in silence.
  for (const d of ["2026-10-17", "2026-10-24", "2026-10-31", "2026-11-01"]) {
    await runLicenceReminders(day(d), deps);
  }
  assert.equal(sent.length, before);
  assert.equal(tables.licence_reminders.filter((r) => r.expiry_date === "2026-10-31").length, 1);

  // And the new date's schedule begins from the top: 90 days before it.
  await runLicenceReminders(day("2029-08-02"), deps);
  assert.deepEqual(
    tables.licence_reminders.filter((r) => r.expiry_date === "2029-10-31").map((r) => r.threshold_days),
    [90],
  );
});

// ── The test reminder ───────────────────────────────────────────────────────

test("a test reminder goes to the team member and the licensee, labelled, and records nothing", async () => {
  const { tables } = world("2027-03-01");
  const sent: SendEmailInput[] = [];
  const result = await sendLicenceReminderTest(
    {
      member: tables.profiles[1] as unknown as Profile,
      licensee: tables.profiles[0] as unknown as Profile,
      agency: tables.agencies[0] as unknown as Agency,
      today: new Date("2026-10-01T00:00:00Z"),
    },
    async (input) => {
      sent.push(input);
      return true;
    },
  );
  assert.deepEqual(result.sentTo, ["jane@example.com", "lic@example.com"]);
  assert.ok(sent.every((s) => s.subject.startsWith("[Test]")));
  assert.ok(sent.every((s) => s.text.includes("This is a test")));
  assert.ok(sent.every((s) => s.text.includes("NSW Fair Trading")));
  assert.ok(sent.every((s) => !/compliant/i.test(s.text)));
  assert.equal(tables.licence_reminders.length, 0);
});
