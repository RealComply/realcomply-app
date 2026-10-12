import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { backupProblems, checkIn, emailCheckIn, monitoredJob, reminderProblems, subscriptionEndProblems } from "./check-in";
import { sendEmail } from "@/lib/email/send";

// Code review fixes, part F2 (12 Oct 2026): scheduled jobs and email sends
// check in with Healthchecks.io, carrying no customer data, and a job that
// fails also emails Adam. fetch stands in for Healthchecks and the mailer.

const KEY = "pk_test_key";

let pings: Array<{ url: string; body: unknown }>;
let emails: Array<{ to: string | string[]; subject: string; text: string }>;
let healthchecksDown: boolean;
let mailDown: boolean;
let errors: unknown[][];

function stub() {
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://hc-ping.com/")) {
      if (healthchecksDown) throw new TypeError("fetch failed");
      pings.push({ url, body: init?.body });
      return new Response("OK");
    }
    if (url === "https://api.resend.com/emails") {
      if (mailDown) return new Response("provider unavailable", { status: 503 });
      emails.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
}

/** The check and signal of each ping, e.g. "licence-reminders/start". */
const sent = () => pings.map((p) => p.url.replace(`https://hc-ping.com/${KEY}/`, "").replace("?create=1", ""));

beforeEach(() => {
  pings = [];
  emails = [];
  errors = [];
  healthchecksDown = false;
  mailDown = false;
  process.env.HEALTHCHECKS_PING_KEY = KEY;
  process.env.ADMIN_NOTIFICATION_EMAIL = "admin@example.test";
  process.env.EMAIL_PROVIDER = "resend";
  process.env.EMAIL_FROM = "RealComply <noreply@realcomply.com.au>";
  process.env.RESEND_API_KEY = "re_test";
  mock.method(console, "error", (...args: unknown[]) => errors.push(args));
  stub();
});

afterEach(() => {
  mock.restoreAll();
  delete process.env.HEALTHCHECKS_PING_KEY;
});

describe("check-ins", () => {
  it("a job that runs cleanly: start, then success, and its result is passed on", async () => {
    const result = await monitoredJob("licence-reminders", async () => ({ checked: 3, sent: 2, alreadySent: 1, failed: 0 }), reminderProblems);

    assert.deepEqual(result, { checked: 3, sent: 2, alreadySent: 1, failed: 0 });
    assert.deepEqual(sent(), ["licence-reminders/start", "licence-reminders"]);
    assert.equal(emails.length, 0, "nobody is emailed");
  });

  it("each check is created the first time it reports, and carries nothing but its name", async () => {
    await monitoredJob("weekly-digest", async () => ({ sent: 1, skipped: 0, failed: 0 }), reminderProblems);

    for (const p of pings) {
      assert.match(p.url, /^https:\/\/hc-ping\.com\/pk_test_key\/weekly-digest(\/start)?\?create=1$/);
      assert.equal(p.body, undefined, "no body: no customer data");
    }
  });

  it("a job whose result shows a problem: fail, and Adam is emailed what went wrong", async () => {
    await monitoredJob("trust-reminders", async () => ({ checked: 5, sent: 3, failed: 2 }), reminderProblems);

    assert.deepEqual(sent().filter((s) => s !== "email"), ["trust-reminders/start", "trust-reminders/fail"]);
    assert.equal(emails.length, 1);
    assert.deepEqual(emails[0].to, ["admin@example.test"]);
    assert.match(emails[0].subject, /the trust reminders had a problem/);
    assert.match(emails[0].text, /2 emails could not be sent/);
  });

  it("a job that throws: fail, Adam is emailed the error, and the error still reaches Vercel", async () => {
    const boom = new Error("database unreachable");

    await assert.rejects(monitoredJob("backup-storage", async () => { throw boom; }, backupProblems), boom);

    assert.deepEqual(sent().filter((s) => s !== "email"), ["backup-storage/start", "backup-storage/fail"]);
    assert.match(emails[0].text, /It stopped with an error: database unreachable/);
  });

  it("Healthchecks unreachable: the job still runs and returns, and the key is never logged", async () => {
    healthchecksDown = true;

    const result = await monitoredJob("pm-retention", async () => ({ checked: 1, sent: 1, alreadySent: 0, failed: 0 }), reminderProblems);

    assert.equal(result.sent, 1);
    assert.ok(errors.length > 0, "the failed check-in is logged");
    assert.ok(!JSON.stringify(errors).includes(KEY), "but not the key");
  });

  it("no key set: nothing is sent anywhere, and the job runs as before", async () => {
    delete process.env.HEALTHCHECKS_PING_KEY;

    await checkIn("email", "fail");
    await monitoredJob("listing-scan", async () => ({ checked: 4 }));

    assert.deepEqual(pings, []);
  });
});

describe("email sends check in", () => {
  // Each test starts after a failure, so the next success always reports.
  beforeEach(async () => {
    await emailCheckIn(false);
    pings = [];
  });

  it("a send that works reports success", async () => {
    assert.equal(await sendEmail({ to: "someone@example.test", subject: "Hello", text: "Hi" }), true);
    assert.deepEqual(sent(), ["email"]);
  });

  it("a send that fails reports fail, so a broken mail provider alerts straight away", async () => {
    mailDown = true;

    assert.equal(await sendEmail({ to: "someone@example.test", subject: "Hello", text: "Hi" }), false);
    assert.deepEqual(sent(), ["email/fail"]);
  });

  it("a run of successful sends reports success once, not once per email; every failure reports", async () => {
    const t = 1_000_000;
    await emailCheckIn(true, t);
    await emailCheckIn(true, t + 1_000);
    await emailCheckIn(true, t + 60_000);
    assert.deepEqual(sent(), ["email"]);

    await emailCheckIn(false, t + 61_000);
    await emailCheckIn(false, t + 62_000);
    await emailCheckIn(true, t + 63_000);
    assert.deepEqual(sent(), ["email", "email/fail", "email/fail", "email"], "a failure is followed by the success that clears it");

    await emailCheckIn(true, t + 63_000 + 5 * 60_000);
    assert.equal(sent().length, 5, "and success again after five minutes");
  });

  it("no sender address configured counts as a failed send", async () => {
    delete process.env.EMAIL_FROM;

    assert.equal(await sendEmail({ to: "someone@example.test", subject: "Hello", text: "Hi" }), false);
    assert.deepEqual(sent(), ["email/fail"]);
  });
});

describe("what counts as a problem", () => {
  it("reminders and the digest: any email that could not be sent", () => {
    assert.deepEqual(reminderProblems({ failed: 0 }), []);
    assert.deepEqual(reminderProblems({ failed: 1 }), ["1 email could not be sent."]);
  });

  it("the backup: not run, or any document not copied", () => {
    assert.deepEqual(backupProblems({ ok: true, failed: 0 }), []);
    assert.deepEqual(backupProblems({ ok: false, failed: 0, error: "Backup is not configured." }), ["Backup is not configured."]);
    assert.deepEqual(backupProblems({ ok: true, failed: 2 }), ["2 documents could not be copied."]);
  });

  it("subscription end: an email not sent, or a deletion that failed or was blocked; a skip is not a problem", () => {
    assert.deepEqual(
      subscriptionEndProblems({
        notices: { sent: 1, skipped: 0, send_failed: 0 },
        deletion: { outcomes: [{ status: "completed", name: "A" }, { status: "skipped", name: "B", reason: "legal hold" }] },
      }),
      [],
    );
    assert.deepEqual(
      subscriptionEndProblems({
        notices: { sent: 0, skipped: 0, send_failed: 1 },
        deletion: { outcomes: [{ status: "failed", name: "Throwaway Test Realty", reason: "backups: AWS: timeout" }] },
      }),
      ["1 email could not be sent.", "The deletion for Throwaway Test Realty failed: backups: AWS: timeout."],
    );
  });
});
