import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPIRY_SOURCES, runLicenceReminders, type LicenceReminderDeps } from "@/lib/email/licence-reminders";
import { decideInsuranceRead, sanitiseInsuranceRead } from "@/lib/insurance-read";
import { fakeSupabase } from "@/lib/testing/fake-supabase";
import type { SendEmailInput } from "@/lib/email/send";

// Expiry reminders for everything with an expiry date (Adam's brief, 22 Oct
// 2026): insurance on the same five steps as licences, read from the
// uploaded certificate, once per step, and a renewal starts a fresh cycle.

type Row = Record<string, unknown>;

function office(agency: Row = {}, policies: Row[] = []) {
  const tables: Record<string, Row[]> = {
    agencies: [
      {
        id: "ag1",
        name: "Made-up Realty",
        corporation_licence_expiry: null,
        pi_expiry: null,
        cyber_expiry: null,
        icare_expiry: null,
        ...agency,
      },
    ],
    profiles: [
      { id: "lic", agency_id: "ag1", email: "lic@example.com", full_name: "Lee Licensee", is_licensee_in_charge: true, archived_at: null, licence_expiry: null, licence_type: "class_1", licence_number: null },
      { id: "jane", agency_id: "ag1", email: "jane@example.com", full_name: "Jane Smith", is_licensee_in_charge: false, archived_at: null, licence_expiry: null, licence_type: "class_2", licence_number: "20123456" },
    ],
    insurance_policies: policies,
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

// Every morning from `from` to `to`, run twice each time (a retried cron).
async function everyMorning(from: string, to: string, deps: LicenceReminderDeps) {
  for (let d = new Date(`${from}T21:30:00Z`); d <= new Date(`${to}T21:30:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    await runLicenceReminders(new Date(d), deps);
    await runLicenceReminders(new Date(d), deps);
  }
}

const sentOn = (tables: Record<string, Row[]>) =>
  tables.licence_reminders.map((r) => [r.subject_kind, r.expiry_date, r.threshold_days]);

test("every kind of expiring item is on the list", () => {
  assert.deepEqual(
    EXPIRY_SOURCES.map((s) => s.kind),
    ["profile", "corporation", "insurance_pi", "insurance_cyber", "insurance_icare", "insurance_policy"],
  );
});

test("a PI certificate read 90 days out sends the 90, 60, 30, 14 and 7-day emails, each once, to the licensee only", async () => {
  const { tables, sent, deps } = office();

  // The certificate is uploaded and read. What the upload action saves.
  const decision = decideInsuranceRead({
    read: sanitiseInsuranceRead({
      documentIs: "certificate_of_currency",
      covers: ["professional_indemnity"],
      insurer: "Made-up Underwriting Ltd",
      policyNumber: "PI-1001",
      expiryDate: "2027-01-29",
    }),
    policy: "pi",
    by: "lic",
    at: "2026-10-31T00:00:00.000Z",
    fileName: "pi-coc.pdf",
    today: new Date("2026-10-31T00:00:00Z"),
  });
  assert.equal(decision.kind, "save");
  if (decision.kind !== "save") return;
  Object.assign(tables.agencies[0], { pi_expiry: decision.values.expiry, pi_insurer: decision.values.insurer, pi_policy_number: decision.values.policyNumber });

  // 2026-10-31 is 90 days before 2027-01-29.
  await everyMorning("2026-10-31", "2027-02-05", deps);
  assert.deepEqual(tables.licence_reminders.map((r) => r.threshold_days), [90, 60, 30, 14, 7]);
  assert.ok(tables.licence_reminders.every((r) => r.subject_kind === "insurance_pi"));
  assert.equal(sent.length, 5);
  assert.ok(sent.every((s) => s.to === "lic@example.com"));
  assert.equal(sent[0].subject, "Professional indemnity insurance expires in 90 days");
  assert.ok(sent[0].text.includes("Made-up Underwriting Ltd"));
  assert.ok(sent[0].text.includes("PI-1001"));
  assert.ok(sent.every((s) => s.text.includes("Insurance register")));
  assert.ok(sent.every((s) => !/compliant/i.test(s.text)));
});

test("the steps go out on the right mornings", async () => {
  const { tables, sent, deps } = office({ cyber_expiry: "2027-03-01" });
  const days: string[] = [];
  for (let d = new Date("2026-11-20T21:30:00Z"); d <= new Date("2027-03-01T21:30:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
    const before = sent.length;
    await runLicenceReminders(new Date(d), deps);
    if (sent.length > before) days.push(d.toISOString().slice(0, 10));
  }
  // 90, 60, 30, 14 and 7 days before 1 March 2027.
  assert.deepEqual(days, ["2026-12-01", "2026-12-31", "2027-01-30", "2027-02-15", "2027-02-22"]);
  assert.deepEqual(tables.licence_reminders.map((r) => r.subject_kind), Array(5).fill("insurance_cyber"));
});

test("a renewed certificate stops the old cycle and starts the new one", async () => {
  const { tables, sent, deps } = office({ icare_expiry: "2026-12-31" });
  await runLicenceReminders(new Date("2026-11-01T21:30:00Z"), deps); // 60 days out
  assert.deepEqual(sentOn(tables), [["insurance_icare", "2026-12-31", 60]]);

  // The renewed certificate is uploaded and read: a later date is saved.
  tables.agencies[0].icare_expiry = "2027-12-31";
  const before = sent.length;
  await everyMorning("2026-11-02", "2027-01-05", deps); // the old date's 30, 14, 7 pass in silence
  assert.equal(sent.length, before);

  // The new date's schedule starts from the top.
  await runLicenceReminders(new Date("2027-10-02T21:30:00Z"), deps); // 90 days before
  assert.deepEqual(sentOn(tables), [
    ["insurance_icare", "2026-12-31", 60],
    ["insurance_icare", "2027-12-31", 90],
  ]);
});

test("added policies are reminded one by one, and a removed one is not", async () => {
  const { tables, sent, deps } = office({}, [
    { id: "pol-a", agency_id: "ag1", kind: "public_liability", name: null, insurer: "Made-up Liability Ltd", policy_number: "PL-1", expiry: "2027-01-29", removed_at: null },
    { id: "pol-b", agency_id: "ag1", kind: "other", name: "Office contents", insurer: null, policy_number: null, expiry: "2027-01-29", removed_at: null },
    { id: "pol-c", agency_id: "ag1", kind: "other", name: "Old van", insurer: null, policy_number: null, expiry: "2027-01-29", removed_at: "2026-10-01T00:00:00Z" },
  ]);
  await runLicenceReminders(new Date("2026-10-31T21:30:00Z"), deps);
  await runLicenceReminders(new Date("2026-10-31T21:30:00Z"), deps);
  // Same kind, same date, same step: still one each, told apart by subject_id.
  assert.deepEqual(
    tables.licence_reminders.map((r) => [r.subject_kind, r.subject_id, r.threshold_days]),
    [
      ["insurance_policy", "pol-a", 90],
      ["insurance_policy", "pol-b", 90],
    ],
  );
  assert.deepEqual(sent.map((s) => s.subject), [
    "Public liability expires in 90 days",
    "Office contents expires in 90 days",
  ]);
});

test("a person's licence row still writes no subject_id, exactly as before 0088", async () => {
  const { tables, deps } = office();
  tables.profiles[1].licence_expiry = "2027-01-29";
  await runLicenceReminders(new Date("2026-10-31T21:30:00Z"), deps);
  assert.equal(tables.licence_reminders.length, 1);
  assert.equal(tables.licence_reminders[0].profile_id, "jane");
  assert.equal("subject_id" in tables.licence_reminders[0], false);
});

test("the corporation licence follows the same five steps, to the licensee", async () => {
  const { tables, sent, deps } = office({ corporation_licence_expiry: "2027-01-29" });
  await everyMorning("2026-10-25", "2027-02-05", deps);
  assert.deepEqual(tables.licence_reminders.map((r) => r.threshold_days), [90, 60, 30, 14, 7]);
  assert.ok(sent.every((s) => s.to === "lic@example.com"));
});

test("an office whose subscription has ended gets no insurance reminders", async () => {
  const { tables, sent, deps } = office({ pi_expiry: "2027-01-29", ended_at: "2026-10-20T00:00:00Z" });
  await runLicenceReminders(new Date("2026-10-31T21:30:00Z"), deps);
  assert.equal(sent.length, 0);
  assert.equal(tables.licence_reminders.length, 0);
});
