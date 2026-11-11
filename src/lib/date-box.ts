import { formatAuShortDate } from "@/lib/format-date";

// The RealComply date box (components/DateBox.tsx; Adam, 11 Nov 2026): always
// dd/mm/yyyy, whatever the browser is set to. A native date box shows the
// browser's own order, so on a computer set to the US it read "11/04/2026"
// for 4 November. The box stores what the native one did, YYYY-MM-DD, so
// nothing behind it changes. The rules are here, with no browser, so they
// can be tested.

/** What the box shows when empty, and asks for. */
export const DATE_BOX_PLACEHOLDER = "dd/mm/yyyy";

/** Said when what's typed isn't a date. */
export const DATE_BOX_INVALID = "Enter the date as dd/mm/yyyy, for example 04/11/2026.";

/** Said when the date is before the earliest allowed. */
export const dateBoxTooEarly = (min: string) => `Choose a date on or after ${formatAuShortDate(min)}.`;

/** Said when the date is after the latest allowed. */
export const dateBoxTooLate = (max: string) => `Choose a date on or before ${formatAuShortDate(max)}.`;

/** Weekday headings, Monday first. */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number) => String(n).padStart(2, "0");

/** A real calendar date, as YYYY-MM-DD, or null (31/02 is not a date). */
export function isoOf(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * What's typed, as YYYY-MM-DD, or null when it isn't a date. Always day first:
 * "4/11/2026", "04/11/2026", "4-11-2026", "4.11.2026", "4 11 2026" and
 * "04112026" are all 4 November 2026. A two-digit year is this century
 * ("4/11/26"). A date pasted as YYYY-MM-DD is read as it is.
 */
export function parseAuDate(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const iso = ISO.exec(t);
  if (iso) return isoOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const parts = /^(\d{1,2})[/.\-\s]+(\d{1,2})[/.\-\s]+(\d{2}|\d{4})$/.exec(t) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(t);
  if (!parts) return null;
  const year = parts[3].length === 2 ? 2000 + Number(parts[3]) : Number(parts[3]);
  return isoOf(year, Number(parts[2]), Number(parts[1]));
}

/** What the box shows for a stored value: dd/mm/yyyy, or blank. */
export function showAuDate(iso: string | null | undefined): string {
  return iso && ISO.test(iso) ? formatAuShortDate(iso) : "";
}

/** Why what's typed can't be used, or null when it can (blank is for `required` to judge). */
export function dateBoxProblem(text: string, limits: { min?: string; max?: string } = {}): string | null {
  if (!text.trim()) return null;
  const iso = parseAuDate(text);
  if (!iso) return DATE_BOX_INVALID;
  if (limits.min && ISO.test(limits.min) && iso < limits.min) return dateBoxTooEarly(limits.min);
  if (limits.max && ISO.test(limits.max) && iso > limits.max) return dateBoxTooLate(limits.max);
  return null;
}

/** Whether a day can be picked, given the box's limits. */
export function inLimits(iso: string, limits: { min?: string; max?: string } = {}): boolean {
  if (limits.min && ISO.test(limits.min) && iso < limits.min) return false;
  if (limits.max && ISO.test(limits.max) && iso > limits.max) return false;
  return true;
}

export type CalendarDay = { iso: string; day: number; inMonth: boolean };

/**
 * The month as the calendar shows it: six weeks of seven days, each week
 * Monday to Sunday, with the days before and after the month filling the gaps.
 */
export function monthGrid(year: number, month: number): CalendarDay[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7; // Monday is 0
  const start = Date.UTC(year, month - 1, 1 - offset);
  const weeks: CalendarDay[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start + (w * 7 + i) * 86_400_000);
      week.push({
        iso: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
        day: d.getUTCDate(),
        inMonth: d.getUTCMonth() === month - 1,
      });
    }
    weeks.push(week);
  }
  return weeks;
}

/** The month before or after, as [year, month]. */
export function shiftMonth(year: number, month: number, by: number): [number, number] {
  const d = new Date(Date.UTC(year, month - 1 + by, 1));
  return [d.getUTCFullYear(), d.getUTCMonth() + 1];
}

/** A day moved by some days, as YYYY-MM-DD (for the arrow keys in the calendar). */
export function addDaysIso(iso: string, days: number): string {
  const m = ISO.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
