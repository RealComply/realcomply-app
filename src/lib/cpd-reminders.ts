// CPD deadline reminders: when they go, and who they go to. Pure, so the job,
// the CPD page and the tests all answer the same way.
//
// Adam, 19 Oct 2026. The CPD year runs 1 July to 30 June, and nothing reminded
// anyone as 30 June came close. Now:
//
//   * On 1 April, 1 May, 1 June and 23 June (Sydney time, morning), everyone
//     who needs CPD and whose year isn't ticked as done gets a reminder.
//   * The licensee in charge of an office also gets one summary on the same
//     dates: who is still outstanding. No summary when nobody is.
//   * An agent on their own plan is their own licensee: their own reminder
//     only, no summary.
//   * Done means quiet. The tick (cpd_year_signoffs, 0023) is read at send
//     time; once a year is ticked, nothing more until the next CPD year.
//   * Archived people get nothing.
//   * Each send is recorded (cpd_reminders, 0084), so nobody gets the same
//     date twice.
//
// A run that fails on the day (the job is checked in and alerts on failure)
// still sends that date's reminders on the next run, for up to three days.
// After that the date is let go: a 1 April reminder arriving in mid-April
// reads as a broken system, and 1 May is coming.

import { accessFrom } from "@/lib/access";
import type { Profile } from "@/lib/types";

export type CpdReminderStage = { month: number; day: number };

/** The four send dates, in order. Month is 1-based. */
export const CPD_REMINDER_DATES: readonly CpdReminderStage[] = [
  { month: 4, day: 1 },
  { month: 5, day: 1 },
  { month: 6, day: 1 },
  { month: 6, day: 23 },
];

/** The schedule in words, for the CPD page and anything else that states it. */
export const CPD_REMINDER_SCHEDULE_WORDS = "1 April, 1 May, 1 June and 23 June";

/** How many days after a send date a missed run still sends it. */
export const CPD_REMINDER_GRACE_DAYS = 3;

const iso = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export type DueCpdReminder = {
  /** Which send date this is, YYYY-MM-DD. */
  sendDate: string;
  /** 1 July that starts the CPD year the reminder is about. */
  cpdYearStart: string;
  /** 30 June that ends it. */
  cpdYearEnd: string;
};

/**
 * The send date due on a Sydney day (YYYY-MM-DD), or null on any other day.
 * Due on the date itself and for CPD_REMINDER_GRACE_DAYS after it, so a run
 * that failed on the day still goes out. The CPD year is the one ending
 * 30 June of the same calendar year.
 */
export function cpdReminderDue(sydneyDay: string): DueCpdReminder | null {
  const year = Number(sydneyDay.slice(0, 4));
  const dates = CPD_REMINDER_DATES.map((s) => iso(year, s.month, s.day));
  for (const sendDate of [...dates].reverse()) {
    if (sendDate <= sydneyDay && sydneyDay <= addDays(sendDate, CPD_REMINDER_GRACE_DAYS)) {
      return { sendDate, cpdYearStart: `${year - 1}-07-01`, cpdYearEnd: `${year}-06-30` };
    }
  }
  return null;
}

/** "2026-27", as the reminder emails write it. */
export function cpdYearShortLabel(cpdYearStart: string): string {
  const start = Number(cpdYearStart.slice(0, 4));
  return `${start}-${String(start + 1).slice(-2)}`;
}

/** The year a CPD year ends in, for "the year ending 30 June 2027". */
export function cpdYearEndYear(cpdYearStart: string): number {
  return Number(cpdYearStart.slice(0, 4)) + 1;
}

type Person = Pick<
  Profile,
  "id" | "email" | "full_name" | "is_agent" | "is_assistant" | "is_licensee_in_charge" | "licence_type" | "archived_at"
>;

/**
 * Who needs CPD. In NSW every Class 1 and Class 2 licence holder and every
 * certificate of registration holder does. Most people in RealComply have no
 * licence type recorded yet (19 Oct 2026: 11 of 16), so an agent or the
 * licensee in charge counts whether or not it is on file. An assistant with no
 * licence or certificate on file isn't asked: they may hold neither.
 */
export function needsCpd(p: Person): boolean {
  if (p.archived_at) return false;
  return p.licence_type !== null || p.is_agent === true || p.is_licensee_in_charge === true;
}

export type CpdReminderPlan = {
  /** People to remind about their own year, in name order. */
  people: Person[];
  /**
   * One summary per licensee in charge of an office, listing everyone else
   * still outstanding. Their own year is in their own reminder, not in their
   * summary, so a licensee who is the only one outstanding gets one email.
   */
  summaries: Array<{ licensee: Person; outstanding: Person[] }>;
};

const byName = (a: Person, b: Person) =>
  (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email, "en-AU");

/**
 * Who is reminded in one office on a send date. `doneIds` are the people
 * whose year is ticked, read at send time. Records of what was already sent
 * are the job's to check; this only says who is owed.
 */
export function planCpdReminders(input: {
  plan: string | null;
  /** 0092: an office run like an agent plan. */
  licensee_not_on_realcomply?: boolean | null;
  profiles: Person[];
  doneIds: ReadonlySet<string>;
}): CpdReminderPlan {
  const current = input.profiles.filter((p) => !p.archived_at);
  const people = current
    .filter((p) => needsCpd(p) && !input.doneIds.has(p.id) && Boolean(p.email))
    .sort(byName);

  // An agent on their own plan is their own licensee: no summary. In an
  // office, the licensee in charge (officeLicensee in lib/access.ts).
  const licensees = current.filter((p) => accessFrom(p, input).officeLicensee && Boolean(p.email));
  const summaries = licensees
    .map((licensee) => ({ licensee, outstanding: people.filter((p) => p.id !== licensee.id) }))
    .filter((s) => s.outstanding.length > 0);

  return { people, summaries };
}

/** "Jo Bennett", "Jo Bennett and Sam Lee", "Jo Bennett, Sam Lee and Pat Kim". */
export function namesInWords(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
