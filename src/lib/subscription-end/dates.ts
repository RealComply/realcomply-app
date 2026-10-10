// The dates that matter once a subscription ends, all in Sydney.
//
// The records window is counted in Sydney calendar days, not in hours from
// the moment Stripe fired. An agency whose subscription ends at 4pm on
// 8 October is told its records are deleted on 22 October, and the deletion
// job, which runs in the small hours of Sydney's morning, deletes them in the
// first run on 22 October. "Download them before then" is then true to the day.

export const RECORDS_WINDOW_DAYS = 14;
export const REMINDER_DAY = 7;
/** How long RealComply keeps its own activity record (DPA cl 4.9). */
export const ACTIVITY_RECORD_YEARS = 7;

const SYDNEY = "Australia/Sydney";

/** "2026-10-08": the Sydney calendar date of an instant. */
export function sydneyDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SYDNEY,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  return parts; // en-CA formats as YYYY-MM-DD
}

/** Adds whole calendar days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/** Adds whole years to a YYYY-MM-DD date (29 Feb lands on 1 Mar). */
export function addYears(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10);
}

/** The Sydney date the records are deleted on. */
export function deletionDate(endedAt: Date): string {
  return addDays(sydneyDate(endedAt), RECORDS_WINDOW_DAYS);
}

/** The Sydney date the day 7 email goes on. */
export function reminderDate(endedAt: Date): string {
  return addDays(sydneyDate(endedAt), REMINDER_DAY);
}

/** The Sydney date RealComply's own activity record is deleted on. */
export function activityDeleteAfter(endedAt: Date): string {
  return addYears(sydneyDate(endedAt), ACTIVITY_RECORD_YEARS);
}

/** Whole days from today (Sydney) to the deletion date. Never negative. */
export function daysLeft(endedAt: Date, now: Date): number {
  const [y1, m1, d1] = sydneyDate(now).split("-").map(Number);
  const [y2, m2, d2] = deletionDate(endedAt).split("-").map(Number);
  const diff = (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000;
  return Math.max(0, Math.round(diff));
}

/** Whether today in Sydney is on or after a YYYY-MM-DD date. */
export function onOrAfter(date: string, now: Date): boolean {
  return sydneyDate(now) >= date;
}

/** "22 October 2026". */
export function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "22 October 2026, 2:04 am" in Sydney. */
export function longDateTime(instant: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: SYDNEY,
  }).format(instant);
}
