import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { runDeletionJob, stopReason } from "./deletion";

// Code review fixes, part B (12 Oct 2026): a deletion run belongs to the one
// end it started for, is checked again right before every step that deletes,
// and tells Adam whenever it stops.
//
// fetch stands in for the database, Storage, the sign-in service and the
// mailer. The office is made up for these tests. Never Cass Property.

const AGENCY = "0d000000-0000-4000-8000-00000000b0b0";
const ADMIN = "admin@example.test";

const env: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://db.test",
  SUPABASE_SERVICE_ROLE_KEY: "service_key",
  EMAIL_PROVIDER: "resend",
  EMAIL_FROM: "RealComply <noreply@realcomply.com.au>",
  RESEND_API_KEY: "re_test",
  ADMIN_NOTIFICATION_EMAIL: ADMIN,
};

// ── Dates ────────────────────────────────────────────────────────────────

const FIRST_END = "2026-09-01T02:00:00.000+00:00"; // 1 Sep, Sydney
const FIRST_END_DUE = new Date("2026-09-15T03:00:00Z"); // 15 Sep, Sydney: day 14
const SECOND_END = "2026-09-15T01:00:00.000+00:00"; // resubscribed and ended again, 15 Sep

describe("stopReason: whether a run may go on deleting", () => {
  const run = { endedAt: FIRST_END };

  it("goes on when the office is still ended, on the same end date, past its 14 days", () => {
    assert.equal(stopReason({ ended_at: FIRST_END }, run, FIRST_END_DUE), null);
  });

  it("the same instant written another way is the same end", () => {
    assert.equal(stopReason({ ended_at: "2026-09-01T02:00:00+00:00" }, run, FIRST_END_DUE), null);
  });

  it("stops when the office has resubscribed (no end date)", () => {
    assert.match(stopReason({ ended_at: null }, run, FIRST_END_DUE) ?? "", /resubscribed/);
  });

  it("stops when the office ended again: cancel, resubscribe, cancel", () => {
    assert.match(stopReason({ ended_at: SECOND_END }, run, FIRST_END_DUE) ?? "", /end date has changed.*1 September 2026.*15 September 2026/);
  });

  it("stops before the 14 days are up", () => {
    assert.match(stopReason({ ended_at: FIRST_END }, run, new Date("2026-09-14T03:00:00Z")) ?? "", /has not arrived/);
  });

  it("a forced test run is not held to the date, but is still held to its end", () => {
    const forced = { endedAt: FIRST_END, forced: true };
    assert.equal(stopReason({ ended_at: FIRST_END }, forced, new Date("2026-09-02T03:00:00Z")), null);
    assert.notEqual(stopReason({ ended_at: SECOND_END }, forced, new Date("2026-09-16T03:00:00Z")), null);
  });
});

// ── The job, end to end, against stand-ins ─────────────────────────────────

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let files: Set<string>;
let deletedUsers: string[];
let emails: Array<{ to: string[] | string; subject: string; text: string }>;
// Runs after each read of the agency's row, with how many reads so far.
let onAgencyRead: ((n: number) => void) | null;
let agencyReads: number;
let nextRunId: number;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [column, filter] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(column)) continue;
    const value = row[column];
    if (filter === "is.null") {
      if (value !== null && value !== undefined) return false;
    } else if (filter === "not.is.null") {
      if (value === null || value === undefined) return false;
    } else if (filter.startsWith("eq.")) {
      if (String(value) !== filter.slice(3)) return false;
    } else if (filter.startsWith("like.")) {
      const prefix = filter.slice(5).replace(/[%*]$/, "");
      if (typeof value !== "string" || !value.startsWith(prefix)) return false;
    } else {
      throw new Error(`filter not understood by the test: ${column}=${filter}`);
    }
  }
  return true;
}

function rpc(name: string): unknown {
  switch (name) {
    case "agency_is_protected":
      return false;
    case "agency_deletion_counts":
      return { listings: 1, items: 2, people: 1 };
    case "build_activity_record":
      return { agency: { id: AGENCY } };
    case "next_deletion_certificate_number":
      return "RC-DEL-TEST-0001";
    default:
      throw new Error(`unexpected rpc in test: ${name}`);
  }
}

function stub() {
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    // .single() and .maybeSingle() ask for one object, not a list.
    const one = (new Headers(init?.headers).get("Accept") ?? "").includes("vnd.pgrst.object");
    const rowsOut = (list: Row[], status = 200) => json(one ? (list[0] ?? null) : list, status);

    if (url.host === "api.resend.com") {
      emails.push(body);
      return json({ id: "email_1" });
    }

    if (url.host !== "db.test") throw new Error(`unexpected fetch in test: ${method} ${url}`);

    // Storage: list a folder, or remove files.
    const list = url.pathname.match(/^\/storage\/v1\/object\/list\/compliance-evidence$/);
    if (list) {
      const prefix = String(body.prefix ?? "");
      const children = new Map<string, boolean>();
      for (const f of files) {
        if (!f.startsWith(`${prefix}/`)) continue;
        const rest = f.slice(prefix.length + 1).split("/");
        children.set(rest[0], rest.length === 1);
      }
      const page = [...children].slice(body.offset ?? 0, (body.offset ?? 0) + (body.limit ?? 100));
      return json(page.map(([name, isFile]) => ({ name, id: isFile ? `id-${name}` : null, metadata: isFile ? { size: 10 } : null })));
    }
    if (url.pathname === "/storage/v1/object/compliance-evidence" && method === "DELETE") {
      for (const p of body.prefixes as string[]) files.delete(p);
      return json([]);
    }

    // Sign-in accounts.
    const user = url.pathname.match(/^\/auth\/v1\/admin\/users\/(.+)$/);
    if (user && method === "DELETE") {
      deletedUsers.push(user[1]);
      return json({});
    }

    const fn = url.pathname.match(/^\/rest\/v1\/rpc\/(.+)$/);
    if (fn) return json(rpc(fn[1]));

    const table = url.pathname.match(/^\/rest\/v1\/(.+)$/)?.[1];
    if (!table) throw new Error(`unexpected fetch in test: ${method} ${url}`);
    tables[table] ??= [];
    const rows = tables[table];
    const hit = rows.filter((r) => matches(r, url.searchParams));

    if (method === "GET") {
      if (table === "agencies" && url.searchParams.get("id")) {
        agencyReads++;
        const out = hit.map((r) => ({ ...r }));
        onAgencyRead?.(agencyReads);
        return rowsOut(out);
      }
      return rowsOut(hit.map((r) => ({ ...r })));
    }
    if (method === "POST") {
      const inserted = (Array.isArray(body) ? body : [body]).map((r: Row) => {
        const row: Row = table === "deletion_runs" ? { id: nextRunId++, ...r } : { ...r };
        if (table === "activity_records") {
          const i = rows.findIndex((x) => x.agency_ref === row.agency_ref);
          if (i >= 0) rows.splice(i, 1);
        }
        rows.push(row);
        return row;
      });
      return rowsOut(inserted, 201);
    }
    if (method === "PATCH") {
      for (const r of hit) Object.assign(r, body);
      return rowsOut(hit);
    }
    if (method === "DELETE") {
      tables[table] = rows.filter((r) => !hit.includes(r));
      return rowsOut(hit);
    }
    throw new Error(`unexpected fetch in test: ${method} ${url}`);
  });
}

function office(endedAt: string | null): Row {
  return { id: AGENCY, name: "Throwaway Test Realty", status: endedAt ? "canceled" : "active", comped_by: null, ended_at: endedAt, legal_hold: false };
}

/** A run left 'started' by an earlier day, for the first end. */
function unfinishedRun(step = "files"): Row {
  return {
    id: nextRunId++,
    agency_ref: AGENCY,
    dry_run: false,
    status: "started",
    step,
    context: {
      agencyName: "Throwaway Test Realty",
      endedAt: FIRST_END,
      userIds: ["0d000000-0000-4000-8000-0000000000a1"],
      recipients: ["licensee@example.test"],
      counts: { listings: 1, items: 2, people: 1 },
    },
  };
}

const FILE = `${AGENCY}/listing-1/a3/1-agreement.pdf`;

function nothingDeleted() {
  assert.ok(files.has(FILE), "the office's files are still there");
  assert.equal(tables.agencies.length, 1, "the office's rows are still there");
  assert.deepEqual(deletedUsers, [], "no sign-in account was deleted");
  assert.equal((tables.deletion_certificates ?? []).length, 0, "no certificate");
}

beforeEach(() => {
  tables = {
    agencies: [],
    deletion_runs: [],
    profiles: [{ id: "0d000000-0000-4000-8000-0000000000a1", agency_id: AGENCY, email: "licensee@example.test", is_licensee_in_charge: true, archived_at: null, is_platform_admin: false, created_at: "2026-01-01T00:00:00Z" }],
    activity_records: [],
    deletion_certificates: [],
    storage_backups: [],
  };
  files = new Set([FILE]);
  deletedUsers = [];
  emails = [];
  onAgencyRead = null;
  agencyReads = 0;
  nextRunId = 1;
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  for (const k of ["BACKUP_S3_BUCKET", "BACKUP_AWS_REGION", "BACKUP_AWS_ACCESS_KEY_ID", "BACKUP_AWS_SECRET_ACCESS_KEY"]) delete process.env[k];
  mock.method(console, "log", () => {});
  mock.method(console, "info", () => {});
  mock.method(console, "error", () => {});
  stub();
});

afterEach(() => mock.restoreAll());

describe("the deletion job: a run belongs to one end", () => {
  it("cancel, resubscribe, cancel again: the unfinished run from the first end deletes nothing, closes, and Adam is told", async () => {
    tables.agencies.push(office(SECOND_END));
    tables.deletion_runs.push(unfinishedRun());

    // The day after the second end.
    const report = await runDeletionJob({ dryRun: false, now: new Date("2026-09-16T03:00:00Z") });

    nothingDeleted();
    const run = tables.deletion_runs[0];
    assert.equal(run.status, "skipped");
    assert.equal(run.context, null, "its addresses and user ids are cleared");
    assert.match(String(run.reason), /end date has changed/);
    assert.equal(report.outcomes[0].status, "skipped");
    const alert = emails.find((e) => e.to === ADMIN || (Array.isArray(e.to) && e.to.includes(ADMIN)));
    assert.ok(alert, "Adam is emailed");
    assert.match(alert.subject, /Deletion stopped for Throwaway Test Realty/);
    assert.equal(emails.length, 1, "nobody else is emailed");
  });

  it("…and on the new end's own day 14, a fresh run deletes as normal", async () => {
    tables.agencies.push(office(SECOND_END));
    tables.deletion_runs.push(unfinishedRun());
    await runDeletionJob({ dryRun: false, now: new Date("2026-09-16T03:00:00Z") });

    // 29 Sep, Sydney: 14 days after the second end.
    const report = await runDeletionJob({ dryRun: false, now: new Date("2026-09-29T03:00:00Z") });

    assert.equal(report.outcomes[0].status, "completed");
    assert.equal(files.size, 0);
    assert.equal(tables.agencies.length, 0);
    assert.deepEqual(deletedUsers, ["0d000000-0000-4000-8000-0000000000a1"]);
  });

  it("resubscribed and still subscribed: the unfinished run deletes nothing, closes, and Adam is told", async () => {
    tables.agencies.push(office(null));
    tables.deletion_runs.push(unfinishedRun());

    await runDeletionJob({ dryRun: false, now: FIRST_END_DUE });

    nothingDeleted();
    assert.equal(tables.deletion_runs[0].status, "skipped");
    assert.match(String(tables.deletion_runs[0].reason), /resubscribed/);
    assert.equal(emails.length, 1);
  });

  it("an unfinished run is never resumed before its 14 days are up", async () => {
    tables.agencies.push(office(FIRST_END));
    tables.deletion_runs.push(unfinishedRun());

    await runDeletionJob({ dryRun: false, now: new Date("2026-09-10T03:00:00Z") });

    nothingDeleted();
    assert.match(String(tables.deletion_runs[0].reason), /has not arrived/);
  });

  for (const [step, read] of [["files", 3], ["rows", 4]] as const) {
    it(`checked again right before deleting: the office resubscribes just before "${step}", and that step never happens`, async () => {
      tables.agencies.push(office(FIRST_END));
      // The office's row is read when the run starts (1), then before
      // backups (2), files (3) and rows (4). It resubscribes straight after
      // the read before the step under test.
      onAgencyRead = (n) => {
        if (n === read - 1) Object.assign(tables.agencies[0], { status: "active", ended_at: null });
      };

      const report = await runDeletionJob({ dryRun: false, now: FIRST_END_DUE });

      assert.equal(report.outcomes[0].status, "skipped");
      assert.ok(files.has(FILE) || step === "rows", "files are untouched when it stops before files");
      assert.equal(tables.agencies.length, 1, "the office's rows are still there");
      assert.deepEqual(deletedUsers, []);
      assert.equal(tables.deletion_runs[0].status, "skipped");
      assert.equal(tables.deletion_runs[0].step, step);
      assert.equal(emails.filter((e) => e.to === ADMIN || (Array.isArray(e.to) && e.to.includes(ADMIN))).length, 1);
    });
  }

  it("the normal case still deletes: ended, same end date, day 14", async () => {
    tables.agencies.push(office(FIRST_END));

    const report = await runDeletionJob({ dryRun: false, now: FIRST_END_DUE });

    assert.equal(report.outcomes[0].status, "completed");
    assert.equal(files.size, 0);
    assert.equal(tables.agencies.length, 0);
    assert.deepEqual(deletedUsers, ["0d000000-0000-4000-8000-0000000000a1"]);
    assert.equal(tables.deletion_certificates.length, 1);
    assert.equal(tables.deletion_runs[0].status, "completed");
  });
});
