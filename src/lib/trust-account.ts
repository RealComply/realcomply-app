// Trust account obligations: which months are outstanding, and when the audit
// is due. Pure date arithmetic, no database — so the screen and the reminder
// job cannot disagree about whether something is late.
//
// THE TWO OBLIGATIONS, as they actually read.
//
// Monthly. Reg cl 27(5)(b): at the end of each named month the licensee must
// "prepare a statement reconciling the balance of the licensee's trust account
// with the balance of the related cash book or other record". No grace period
// is stated there. Reg cl 30(1) then requires the trial balance statement —
// which must show the comparison against that reconciliation — "within 21 days
// after the end of each named month". So 21 days is the real outer limit.
//
// Adam, 25 Aug 2026, believed it was two weeks and asked for reminders on the
// 1st and the 7th; on being shown the provisions: "ok lets update in RC to 21
// days." An agency is free to set a tighter internal standard, but the product
// must not tell one that 14 days is the law when it is not.
//
// Annual. Act s111: the audit must be carried out "within 3 months after the
// end of the audit period". Act s112: the audit period is the year ending
// 30 June unless the Secretary fixes another. So for the year ended 30 June,
// the audit is due 30 September. s111(3): the auditor's report is kept at
// least 3 years.

import { sydneyDate } from "@/lib/subscription-end/dates";

export const RECONCILIATION_DUE_DAYS = 21;
export const AUDIT_DUE_MONTHS = 3;

export type MonthStatus =
  /** The month has not ended yet — nothing is owing. */
  | "future"
  /** The month has ended and no document has been uploaded. */
  | "awaiting_upload"
  /** Uploaded, waiting on the licensee's signature. */
  | "awaiting_signature"
  | "signed"
  /** Past the 21-day mark and still not signed. */
  | "overdue"
  /** Ended before the account was opened, so nothing was ever owed on it. */
  | "not_applicable";

export type ReconciliationMonth = {
  /** First day of the month it covers, as YYYY-MM-DD. */
  month: string;
  /** "July 2026" */
  label: string;
  /** The 21-day deadline, as YYYY-MM-DD. Null while the month is still running. */
  dueOn: string | null;
  status: MonthStatus;
  documentId: string | null;
  fileName: string | null;
  /** Storage path of the document as uploaded. */
  filePath: string | null;
  /** The signed copy — the upload plus a signature page. Null until signed. */
  signedFilePath: string | null;
  signedFileName: string | null;
  uploadedByName: string | null;
  signedAt: string | null;
  /** The name the licensee typed when they signed it. */
  signedName: string | null;
  /** Amendment history, appended by replaceSignoffDocument. */
  notes: string | null;
};

// ── Date helpers ──────────────────────────────────────────────────────────
// Everything is a calendar date, so everything is built at UTC midnight and
// compared as such. The same reasoning as lib/format-date.ts: a Date built
// from a local timezone can land on the previous day for anyone east of
// Greenwich, and "was this late" must not depend on where the server is.

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfUtcDay(today: Date): Date {
  return utc(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
}

/**
 * Today's calendar date in Sydney, as UTC midnight of that day — the form
 * every helper here reads. Pass this, not new Date(), as their `today`.
 *
 * 10 Oct 2026: the helpers read the UTC calendar date, and the reminder job
 * runs at 21:40 UTC, which is already the next morning in Sydney. So the
 * "1st, 7th and 18th" emails arrived on the 2nd, 8th and 19th, the 18th one
 * said three days were left when two were, and until about 10am on the 22nd
 * the page and the badge still showed a month due on the 21st as not overdue.
 * The obligation runs on NSW days, so the date is Sydney's.
 */
export function sydneyToday(now: Date = new Date()): Date {
  const [y, m, d] = sydneyDate(now).split("-").map(Number);
  return utc(y, m - 1, d);
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthLabel(monthIso: string): string {
  const [y, m] = monthIso.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/**
 * The audit period a date falls in, as the 30 June it ends on.
 *
 * Anything from 1 July onwards belongs to the year ending the following
 * 30 June. 25 August 2026 → 30 June 2027.
 */
export function auditPeriodEndFor(today: Date = new Date()): string {
  const y = today.getUTCFullYear();
  const afterJune = today.getUTCMonth() >= 6; // 6 = July
  return iso(utc(afterJune ? y + 1 : y, 5, 30));
}

/** The audit period immediately before the current one — the one being audited now. */
export function previousAuditPeriodEnd(today: Date = new Date()): string {
  const current = auditPeriodEndFor(today);
  return iso(utc(Number(current.slice(0, 4)) - 1, 5, 30));
}

/** s111: within 3 months after the end of the audit period. */
export function auditDueOn(periodEnd: string): string {
  const [y, m, d] = periodEnd.split("-").map(Number);
  return iso(utc(y, m - 1 + AUDIT_DUE_MONTHS, d));
}

/** The twelve months of an audit year, July first, as YYYY-MM-01 strings. */
export function monthsInAuditYear(periodEnd: string): string[] {
  const endYear = Number(periodEnd.slice(0, 4));
  const out: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    // July (month 6) of the year before the period ends, running forward.
    out.push(iso(utc(endYear - 1, 6 + i, 1)));
  }
  return out;
}

/** The 21-day deadline for a month: 21 days after the last day of it. */
export function reconciliationDueOn(monthIso: string): string {
  const [y, m] = monthIso.split("-").map(Number);
  // Day 0 of the next month is the last day of this one.
  const lastDay = utc(y, m, 0);
  return iso(utc(lastDay.getUTCFullYear(), lastDay.getUTCMonth(), lastDay.getUTCDate() + RECONCILIATION_DUE_DAYS));
}

/** Has the month finished? Nothing is owing until it has. */
export function monthHasEnded(monthIso: string, today: Date = new Date()): boolean {
  const [y, m] = monthIso.split("-").map(Number);
  return startOfUtcDay(today) > utc(y, m, 0);
}

export function daysUntil(dateIso: string, today: Date = new Date()): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  return Math.round((utc(y, m - 1, d).getTime() - startOfUtcDay(today).getTime()) / 86_400_000);
}

/** The month just ended, as at today. On 25 Aug 2026 that is July 2026. */
export function lastCompletedMonth(today: Date = new Date()): string {
  const d = startOfUtcDay(today);
  return iso(utc(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
}

// ── When the account opened ────────────────────────────────────────────────
//
// 10 Oct 2026: an account added in October for a trust account opened on
// 1 October showed July, August and September as overdue straight away, and
// asked for the audit of a year it never existed in — red that could only be
// cleared by filing reconciliations for months the account did not exist.
//
// The cut-off is the date the licensee says the account OPENED, not the day
// it was added here. Those differ for every agency that joins part way through
// a year, and for every account 0032 created on 25 Aug 2026 for the agencies
// already here: their July reconciliations and their 2025-26 audit were owed
// all the same, and going quiet about them would hide a real obligation. No
// date given means it was already open, and everything is owed as before.

/** Did the month end before the account opened? Nothing was owed on it. */
export function monthBeforeOpening(monthIso: string, openedOn: string | null | undefined): boolean {
  if (!openedOn) return false;
  const [y, m] = monthIso.split("-").map(Number);
  // Day 0 of the next month is the last day of this one.
  return iso(utc(y, m, 0)) < openedOn;
}

/** An audit period is owed if the account was open at any point in it. */
export function auditOwed(periodEnd: string, openedOn: string | null | undefined): boolean {
  return !openedOn || openedOn <= periodEnd;
}

// ── Status ────────────────────────────────────────────────────────────────

export type ReconciliationRecord = {
  documentId: string;
  month: string;
  fileName: string | null;
  filePath: string | null;
  signedFilePath: string | null;
  signedFileName: string | null;
  uploadedByName: string | null;
  signedAt: string | null;
  signedName: string | null;
  notes: string | null;
};

// The rows these are built from. Only the columns that decide the status are
// required; the rest feed the register card and may be left out by callers
// that only need the status (the nav badge, the reminder job).
export type ReconciliationDocRow = {
  id: string;
  trust_account_id: string | null;
  period_month: string | null;
  created_at: string;
  file_name?: string | null;
  file_path?: string | null;
  signed_file_path?: string | null;
  signed_file_name?: string | null;
  uploaded_by?: string | null;
  notes?: string | null;
};

export type ReconciliationSignatureRow = {
  document_id: string;
  signed_at: string | null;
  typed_name?: string | null;
};

/**
 * One account's reconciliations, keyed by month.
 *
 * THE single definition of which document stands for a month and whether it
 * is signed. The trust register, the nav badge and the reminder emails all go
 * through here, so none of them can call a month done while another calls it
 * outstanding.
 *
 * The newest upload for a month is the one that counts. A replaced
 * reconciliation is a new document, and a signature on the version it
 * replaced is not a signature on what is filed now.
 *
 * "Signed" means a signature row with signed_at on that document. Every trust
 * reconciliation is written with signer_scope = licensee_only and signDocument
 * refuses anyone else on that scope, so a signature here is the licensee in
 * charge's.
 */
export function reconciliationRecordsFor(
  accountId: string,
  docs: ReconciliationDocRow[],
  sigs: ReconciliationSignatureRow[],
  nameOf: (profileId: string | null) => string | null = () => null,
): Map<string, ReconciliationRecord> {
  const newestFirst = docs
    .filter((d) => d.trust_account_id === accountId && d.period_month)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

  const records = new Map<string, ReconciliationRecord>();
  for (const doc of newestFirst) {
    const month = doc.period_month as string;
    if (records.has(month)) continue;
    const signature = sigs.find((s) => s.document_id === doc.id && s.signed_at);
    records.set(month, {
      documentId: doc.id,
      month,
      fileName: doc.file_name ?? null,
      filePath: doc.file_path ?? null,
      signedFilePath: doc.signed_file_path ?? null,
      signedFileName: doc.signed_file_name ?? null,
      uploadedByName: nameOf(doc.uploaded_by ?? null),
      signedAt: signature?.signed_at ?? null,
      signedName: signature?.typed_name ?? null,
      notes: doc.notes ?? null,
    });
  }
  return records;
}

/** Where the work on a month stands, ignoring dates. */
export type ReconciliationProgress = "not_filed" | "filed_unsigned" | "signed";

export function reconciliationProgress(record: ReconciliationRecord | undefined): ReconciliationProgress {
  if (!record) return "not_filed";
  return record.signedAt ? "signed" : "filed_unsigned";
}

export function statusFor(
  monthIso: string,
  record: ReconciliationRecord | undefined,
  today: Date = new Date(),
  openedOn: string | null = null,
): MonthStatus {
  if (!monthHasEnded(monthIso, today)) return "future";
  // Anything filed for it still shows as filed.
  if (!record && monthBeforeOpening(monthIso, openedOn)) return "not_applicable";
  const progress = reconciliationProgress(record);
  if (progress === "signed") return "signed";
  const late = daysUntil(reconciliationDueOn(monthIso), today) < 0;
  if (late) return "overdue";
  return progress === "filed_unsigned" ? "awaiting_signature" : "awaiting_upload";
}

export function buildMonths(
  periodEnd: string,
  records: Map<string, ReconciliationRecord>,
  today: Date = new Date(),
  /** trust_accounts.opened_on. Months that ended before it are not_applicable. */
  openedOn: string | null = null,
): ReconciliationMonth[] {
  return monthsInAuditYear(periodEnd).map((month) => {
    const record = records.get(month);
    const status = statusFor(month, record, today, openedOn);
    return {
      month,
      label: monthLabel(month),
      dueOn: monthHasEnded(month, today) && status !== "not_applicable" ? reconciliationDueOn(month) : null,
      status,
      documentId: record?.documentId ?? null,
      fileName: record?.fileName ?? null,
      filePath: record?.filePath ?? null,
      signedFilePath: record?.signedFilePath ?? null,
      signedFileName: record?.signedFileName ?? null,
      uploadedByName: record?.uploadedByName ?? null,
      signedAt: record?.signedAt ?? null,
      signedName: record?.signedName ?? null,
      notes: record?.notes ?? null,
    };
  });
}

export const MONTH_STATUS_LABELS: Record<MonthStatus, string> = {
  future: "Not due yet",
  awaiting_upload: "Not uploaded",
  awaiting_signature: "Waiting on you",
  signed: "Signed",
  overdue: "Overdue",
  not_applicable: "Before it opened",
};

// ── Reminders ─────────────────────────────────────────────────────────────
//
// Adam asked for the 1st and the 7th. The 18th was added on the same call
// because the deadline is day 21 — a warning three days out is the last one
// that can still change the outcome, and without it the product goes quiet
// exactly when it matters most.
//
// Every stage looks at the month as it stands when the email is about to go,
// through reconciliationProgress — the same answer the register shows:
//
//   signed          — nothing is sent. A reminder about something already done
//                     is how people learn to ignore the sender. (The 1st used
//                     to go regardless; on 1 Oct 2026 that told an agency to
//                     prepare a September reconciliation it had signed that
//                     afternoon.)
//   filed_unsigned  — a short "ready for your sign-off" to the licensee only.
//                     The upload is done, so nobody is told to do it.
//   not_filed       — the full reminder.

export type ReminderStage = "day1" | "day7" | "day18";

export const REMINDER_DAYS: Record<ReminderStage, number> = { day1: 1, day7: 7, day18: 18 };

export function reminderStageForDay(dayOfMonth: number): ReminderStage | null {
  if (dayOfMonth === 1) return "day1";
  if (dayOfMonth === 7) return "day7";
  if (dayOfMonth === 18) return "day18";
  return null;
}

/** Audit reminders run on 1 July, 1 August and 1 September, while unconfirmed. */
export type AuditReminderStage = "month1" | "month2" | "month3";

export function auditStageForMonth(monthIndexUtc: number): AuditReminderStage | null {
  if (monthIndexUtc === 6) return "month1"; // July
  if (monthIndexUtc === 7) return "month2"; // August
  if (monthIndexUtc === 8) return "month3"; // September — due at the end of it
  return null;
}

export type ReconciliationReminderKind = "none" | "ready_for_signoff" | "full";

/** What, if anything, a reconciliation reminder should say at any stage. */
export function reconciliationReminderFor(progress: ReconciliationProgress): ReconciliationReminderKind {
  if (progress === "signed") return "none";
  if (progress === "filed_unsigned") return "ready_for_signoff";
  return "full";
}
