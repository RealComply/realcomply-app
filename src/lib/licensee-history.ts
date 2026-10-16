// The licensee in charge of an office, and the history of who it has been
// (0080; mockup approved by Adam, 16 Oct 2026). Pure: no database. The Office
// profile card, the change form and the Home reminder all ask this, so the
// dates and words are the same everywhere and tested once.
//
// s31(3), Property and Stock Agents Act 2002 (NSW): whoever employs a class 1
// licensee as licensee in charge must tell the Secretary (Fair Trading) their
// name, licence number and each place of business they cover, within 5
// business days.
//
// REVERSAL (Adam, 16 Oct 2026). Was (Adam, 23 Aug 2026): "rather than us
// policing it, all we'll do is have a pop up screen with that clause...";
// nothing recorded whether Fair Trading was told. Now the date is recorded,
// and the new licensee in charge is reminded until it is.

import { addDays } from "@/lib/subscription-end/dates";
import { formatAuDate } from "@/lib/format-date";

/**
 * NSW public holidays and the Bank Holiday, on the days they fall. A day that
 * isn't a Saturday, a Sunday, a public holiday or a bank holiday in NSW is a
 * business day (Interpretation Act 1987 (NSW), s21). Weekend holidays are
 * listed for completeness; the additional days that replace them are what
 * matter. From the NSW Government's public holidays table (checked 16 Oct
 * 2026), including the additional Monday for Anzac Day on a weekend from
 * 2026. Add each year as NSW publishes it: after the last year listed, only
 * weekends are skipped.
 */
export const NSW_HOLIDAYS: ReadonlySet<string> = new Set([
  // 2025
  "2025-01-01", "2025-01-27", "2025-04-18", "2025-04-19", "2025-04-20", "2025-04-21", "2025-04-25",
  "2025-06-09", "2025-08-04", "2025-10-06", "2025-12-25", "2025-12-26",
  // 2026
  "2026-01-01", "2026-01-26", "2026-04-03", "2026-04-04", "2026-04-05", "2026-04-06", "2026-04-25",
  "2026-04-27", "2026-06-08", "2026-08-03", "2026-10-05", "2026-12-25", "2026-12-26", "2026-12-28",
  // 2027
  "2027-01-01", "2027-01-26", "2027-03-26", "2027-03-27", "2027-03-28", "2027-03-29", "2027-04-25",
  "2027-04-26", "2027-06-14", "2027-08-02", "2027-10-04", "2027-12-25", "2027-12-26", "2027-12-27",
  "2027-12-28",
]);

/** The last year NSW_HOLIDAYS covers. */
export const NSW_HOLIDAYS_TO_YEAR = 2027;

/** 0 Sunday … 6 Saturday, for a YYYY-MM-DD date. */
function weekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isNswBusinessDay(iso: string): boolean {
  const day = weekday(iso);
  return day !== 0 && day !== 6 && !NSW_HOLIDAYS.has(iso);
}

/** The date `count` business days after `iso` (not counting `iso` itself). */
export function addNswBusinessDays(iso: string, count: number): string {
  let date = iso;
  let left = count;
  while (left > 0) {
    date = addDays(date, 1);
    if (isNswBusinessDay(date)) left -= 1;
  }
  return date;
}

/** s31(3): 5 business days. */
export const FAIR_TRADING_BUSINESS_DAYS = 5;

/** When Fair Trading must be told by, for a licensee in charge from `startedOn`. */
export function fairTradingDueOn(startedOn: string): string {
  return addNswBusinessDays(startedOn, FAIR_TRADING_BUSINESS_DAYS);
}

/** A line of the history, as the database holds it (licensee_in_charge_history). */
export type LicenseeHistoryLine = {
  id: string;
  profile_id: string | null;
  licensee_name: string;
  licence_type: string | null;
  licence_number: string | null;
  source: "backfill" | "first" | "change" | "team";
  started_on: string | null;
  ended_on: string | null;
  ended_at: string | null;
  fair_trading_told_on: string | null;
  recorded_by: string | null;
  recorded_at: string;
  started_on_recorded_by: string | null;
  started_on_recorded_at: string | null;
  fair_trading_recorded_by: string | null;
  fair_trading_recorded_at: string | null;
};

/** A line came from a handover (Change licensee in charge, or the role given on Team). */
export function isTakeover(line: Pick<LicenseeHistoryLine, "source">): boolean {
  return line.source === "change" || line.source === "team";
}

export type FairTradingReminder = {
  dueOn: string;
  startedOn: string;
  /** After the due date: the card turns red. On the due date it is still due. */
  overdue: boolean;
};

/**
 * The Home reminder for the new licensee in charge: shown while Fair Trading
 * hasn't been recorded as told, from the day of the change. Never for a
 * backfilled or first line (no reminder for those: Adam, 16 Oct 2026).
 */
export function fairTradingReminder(line: LicenseeHistoryLine | null, todayIso: string): FairTradingReminder | null {
  if (!line || line.ended_at || line.fair_trading_told_on || !line.started_on || !isTakeover(line)) return null;
  const dueOn = fairTradingDueOn(line.started_on);
  return { dueOn, startedOn: line.started_on, overdue: todayIso > dueOn };
}

/** "21 October 2026, 5 business days after you took over on 14 October." The year is left off the second date when it's the same. */
export function fairTradingDueSentence(reminder: Pick<FairTradingReminder, "dueOn" | "startedOn">): string {
  const sameYear = reminder.dueOn.slice(0, 4) === reminder.startedOn.slice(0, 4);
  const took = formatAuDate(reminder.startedOn);
  const tookShort = sameYear ? took.replace(/ \d{4}$/, "") : took;
  return `Due ${formatAuDate(reminder.dueOn)}, ${FAIR_TRADING_BUSINESS_DAYS} business days after you took over on ${tookShort}.`;
}

const LICENCE_LABELS: Record<string, string> = {
  class_1: "Class 1 licence",
  class_2: "Class 2 licence",
  certificate_of_registration: "Certificate of registration",
};

/** "Class 1 licence 20123456", or what is known of it. */
export function licenceLabel(type: string | null, number: string | null): string | null {
  const kind = type ? LICENCE_LABELS[type] ?? null : null;
  const num = number?.trim() || null;
  if (kind && num) return `${kind} ${num}`;
  if (kind) return kind;
  if (num) return `Licence ${num}`;
  return null;
}

/** "3 Feb 2025": the history table's short dates. */
export function shortDate(iso: string): string {
  const full = formatAuDate(iso);
  return full.replace(/^(\d+) ([A-Za-z]{3})[a-z]* (\d{4})$/, "$1 $2 $3");
}

/** The card's line under the name: licence, since, Fair Trading told. */
export function currentLicenseeDetails(line: LicenseeHistoryLine): string {
  const bits: string[] = [];
  const licence = licenceLabel(line.licence_type, line.licence_number);
  if (licence) bits.push(licence);
  bits.push(line.started_on ? `since ${formatAuDate(line.started_on)}` : "since: Not recorded");
  bits.push(line.fair_trading_told_on ? `Fair Trading told ${formatAuDate(line.fair_trading_told_on)}` : "Fair Trading told: Not recorded");
  return bits.join(" · ");
}

export type HistoryRow = {
  id: string;
  name: string;
  from: string;
  to: string;
  fairTradingTold: string;
  /** Who recorded the line and each date filled in later, and when. */
  recorded: string;
};

/**
 * The history, newest first, in the table's words. Each line keeps who
 * recorded it and when; "RealComply" for lines the database wrote itself
 * (the backfill, or a first licensee at sign-up).
 */
export function historyRows(
  lines: LicenseeHistoryLine[],
  nameOf: Record<string, string>,
  formatTimestamp: (iso: string) => string,
): HistoryRow[] {
  const who = (id: string | null) => (id ? nameOf[id] ?? "a former team member" : "RealComply");
  return [...lines]
    .sort((a, b) => {
      const as = a.started_on ?? a.recorded_at.slice(0, 10);
      const bs = b.started_on ?? b.recorded_at.slice(0, 10);
      if (as !== bs) return as < bs ? 1 : -1;
      return a.recorded_at < b.recorded_at ? 1 : -1;
    })
    .map((line) => {
      const recorded = [`Recorded by ${who(line.recorded_by)} on ${formatTimestamp(line.recorded_at)}.`];
      if (line.started_on_recorded_at) {
        recorded.push(`Start date added by ${who(line.started_on_recorded_by)} on ${formatTimestamp(line.started_on_recorded_at)}.`);
      }
      if (line.fair_trading_recorded_at) {
        recorded.push(`Fair Trading date added by ${who(line.fair_trading_recorded_by)} on ${formatTimestamp(line.fair_trading_recorded_at)}.`);
      }
      return {
        id: line.id,
        name: line.licensee_name,
        from: line.started_on ? shortDate(line.started_on) : "Not recorded",
        to: line.ended_at ? (line.ended_on ? shortDate(line.ended_on) : "Not recorded") : "Now",
        fairTradingTold: line.fair_trading_told_on ? shortDate(line.fair_trading_told_on) : "Not recorded",
        recorded: recorded.join(" "),
      };
    });
}

/** The current line for a person: their open line, if they are licensee in charge. */
export function openLineFor(lines: LicenseeHistoryLine[], profileId: string | null): LicenseeHistoryLine | null {
  if (!profileId) return null;
  return lines.filter((l) => l.profile_id === profileId && !l.ended_at).sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1))[0] ?? null;
}

/** "Pat Sample becomes licensee in charge and takes over sign-offs, billing and the annexure. You stay on the team as an agent." */
export function changeConfirmation(newName: string): string {
  return `${newName} becomes licensee in charge and takes over sign-offs, billing and the annexure. You stay on the team as an agent.`;
}

/** The change form's hint, with the date the reminder would be due. */
export function changeHint(tookEffect: string | null): string {
  const base = `Tell Fair Trading within ${FAIR_TRADING_BUSINESS_DAYS} business days.`;
  if (!tookEffect) return base;
  return `${base} We'll remind the new licensee if this is blank by ${formatAuDate(fairTradingDueOn(tookEffect))}.`;
}

// ── The new-listing lock after a change (Part 5) ─────────────────────────
//
// Same words as the job 7 lock (Adam, 14 Oct 2026), said for a new licensee
// in charge. The database refuses the insert with LOCKED_LISTING_MESSAGE
// (0080, properties_new_licensee_annexure) whatever route it comes by.

export const LOCKED_LISTING_MESSAGE =
  "New listings can be added once your licensee in charge has adopted RealComply's annexure.";

/** What the office's new-listing lock reads from the database (my_licensee_change_status). */
export type LicenseeChangeStatus = {
  annexurePending: boolean;
  licenseeName: string | null;
  previousAdopter: string | null;
};

export type NewLicenseeLockCopy = { pill: string; text: string; action: "read_and_adopt" | null };

/** In place of "Add listing" on Listings and New listing while the lock is on. */
export function newLicenseeLockCopy(viewer: { isLicensee: boolean }, licenseeName: string | null): NewLicenseeLockCopy {
  if (viewer.isLicensee) {
    return {
      pill: "Waiting on the annexure",
      text: "As the new licensee in charge, read and adopt RealComply's annexure to your Supervision Guidelines, then the office can add new listings. Existing listings carry on as normal.",
      action: "read_and_adopt",
    };
  }
  const named = licenseeName?.trim();
  return {
    pill: "Waiting on your licensee",
    text: named
      ? `Waiting on ${named}, your new licensee in charge, to adopt RealComply's annexure to your Supervision Guidelines. You can add new listings once they have. Existing listings carry on as normal.`
      : "Waiting on your new licensee in charge to adopt RealComply's annexure to your Supervision Guidelines. You can add new listings once they have. Existing listings carry on as normal.",
    action: null,
  };
}
