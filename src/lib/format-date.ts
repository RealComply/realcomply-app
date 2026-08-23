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
