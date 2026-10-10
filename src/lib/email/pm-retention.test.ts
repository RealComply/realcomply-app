import { test } from "node:test";
import assert from "node:assert/strict";
import { runPmRetentionReminders, sydneyDate, type PmRetentionDeps } from "@/lib/email/pm-retention";
import type { SendEmailInput } from "@/lib/email/send";

// The daily 3-year file reminder (brief B4) against an in-memory database.
// Made-up agencies, people and properties only.

type Row = Record<string, unknown>;
type Result = { data: unknown; error: null };

// Like the real API, a request returns at most MAX_ROWS rows and says nothing
// about the rest.
const MAX_ROWS = 1000;

function fakeSupabase(tables: Record<string, Row[]>, opts: { failInsert?: boolean; failRead?: string } = {}) {
  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let window: [number, number] = [0, MAX_ROWS - 1];
    // Only the columns asked for, like the API: a guard on a column the job
    // never selects must fail here too.
    let columns: string[] | null = null;
    const pick = (r: Row): Row => (columns ? Object.fromEntries(columns.map((c) => [c, r[c]])) : r);
    const rows = () =>
      (tables[table] ?? [])
        .filter((r) => filters.every((f) => f(r)))
        .slice(window[0], Math.min(window[1], window[0] + MAX_ROWS - 1) + 1)
        .map(pick);
    const query = {
      select: (list = "*") => {
        columns = list.trim() === "*" ? null : list.split(",").map((c) => c.trim());
        return query;
      },
      order: () => query,
      range: (fromRow: number, toRow: number) => {
        window = [fromRow, toRow];
        return query;
      },
      eq: (col: string, value: unknown) => {
        filters.push((r) => r[col] === value);
        return query;
      },
      insert: (row: Row): Promise<{ error: null | { message: string } }> => {
        if (opts.failInsert) return Promise.resolve({ error: { message: "duplicate" } });
        (tables[table] ??= []).push(row);
        return Promise.resolve({ error: null });
      },
      then: <T>(resolve: (r: Result) => T, reject?: (e: unknown) => T) =>
        Promise.resolve(
          opts.failRead === table
            ? ({ data: null, error: { message: "timeout" } } as unknown as Result)
            : { data: rows(), error: null },
        ).then(resolve, reject),
    };
    return query;
  }
  return { from } as unknown as NonNullable<PmRetentionDeps["supabase"]>;
}

function world(over: { pmEnabled?: boolean; managerArchived?: boolean; moveOut?: string | null; endedOn?: string | null; subscriptionEndedAt?: string | null } = {}) {
  return {
    agencies: [
      { id: "ag1", name: "Made-up Realty", pm_enabled: over.pmEnabled ?? true, ended_at: over.subscriptionEndedAt ?? null },
      { id: "ag2", name: "Other Made-up Realty", pm_enabled: true },
    ],
    profiles: [
      { id: "lic", agency_id: "ag1", email: "licensee@example.invalid", full_name: "Lee Licensee", is_licensee_in_charge: true, archived_at: null },
      { id: "pm1", agency_id: "ag1", email: "manager@example.invalid", full_name: "Pat Manager", is_licensee_in_charge: false, archived_at: over.managerArchived ? "2026-01-01T00:00:00Z" : null },
      { id: "old", agency_id: "ag1", email: "former@example.invalid", full_name: "Former Licensee", is_licensee_in_charge: true, archived_at: "2026-01-01T00:00:00Z" },
    ],
    pm_properties: [
      {
        id: "p1",
        agency_id: "ag1",
        address: "12 Example Street, Nowhere NSW 2000",
        manager_id: "pm1",
        management_ended_on: over.endedOn ?? null,
        management_ended_reason: over.endedOn ? "another_agent" : null,
      },
    ],
    pm_tenancies: [{ id: "t1", agency_id: "ag1", property_id: "p1", seq: 1, move_out_date: over.moveOut === undefined ? "2023-10-07" : over.moveOut }],
    pm_retention_reminders: [] as Row[],
  } as Record<string, Row[]>;
}

// The job runs at 21:50 UTC, which is the next morning in Sydney.
const ON_THE_DAY = new Date("2026-10-06T21:50:00Z"); // 7 Oct 2026 in Sydney
const DAY_BEFORE = new Date("2026-10-05T21:50:00Z"); // 6 Oct 2026 in Sydney

function capture() {
  const sent: SendEmailInput[] = [];
  const send = async (input: SendEmailInput) => {
    sent.push(input);
    return true;
  };
  return { sent, send };
}

test("works out today in Sydney, not UTC", () => {
  assert.equal(sydneyDate(ON_THE_DAY), "2026-10-07");
});

test("sends once on the date, to the licensee in charge and the property manager, with the exact wording", async () => {
  const tables = world();
  const { sent, send } = capture();
  const result = await runPmRetentionReminders(ON_THE_DAY, { supabase: fakeSupabase(tables), send });
  assert.equal(result.sent, 1);
  assert.deepEqual(sent.map((s) => s.to), ["licensee@example.invalid", "manager@example.invalid"]);
  assert.equal(sent[0].subject, "3 years have passed: 12 Example Street, Nowhere NSW 2000");
  assert.match(sent[0].text, /The 3-year period for this file has passed\. Whether to keep or destroy it is your decision\./);
  assert.match(sent[0].text, /\(Tenant moved out 7 October 2023\): 3 years on 7 October 2026\./);
  for (const s of sent) assert.equal(/delete|free to|should be destroyed|can be destroyed/i.test(s.text), false);
  assert.equal(tables.pm_retention_reminders.length, 1);

  // The next morning: nothing more.
  const again = capture();
  const second = await runPmRetentionReminders(new Date("2026-10-07T21:50:00Z"), { supabase: fakeSupabase(tables), send: again.send });
  assert.equal(second.sent, 0);
  assert.equal(second.alreadySent, 1);
  assert.equal(again.sent.length, 0);
});

test("sends nothing before the date", async () => {
  const { sent, send } = capture();
  const result = await runPmRetentionReminders(DAY_BEFORE, { supabase: fakeSupabase(world()), send });
  assert.equal(result.sent, 0);
  assert.equal(sent.length, 0);
});

test("never mails archived people", async () => {
  const { sent, send } = capture();
  await runPmRetentionReminders(ON_THE_DAY, { supabase: fakeSupabase(world({ managerArchived: true })), send });
  assert.deepEqual(sent.map((s) => s.to), ["licensee@example.invalid"]);
});

test("reads the live record: a corrected move-out date moves the reminder", async () => {
  const { sent, send } = capture();
  await runPmRetentionReminders(ON_THE_DAY, { supabase: fakeSupabase(world({ moveOut: "2023-12-01" })), send });
  assert.equal(sent.length, 0);
});

test("the same reminder when a management ends, for any reason", async () => {
  const { sent, send } = capture();
  await runPmRetentionReminders(ON_THE_DAY, { supabase: fakeSupabase(world({ moveOut: null, endedOn: "2023-10-07" })), send });
  assert.equal(sent.length, 2);
  assert.match(sent[0].text, /\(Management ended 7 October 2023: Moved to another agent\)/);
});

test("an agency with PM switched off gets nothing", async () => {
  const { sent, send } = capture();
  await runPmRetentionReminders(ON_THE_DAY, { supabase: fakeSupabase(world({ pmEnabled: false })), send });
  assert.equal(sent.length, 0);
});

test("an agency whose subscription has ended gets nothing, and gets it after it comes back", async () => {
  const w = world({ subscriptionEndedAt: "2026-10-01T00:00:00Z" });
  const { sent, send } = capture();
  const result = await runPmRetentionReminders(ON_THE_DAY, { supabase: fakeSupabase(w), send });
  assert.equal(result.checked, 0);
  assert.equal(sent.length, 0);
  assert.equal(w.pm_retention_reminders.length, 0);

  // Reactivated a few days later: the reminder due on 7 October still goes.
  w.agencies[0].ended_at = null;
  const later = await runPmRetentionReminders(new Date("2026-10-09T21:50:00Z"), { supabase: fakeSupabase(w), send });
  assert.equal(later.sent, 1);
  assert.equal(w.pm_retention_reminders.length, 1);
});

test("does not send when the record could not be written first", async () => {
  const { sent, send } = capture();
  const result = await runPmRetentionReminders(ON_THE_DAY, { supabase: fakeSupabase(world(), { failInsert: true }), send });
  assert.equal(sent.length, 0);
  assert.equal(result.alreadySent, 1);
});

test("a busy agency past the 1000-row page still gets every reminder", async () => {
  const w = world();
  w.pm_properties = [];
  w.pm_tenancies = [];
  for (let i = 0; i < 1205; i += 1) {
    w.pm_properties.push({ id: `p${i}`, agency_id: "ag1", address: `${i} Example Street, Nowhere NSW 2000`, manager_id: "pm1", management_ended_on: null, management_ended_reason: null });
    w.pm_tenancies.push({ id: `t${i}`, agency_id: "ag1", property_id: `p${i}`, seq: 1, move_out_date: "2023-10-07" });
  }
  const { sent, send } = capture();
  const result = await runPmRetentionReminders(ON_THE_DAY, { supabase: fakeSupabase(w), send });
  assert.equal(result.checked, 1205);
  assert.equal(result.sent, 1205);
  assert.equal(w.pm_retention_reminders.length, 1205);
  assert.equal(sent.length, 1205 * 2);
});

test("a failed read leaves that agency for the next run instead of half-checking it", async () => {
  const w = world();
  const { sent, send } = capture();
  const result = await runPmRetentionReminders(ON_THE_DAY, { supabase: fakeSupabase(w, { failRead: "pm_tenancies" }), send });
  assert.equal(result.checked, 0);
  assert.equal(sent.length, 0);
  assert.equal(w.pm_retention_reminders.length, 0);
  const again = await runPmRetentionReminders(new Date("2026-10-07T21:50:00Z"), { supabase: fakeSupabase(w), send });
  assert.equal(again.sent, 1);
});
