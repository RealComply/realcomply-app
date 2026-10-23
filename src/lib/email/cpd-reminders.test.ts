import { test } from "node:test";
import assert from "node:assert/strict";
import { runCpdReminders, cpdTestMessage, type CpdReminderDeps } from "@/lib/email/cpd-reminders";
import { cpdReminderDue, needsCpd, planCpdReminders, namesInWords, CPD_REMINDER_SCHEDULE_WORDS } from "@/lib/cpd-reminders";
import { renderEmailText } from "@/lib/email/layout";
import { fakeSupabase } from "@/lib/testing/fake-supabase";
import type { SendEmailInput } from "@/lib/email/send";

type Row = Record<string, unknown>;

const person = (id: string, over: Row = {}): Row => ({
  id,
  agency_id: "ag1",
  email: `${id}@example.com`,
  full_name: `${id[0].toUpperCase()}${id.slice(1)} Person`,
  is_agent: true,
  is_assistant: false,
  is_licensee_in_charge: false,
  licence_type: null,
  archived_at: null,
  ...over,
});

function world(rows: { agencies?: Row[]; profiles: Row[]; signoffs?: string[] }) {
  const tables: Record<string, Row[]> = {
    agencies: rows.agencies ?? [{ id: "ag1", name: "Made Up Realty", plan: "office_1", ended_at: null }],
    profiles: rows.profiles,
    cpd_year_signoffs: (rows.signoffs ?? []).map((pid) => ({
      id: `s-${pid}`,
      agency_id: "ag1",
      profile_id: pid,
      cpd_year_start: "2026-07-01",
    })),
    cpd_reminders: [],
  };
  const sent: SendEmailInput[] = [];
  const deps: CpdReminderDeps = {
    supabase: fakeSupabase(tables),
    send: async (input) => {
      sent.push(input);
      return true;
    },
  };
  return { tables, sent, deps };
}

// 21:45 UTC the evening before is the morning of the date in Sydney.
const sydneyMorning = (iso: string) => {
  const d = new Date(`${iso}T21:45:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
};

const office = () => [
  person("lee", { is_licensee_in_charge: true, licence_type: "class_1" }),
  person("jo"),
  person("sam", { licence_type: "class_2" }),
];

// ── The dates ───────────────────────────────────────────────────────────────

test("the four send dates, Sydney time, and nothing in between", () => {
  assert.equal(CPD_REMINDER_SCHEDULE_WORDS, "1 April, 1 May, 1 June and 23 June");
  for (const d of ["2027-04-01", "2027-05-01", "2027-06-01", "2027-06-23"]) {
    assert.deepEqual(cpdReminderDue(d), { sendDate: d, cpdYearStart: "2026-07-01", cpdYearEnd: "2027-06-30" });
  }
  for (const d of ["2026-10-19", "2027-03-31", "2027-04-05", "2027-05-20", "2027-06-27", "2027-07-01"]) {
    assert.equal(cpdReminderDue(d), null, d);
  }
});

test("a missed morning still sends that date for three days, as the same date", () => {
  assert.equal(cpdReminderDue("2027-04-04")?.sendDate, "2027-04-01");
  assert.equal(cpdReminderDue("2027-06-26")?.sendDate, "2027-06-23");
  assert.equal(cpdReminderDue("2027-06-22"), null);
});

test("not a send date: nothing sent, nothing written", async () => {
  const { tables, sent, deps } = world({ profiles: office() });
  const r = await runCpdReminders(sydneyMorning("2027-04-10"), deps);
  assert.equal(r.sendDate, null);
  assert.equal(sent.length, 0);
  assert.equal(tables.cpd_reminders.length, 0);
});

// ── Who gets one (the brief's tests) ────────────────────────────────────────

test("a person not done gets the reminder; a person ticked done gets nothing; the summary lists only the outstanding", async () => {
  const { tables, sent, deps } = world({ profiles: office(), signoffs: ["sam"] });
  await runCpdReminders(sydneyMorning("2027-04-01"), deps);

  const to = (addr: string) => sent.filter((m) => m.to === addr);
  assert.equal(to("jo@example.com").length, 1);
  assert.equal(to("jo@example.com")[0].subject, "Your CPD for 2026-27 is due by 30 June");
  assert.equal(to("sam@example.com").length, 0, "ticked done: quiet");

  // The licensee: their own reminder, and the summary of everyone else outstanding.
  const lee = to("lee@example.com").map((m) => m.subject).sort();
  assert.deepEqual(lee, ["CPD still outstanding in Made Up Realty for 2026-27", "Your CPD for 2026-27 is due by 30 June"]);
  const summary = to("lee@example.com").find((m) => m.subject.startsWith("CPD still"))!;
  assert.match(summary.text, /These people's CPD for the year ending 30 June 2027 isn't marked as done yet: Jo Person\./);
  assert.doesNotMatch(summary.text, /Sam Person/);

  const rows = tables.cpd_reminders.map((r) => `${r.kind}:${r.profile_id}`).sort();
  assert.deepEqual(rows, ["person:jo", "person:lee", "summary:lee"]);
  assert.deepEqual(tables.cpd_reminders.find((r) => r.kind === "summary")!.outstanding, ["jo"]);
});

test("the same date doesn't send twice", async () => {
  const { tables, sent, deps } = world({ profiles: office() });
  await runCpdReminders(sydneyMorning("2027-05-01"), deps);
  const first = sent.length;
  const again = await runCpdReminders(sydneyMorning("2027-05-01"), deps);
  // A missed-run catch-up two days later is still the same date.
  await runCpdReminders(sydneyMorning("2027-05-03"), deps);
  assert.equal(sent.length, first);
  assert.equal(again.alreadySent, 4); // three people and the summary
  assert.equal(tables.cpd_reminders.length, 4);
  // The next date is a new reminder.
  await runCpdReminders(sydneyMorning("2027-06-01"), deps);
  assert.equal(sent.length, first * 2);
});

test("done means quiet: ticked between dates, nothing more that year", async () => {
  const { tables, sent, deps } = world({ profiles: office() });
  await runCpdReminders(sydneyMorning("2027-04-01"), deps);
  tables.cpd_year_signoffs.push({ id: "s-jo", agency_id: "ag1", profile_id: "jo", cpd_year_start: "2026-07-01" });
  sent.length = 0;
  await runCpdReminders(sydneyMorning("2027-05-01"), deps);
  assert.equal(sent.filter((m) => m.to === "jo@example.com").length, 0);
  const summary = sent.find((m) => m.subject.startsWith("CPD still"))!;
  assert.match(summary.text, /yet: Sam Person\./);
});

test("an archived person gets nothing and isn't on the summary", async () => {
  const { sent, deps } = world({
    profiles: [...office(), person("pat", { archived_at: "2026-09-01T00:00:00Z" })],
  });
  await runCpdReminders(sydneyMorning("2027-04-01"), deps);
  assert.equal(sent.filter((m) => m.to === "pat@example.com").length, 0);
  assert.doesNotMatch(sent.find((m) => m.subject.startsWith("CPD still"))!.text, /Pat/);
});

test("an agent on their own plan gets one email, not two", async () => {
  const { sent, deps } = world({
    agencies: [{ id: "ag1", name: "Jo Solo", plan: "agent_1", ended_at: null }],
    profiles: [person("jo", { is_licensee_in_charge: true })],
  });
  await runCpdReminders(sydneyMorning("2027-04-01"), deps);
  assert.deepEqual(sent.map((m) => [m.to, m.subject]), [["jo@example.com", "Your CPD for 2026-27 is due by 30 June"]]);
});

test("a licensee who is the only one outstanding gets their own reminder only", async () => {
  const { sent, deps } = world({ profiles: office(), signoffs: ["jo", "sam"] });
  await runCpdReminders(sydneyMorning("2027-04-01"), deps);
  assert.deepEqual(sent.map((m) => m.subject), ["Your CPD for 2026-27 is due by 30 June"]);
});

test("nobody outstanding: no summary and no reminders", async () => {
  const { sent, tables, deps } = world({ profiles: office(), signoffs: ["lee", "jo", "sam"] });
  const r = await runCpdReminders(sydneyMorning("2027-06-23"), deps);
  assert.equal(sent.length, 0);
  assert.equal(tables.cpd_reminders.length, 0);
  assert.equal(r.done, 3);
});

test("an office whose subscription has ended gets nothing", async () => {
  const { sent, deps } = world({
    agencies: [{ id: "ag1", name: "Gone", plan: "office_1", ended_at: "2027-03-01T00:00:00Z" }],
    profiles: office(),
  });
  await runCpdReminders(sydneyMorning("2027-04-01"), deps);
  assert.equal(sent.length, 0);
});

test("who needs CPD: a licence or certificate on file, or an agent or the licensee in charge", () => {
  const base = { id: "x", email: "x@example.com", full_name: "X", archived_at: null };
  assert.equal(needsCpd({ ...base, is_agent: true, is_assistant: false, is_licensee_in_charge: false, licence_type: null }), true);
  assert.equal(needsCpd({ ...base, is_agent: false, is_assistant: true, is_licensee_in_charge: false, licence_type: "certificate_of_registration" }), true);
  assert.equal(needsCpd({ ...base, is_agent: false, is_assistant: true, is_licensee_in_charge: false, licence_type: null }), false);
  assert.equal(needsCpd({ ...base, archived_at: "2026-01-01", is_agent: true, is_assistant: false, is_licensee_in_charge: false, licence_type: "class_2" }), false);
});

test("an assistant with nothing on file isn't reminded or listed", () => {
  const plan = planCpdReminders({
    plan: "office_1",
    profiles: [
      person("lee", { is_licensee_in_charge: true }) as never,
      person("ann", { is_agent: false, is_assistant: true }) as never,
    ],
    doneIds: new Set(["lee"]),
  });
  assert.deepEqual(plan.people, []);
  assert.deepEqual(plan.summaries, []);
});

// ── Wording ─────────────────────────────────────────────────────────────────

test("the wording: plain English, no em dashes, never 'compliant'", () => {
  for (const version of ["person", "summary"] as const) {
    const { subject, doc } = cpdTestMessage(version, "2026-07-01");
    const text = `${subject}\n${renderEmailText(doc)}`;
    assert.doesNotMatch(text, /—/, `${version}: em dash`);
    assert.doesNotMatch(text, /compliant/i, `${version}: compliant`);
    assert.match(text, /Diligence support, not legal advice\./);
  }
  const person = renderEmailText(cpdTestMessage("person", "2026-07-01").doc);
  assert.match(person, /Hi Jo,/);
  assert.match(
    person,
    /Your CPD for the year ending 30 June 2027 isn't marked as done in RealComply yet\. Once you've completed it, upload your certificates and tick the year off on your CPD page so these reminders stop\./,
  );
  assert.match(person, /Go to my CPD/);
  const summary = renderEmailText(cpdTestMessage("summary", "2026-07-01").doc);
  assert.match(summary, /These people's CPD for the year ending 30 June 2027 isn't marked as done yet: Jo Bennett and Sam Lee\./);
  assert.match(summary, /Go to CPD/);
  assert.equal(cpdTestMessage("summary", "2026-07-01").subject, "[Test] CPD still outstanding in Made Up Realty (example) for 2026-27");
});

test("names in words", () => {
  assert.equal(namesInWords(["Jo"]), "Jo");
  assert.equal(namesInWords(["Jo", "Sam"]), "Jo and Sam");
  assert.equal(namesInWords(["Jo", "Sam", "Pat"]), "Jo, Sam and Pat");
});
