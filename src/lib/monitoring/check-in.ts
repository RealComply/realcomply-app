// JOB CHECK-INS AND ERROR ALERTS (code review fixes, part F2, 12 Oct 2026).
//
// Until this, a scheduled job that failed or never ran told nobody: the 7am
// listing check, the reminders, the weekly digest and the backup all failed
// silently, and a broken mail provider stopped every customer email without a
// word (code review finding 9).
//
// Now each job tells a check-in service (Healthchecks.io) when it starts and
// whether it finished cleanly. The service alerts Adam when a job reports a
// failure, or when one does not report on time: a job that never ran, or one
// cut off mid-run, can't send anything itself. Every email send reports too,
// so a mail provider that stops working is noticed straight away. And a job
// that fails also emails Adam itself, saying what went wrong.
//
// NO CUSTOMER DATA GOES TO THE SERVICE (Adam, 12 Oct 2026, chosen over full
// error tracking for this reason). A check-in is the job's name and the word
// start, success or fail, and nothing else: no body, no error text, no names.
// So the service is not a subprocessor of Subscriber Data, and the privacy
// policy and DPA (Annexure B) are unchanged. The detail goes to Adam by email
// through the provider already listed there, and stays in Vercel's logs.
//
// SET HEALTHCHECKS_PING_KEY in Vercel (Production only: scheduled jobs only
// run there, and a preview must not report as live). Without it nothing is
// sent and nothing fails. Each check is created in the service the first time
// it reports (?create=1).

export type JobCheck =
  | "listing-scan"
  | "weekly-digest"
  | "licence-reminders"
  | "trust-reminders"
  | "cpd-reminders"
  | "pm-retention"
  | "backup-storage"
  | "subscription-end"
  | "reader-check"
  | "audit-packs"
  | "licensee-confirm"
  | "plan-move-down";

export type Check = JobCheck | "email";

type Signal = "start" | "success" | "fail";

const PING_BASE = "https://hc-ping.com";

/**
 * Tells the check-in service one thing about one check. Never throws and
 * never takes longer than a few seconds: a check-in that cannot be sent must
 * not fail or hold up the job or the email it is about.
 */
export async function checkIn(check: Check, signal: Signal): Promise<void> {
  const key = process.env.HEALTHCHECKS_PING_KEY?.trim();
  if (!key) return;
  const url = `${PING_BASE}/${encodeURIComponent(key)}/${check}${signal === "success" ? "" : `/${signal}`}?create=1`;
  try {
    await fetch(url, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(3000) });
  } catch (e) {
    // The check and the signal only. The URL carries the key.
    console.error("check-in not sent:", check, signal, e instanceof Error ? e.name : "error");
  }
}

// A job sending fifty reminders should not make fifty check-ins, each one
// waiting on Healthchecks. So "email" reports success at most every few
// minutes from one server instance, and failure every time: the failure is
// what alerts, and the next success is what clears it.
const EMAIL_SUCCESS_EVERY_MS = 5 * 60_000;
let lastEmailCheckIn: { signal: Signal; at: number } | null = null;

/** One email send, reported through checkIn as the "email" check. */
export async function emailCheckIn(ok: boolean, now: number = Date.now()): Promise<void> {
  const signal: Signal = ok ? "success" : "fail";
  if (ok && lastEmailCheckIn?.signal === "success" && now - lastEmailCheckIn.at < EMAIL_SUCCESS_EVERY_MS) return;
  lastEmailCheckIn = { signal, at: now };
  await checkIn("email", signal);
}

const LABELS: Record<JobCheck, string> = {
  "listing-scan": "7am listing check",
  "weekly-digest": "weekly digest",
  "licence-reminders": "licence reminders",
  "trust-reminders": "trust reminders",
  "cpd-reminders": "CPD reminders",
  "pm-retention": "property management retention reminders",
  "backup-storage": "hourly document backup",
  "subscription-end": "subscription end and day-14 deletion",
  "reader-check": "daily reader check",
  "audit-packs": "hourly clean-up of finished audit packs",
  "licensee-confirm": "licensee email confirmations",
  "plan-move-down": "automatic plan move-down",
};

/**
 * Runs one scheduled job with its check-ins: start, then success, or fail
 * when it throws or `problemsOf` finds something wrong in its result. On a
 * failure Adam is also emailed what went wrong. What the job returned, or
 * threw, is passed on unchanged.
 */
export async function monitoredJob<T>(
  check: JobCheck,
  run: () => Promise<T>,
  problemsOf: (result: T) => string[] = () => [],
): Promise<T> {
  // Where the job's code actually runs (2 Nov 2026). Vercel's log lines for
  // each run say region iad1 (Washington), most likely where its scheduler
  // calls from; RealComply's functions are set to run in Sydney (vercel.json
  // "regions": ["syd1"]). VERCEL_REGION is the region running this code.
  console.log(`job ${check} running in ${process.env.VERCEL_REGION ?? "an unknown region"}`);
  await checkIn(check, "start");
  let result: T;
  try {
    result = await run();
  } catch (e) {
    await checkIn(check, "fail");
    await alertAdmin(check, [`It stopped with an error: ${e instanceof Error ? e.message : String(e)}`]);
    throw e;
  }
  const problems = problemsOf(result);
  if (problems.length > 0) {
    await checkIn(check, "fail");
    await alertAdmin(check, problems);
  } else {
    await checkIn(check, "success");
  }
  return result;
}

async function alertAdmin(check: JobCheck, problems: string[]): Promise<void> {
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!to) {
    console.error("job problem not emailed: ADMIN_NOTIFICATION_EMAIL is not set.", check, problems);
    return;
  }
  // Imported here, not at the top: send.ts reports each send through
  // checkIn, so a static import would close a cycle between the two files.
  const { sendEmail } = await import("@/lib/email/send");
  await sendEmail({ to, ...jobProblemEmail(check, problems, new Date()) });
}

/** The email Adam gets when a job has a problem. Also what the staff page's test of a job sends. */
export function jobProblemEmail(check: JobCheck, problems: string[], at: Date): { subject: string; text: string } {
  return {
    subject: `RealComply: the ${LABELS[check]} had a problem`,
    text:
      `The ${LABELS[check]} ran at ${at.toISOString()} (UTC) and had a problem:\n\n` +
      problems.map((p) => `- ${p}`).join("\n") +
      "\n\nVercel's logs for this run have the detail. This email is sent each time the job has a problem.",
  };
}

// ── What counts as a problem, job by job ───────────────────────────────────

const failedSends = (n: number) => (n > 0 ? [`${n} email${n === 1 ? "" : "s"} could not be sent.`] : []);

/** Licence, trust and PM retention reminders, and the weekly digest. */
export function reminderProblems(result: { failed: number }): string[] {
  return failedSends(result.failed);
}

/**
 * The 7am listing check: a live ad the reader itself failed on (its answer
 * cut off or unusable, or the service failed) is a problem (1 Nov 2026). The
 * card says so; this tells Adam the same morning, once for the whole run.
 */
export function listingScanProblems(result: { readFailed?: number }): string[] {
  const n = result.readFailed ?? 0;
  return n > 0
    ? [`${n} live ad${n === 1 ? "" : "s"} couldn't be read by the reader (the answer was cut off or unusable, or the AI service failed). The cards say so; Vercel's logs say why (search "document read failed: live_ad").`]
    : [];
}

export function backupProblems(result: { ok: boolean; failed: number; error?: string }): string[] {
  const problems: string[] = [];
  if (!result.ok) problems.push(result.error ?? "The backup did not run.");
  if (result.failed > 0) problems.push(`${result.failed} document${result.failed === 1 ? "" : "s"} could not be copied.`);
  return problems;
}

export function subscriptionEndProblems(result: {
  notices: Record<string, number> | null;
  deletion: { outcomes: Array<{ status: string; name: string | null; reason?: string }> };
}): string[] {
  const problems = failedSends(result.notices?.send_failed ?? 0);
  for (const o of result.deletion.outcomes) {
    if (o.status === "failed" || o.status === "blocked") {
      problems.push(`The deletion for ${o.name ?? "an office"} ${o.status === "blocked" ? "was blocked" : "failed"}: ${o.reason ?? "no reason given"}.`);
    }
  }
  return problems;
}
