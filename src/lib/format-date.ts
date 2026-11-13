// Dates as Australians write them.
//
// Adam, 23 Aug 2026, on copy reading "pre-2026-07-01": "this is the american
// way of writing the date. in Australia it goes day, month, year."
//
// He is right, and the cause was a constant doing two jobs. AML_COMMENCEMENT_DATE
// is "2026-07-01" because it is compared against other ISO date strings, and it
// was then dropped straight into sentences an agent reads. ISO is correct for
// comparison and wrong for a screen — worse than merely foreign-looking, since
// 2026-07-01 and 01-07-2026 are both readable as either day-first or
// month-first, and an agent checking whether an agreement predates commencement
// should not have to work out which convention a compliance product is using.
//
// So: keep ISO in the data, and never show it. Everything user-facing goes
// through here.

// ONE FORMATTER FOR EVERY DATE (Adam, 11 Nov 2026): "every date in
// RealComply is in Australian format, always, whatever the person's browser
// or computer is set to. Never US format." Every date shown on screen, in an
// email, a PDF or an export is formatted here, in en-AU and Sydney time, and
// nowhere else: a browser's or a server's own setting never decides it.
// Written dates stay "4 November 2026"; short dates are dd/mm/yyyy.
// format-date-guard.test.ts fails if a date is formatted anywhere else.

const LOCALE = "en-AU";
const SYDNEY = "Australia/Sydney";

/** A stored calendar date ("2026-11-04"), an instant (an ISO timestamp, a Date or a number), or nothing. */
export type DateInput = Date | string | number | null | undefined;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The instant to format. A calendar date is taken at 02:00 UTC, which is
 * midday or 1pm that same day in Sydney, so it never slips a day either way.
 */
function toInstant(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const m = CALENDAR_DATE.exec(value);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 2));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Spaces as typed: some runtimes put a narrow or non-breaking space before "pm". */
const plainSpaces = (s: string) => s.replace(/[\u202f\u00a0]/g, " ");

/**
 * The one shared date formatter: en-AU, Sydney time, the shape given by
 * `options`. Something that isn't a date comes back as it was given (a string)
 * or blank.
 */
export function formatSydney(value: DateInput, options: Omit<Intl.DateTimeFormatOptions, "timeZone">): string {
  const d = toInstant(value);
  if (!d) return typeof value === "string" ? value : "";
  return plainSpaces(new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: SYDNEY }).format(d));
}

/** The same, as parts ("day", "month", "hour" and so on), for shapes built by hand. */
export function sydneyParts(value: DateInput, options: Omit<Intl.DateTimeFormatOptions, "timeZone">): Record<string, string> {
  const d = toInstant(value);
  if (!d) return {};
  return Object.fromEntries(
    new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: SYDNEY }).formatToParts(d).map((p) => [p.type, plainSpaces(p.value)]),
  );
}

/** "2026-11-04": the Sydney calendar date an instant falls on. */
export function sydneyDate(instant: Date = new Date()): string {
  const p = sydneyParts(instant, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}

/** "04/11/2026": a short date, always day, month, year, two digits each for day and month. */
export function formatAuShortDate(value: DateInput): string {
  const p = sydneyParts(value, { year: "numeric", month: "2-digit", day: "2-digit" });
  if (!p.year) return typeof value === "string" ? value : "";
  return `${p.day}/${p.month}/${p.year}`;
}

/** "4 Nov 2026". */
export function formatAuMediumDate(value: DateInput): string {
  return formatSydney(value, { day: "numeric", month: "short", year: "numeric" });
}

/** "2:15 pm" in Sydney. */
export function formatAuTime(value: DateInput): string {
  const p = sydneyParts(value, { hour: "numeric", minute: "2-digit", hour12: true });
  if (!p.hour) return "";
  return `${p.hour}:${p.minute} ${String(p.dayPeriod ?? "").toLowerCase()}`;
}

/** "4 November 2026, 2:15 pm" in Sydney. */
export function formatAuDateTime(value: DateInput): string {
  const day = formatSydney(value, { day: "numeric", month: "long", year: "numeric" });
  const time = formatAuTime(value);
  return day && time ? `${day}, ${time}` : day;
}

/** "4 Nov, 2:15 pm" in Sydney: a recent moment, where the year goes without saying. */
export function formatAuDayMonthTime(value: DateInput): string {
  const p = sydneyParts(value, { day: "numeric", month: "numeric" });
  if (!p.day) return "";
  return `${p.day} ${MONTHS[Number(p.month) - 1].slice(0, 3)}, ${formatAuTime(value)}`;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "2026-07-01" → "1 July 2026". Day, month, year, no leading zero, month
 * spelled out so there is nothing left to misread.
 *
 * Deliberately not toLocaleDateString: that parses "2026-07-01" as UTC
 * midnight and then renders it in the runtime's timezone, so a date can come
 * out a day early on a server west of Sydney. Compliance dates are calendar
 * facts, not instants, and must not move.
 *
 * Anything that is not a plain YYYY-MM-DD comes back unchanged rather than
 * being guessed at.
 */
export function formatAuDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return iso;
  return `${Number(day)} ${monthName} ${year}`;
}

/**
 * A timestamp — an actual instant, not a calendar date — as the day it
 * happened in Sydney. "2026-09-04T23:10:00Z" → "5 September 2026".
 *
 * NOT formatAuDate. That function reads the leading YYYY-MM-DD off the string
 * and stops, which is exactly right for a calendar fact stored as a date and
 * exactly wrong for a timestamptz: Postgres hands those back in UTC, so
 * anything a NSW user did before 10am this morning carries yesterday's date on
 * the front of the string. A sign-off signed at 9am on the 5th would be shown,
 * in the record of when it was signed, as the 4th.
 *
 * The timezone is named rather than left to the runtime because this renders
 * on a server whose clock is not in Sydney.
 */
export function formatAuTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatSydney(d, { day: "numeric", month: "long", year: "numeric" });
}

/**
 * A timestamp as a short Sydney date and time: "6 Oct 2026, 2:15 pm". Used
 * where a tick records who confirmed something and when (PM, 6 Oct 2026).
 * Built from parts rather than toLocaleString so the shape does not depend on
 * the runtime's locale data.
 */
export function formatAuDateTimeShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${formatAuMediumDate(d)}, ${formatAuTime(d)}`;
}

/**
 * A timestamp as a short Sydney day and month: "26 Oct". The year is added
 * only when it isn't this year in Sydney: "26 Oct 2025". Used in the small
 * office manager line at the top of Home (0096).
 */
export function formatAuDayMonth(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const part = (date: Date, unit: "day" | "month" | "year") => Number(sydneyParts(date, { [unit]: "numeric" })[unit]);
  const dayMonth = `${part(d, "day")} ${MONTHS[part(d, "month") - 1].slice(0, 3)}`;
  return part(d, "year") === part(now, "year") ? dayMonth : `${dayMonth} ${part(d, "year")}`;
}
