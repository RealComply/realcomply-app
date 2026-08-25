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
  | "overdue";

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
  uploadedByName: string | null;
  signedAt: string | null;
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

// ── Status ────────────────────────────────────────────────────────────────

export type ReconciliationRecord = {
  documentId: string;
  month: string;
  fileName: string | null;
  uploadedByName: string | null;
  signedAt: string | null;
};

export function statusFor(
  monthIso: string,
  record: ReconciliationRecord | undefined,
  today: Date = new Date(),
): MonthStatus {
  if (!monthHasEnded(monthIso, today)) return "future";
  if (record?.signedAt) return "signed";
  const late = daysUntil(reconciliationDueOn(monthIso), today) < 0;
  if (late) return "overdue";
  return record ? "awaiting_signature" : "awaiting_upload";
}

export function buildMonths(
  periodEnd: string,
  records: Map<string, ReconciliationRecord>,
  today: Date = new Date(),
): ReconciliationMonth[] {
  return monthsInAuditYear(periodEnd).map((month) => {
    const record = records.get(month);
    return {
      month,
      label: monthLabel(month),
      dueOn: monthHasEnded(month, today) ? reconciliationDueOn(month) : null,
      status: statusFor(month, record, today),
      documentId: record?.documentId ?? null,
      fileName: record?.fileName ?? null,
      uploadedByName: record?.uploadedByName ?? null,
      signedAt: record?.signedAt ?? null,
    };
  });
}

export const MONTH_STATUS_LABELS: Record<MonthStatus, string> = {
  future: "Not due yet",
  awaiting_upload: "Not uploaded",
  awaiting_signature: "Waiting on you",
  signed: "Signed",
  overdue: "Overdue",
};

// ── Reminders ─────────────────────────────────────────────────────────────
//
// Adam asked for the 1st and the 7th. The 18th was added on the same call
// because the deadline is day 21 — a warning three days out is the last one
// that can still change the outcome, and without it the product goes quiet
// exactly when it matters most.
//
// The 1st fires whether or not anything has been uploaded: it is the prompt to
// start. The 7th and 18th only fire while the month is genuinely unsigned. A
// reminder about something already done is how people learn to ignore the
// sender.

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
