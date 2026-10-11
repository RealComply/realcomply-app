import { test } from "node:test";
import assert from "node:assert/strict";
import { runTrustReminders, type TrustReminderDeps } from "@/lib/email/trust-reminders";
import type { SendEmailInput } from "@/lib/email/send";

// The daily trust job against an in-memory database. Each case is one agency,
// one licensee and one account, with September 2026 in a given state.

type Row = Record<string, unknown>;
type Result = { data: unknown; error: null };

// Just enough of the Supabase query builder for this job: filters, then
// either awaited (many rows), maybeSingle (one) or insert.
function fakeSupabase(tables: Record<string, Row[]>) {
  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const query = {
      select: () => query,
      eq: (col: string, value: unknown) => {
        filters.push((r) => r[col] === value);
        return query;
      },
      is: (col: string, value: unknown) => {
        filters.push((r) => (r[col] ?? null) === value);
        return query;
      },
      in: (col: string, values: unknown[]) => {
        filters.push((r) => values.includes(r[col]));
        return query;
      },
      maybeSingle: (): Promise<Result> => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      insert: (row: Row): Promise<{ error: null }> => {
        (tables[table] ??= []).push(row);
        return Promise.resolve({ error: null });
      },
      then: <T>(resolve: (r: Result) => T, reject?: (e: unknown) => T) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
    };
    return query;
  }
  return { from } as unknown as NonNullable<TrustReminderDeps["supabase"]>;
}

const SEPTEMBER = "2026-09-01";
// The cron runs at 21:40 UTC, which is already the next morning in Sydney, and
// the job goes by Sydney's date: the 1 October run is 30 Sep 21:40 UTC
// (7:40am AEST), the 7 October one 6 Oct 21:40 UTC (8:40am AEDT).
const DAY1 = new Date("2026-09-30T21:40:00Z");
const DAY7 = new Date("2026-10-06T21:40:00Z");

type State = "signed" | "filed_unsigned" | "not_filed";

function world(state: State, opts: { accountArchived?: boolean; openedOn?: string } = {}) {
  const tables: Record<string, Row[]> = {
    agencies: [{ id: "ag1", name: "Cass Property" }],
    profiles: [
      { id: "lic", agency_id: "ag1", email: "licensee@example.com", is_licensee_in_charge: true, archived_at: null },
      { id: "asst", agency_id: "ag1", email: "assistant@example.com", is_licensee_in_charge: false, archived_at: null },
    ],
    trust_accounts: [
      {
        id: "acc1",
        agency_id: "ag1",
        name: "Property management",
        archived_at: opts.accountArchived ? "2026-08-01T00:00:00Z" : null,
        opened_on: opts.openedOn ?? null,
      },
    ],
    signoff_documents: [],
    signoff_signatures: [],
    trust_reminders: [],
    trust_audits: [],
  };
  if (state !== "not_filed") {
    tables.signoff_documents.push({
      id: "doc1",
      agency_id: "ag1",
      trust_account_id: "acc1",
      category: "trust_reconciliation",
      period_month: SEPTEMBER,
      created_at: "2026-10-01T05:30:00Z",
    });
    tables.signoff_signatures.push({
      document_id: "doc1",
      signer_id: "lic",
      signed_at: state === "signed" ? "2026-10-01T05:37:00Z" : null,
    });
  }
  const sent: SendEmailInput[] = [];
  const deps: TrustReminderDeps = {
    supabase: fakeSupabase(tables),
    send: async (input) => {
      sent.push(input);
      return true;
    },
  };
  return { tables, sent, deps };
}

for (const [stage, today] of [["day1", DAY1], ["day7", DAY7]] as const) {
  test(`${stage}: signed month sends nothing and records nothing`, async () => {
    const { tables, sent, deps } = world("signed");
    const result = await runTrustReminders(today, deps);
    assert.equal(sent.length, 0);
    assert.equal(tables.trust_reminders.length, 0);
    assert.equal(result.sent, 0);
    assert.equal(result.skippedNothingDue, 1);
  });

  test(`${stage}: filed but unsigned sends only "ready for your sign-off" to the licensee`, async () => {
    const { tables, sent, deps } = world("filed_unsigned");
    const result = await runTrustReminders(today, deps);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ["licensee@example.com"]);
    assert.match(sent[0].subject, /ready for your sign-off/);
    assert.doesNotMatch(sent[0].text, /can upload|can be prepared|still unsigned/i);
    assert.equal(result.sentReadyForSignoff, 1);
    assert.equal(tables.trust_reminders.length, 1);
    assert.equal(tables.trust_reminders[0].stage, stage);
  });

  test(`${stage}: not filed sends the full reminder`, async () => {
    const { tables, sent, deps } = world("not_filed");
    const result = await runTrustReminders(today, deps);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ["licensee@example.com"]);
    assert.doesNotMatch(sent[0].subject, /ready for your sign-off/);
    assert.match(sent[0].text, /Upload the report and sign it off/);
    // Trust is the licensee's only since 7 Oct; an assistant cannot open it.
    assert.doesNotMatch(sent[0].text, /assistant/i);
    assert.equal(result.sent, 1);
    assert.equal(result.sentReadyForSignoff, 0);
    assert.equal(tables.trust_reminders.length, 1);
    assert.equal(tables.trust_reminders[0].stage, stage);
  });
}

test("archived account gets no reminder", async () => {
  const { tables, sent, deps } = world("not_filed", { accountArchived: true });
  await runTrustReminders(DAY1, deps);
  assert.equal(sent.length, 0);
  assert.equal(tables.trust_reminders.length, 0);
});

test("a replaced reconciliation is judged on the newest upload, as the register does", async () => {
  const { tables, sent, deps } = world("signed");
  // A corrected version uploaded after the original was signed, not yet signed.
  tables.signoff_documents.push({
    id: "doc2",
    agency_id: "ag1",
    trust_account_id: "acc1",
    category: "trust_reconciliation",
    period_month: SEPTEMBER,
    created_at: "2026-10-01T09:00:00Z",
  });
  tables.signoff_signatures.push({ document_id: "doc2", signer_id: "lic", signed_at: null });
  await runTrustReminders(DAY7, deps);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /ready for your sign-off/);
});

test("a licensee who has left the office is not mailed", async () => {
  const { tables, sent, deps } = world("not_filed");
  tables.profiles[0].archived_at = "2026-09-15T00:00:00Z";
  await runTrustReminders(DAY1, deps);
  assert.equal(sent.length, 0);
});

test("the 18th goes by Sydney's date and counts the days left from it", async () => {
  // 17 Oct 21:40 UTC is 8:40am on 18 October in Sydney. September is due on
  // 21 October: three days away.
  const { sent, deps } = world("not_filed");
  await runTrustReminders(new Date("2026-10-17T21:40:00Z"), deps);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /3 days left/);
});

test("the run on the UTC 18th is Sydney's 19th and sends nothing", async () => {
  const { sent, deps } = world("not_filed");
  await runTrustReminders(new Date("2026-10-18T21:40:00Z"), deps);
  assert.equal(sent.length, 0);
});

test("a month that ended before the account opened is not chased", async () => {
  const { tables, sent, deps } = world("not_filed", { openedOn: "2026-10-01" });
  const result = await runTrustReminders(DAY7, deps);
  assert.equal(sent.length, 0);
  assert.equal(tables.trust_reminders.length, 0);
  assert.equal(result.skippedNothingDue, 1);
});

test("an account opened during the month is chased for it", async () => {
  const { sent, deps } = world("not_filed", { openedOn: "2026-09-15" });
  await runTrustReminders(DAY7, deps);
  assert.equal(sent.length, 1);
});

test("no audit reminder for a year that ended before the account opened", async () => {
  // 1 July 2027 in Sydney: the audit for the year ended 30 June 2027 is owed by
  // an account opened in October 2026, and the year before is not.
  const opened = world("signed", { openedOn: "2026-10-01" });
  await runTrustReminders(new Date("2027-06-30T21:40:00Z"), opened.deps);
  assert.equal(opened.sent.filter((m) => /audit/i.test(m.subject)).length, 1);

  const before = world("signed", { openedOn: "2026-10-01" });
  await runTrustReminders(new Date("2026-08-31T21:40:00Z"), before.deps);
  assert.equal(before.sent.filter((m) => /audit/i.test(m.subject)).length, 0);
});
