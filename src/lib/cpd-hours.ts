// Which CPD records count toward a person's hours, and where their year
// stands. Pure, so the register, the CPD screen and any future reminder all
// answer the same way.
//
// THE RULE IS NOT NEW. 0021/0022 settled it on 18 Aug 2026: only an approved
// provider delivers NSW CPD, and "an entry with no provider is office
// training, not CPD" (the column comment on cpd_records.provider). Internal
// training sessions never earn CPD. What was missing was applying it to the
// totals: every screen summed every row, so a certificate whose provider
// could not be read added to the hours as if it qualified. This is the one
// place that sum now happens.

import type { CpdRecord } from "@/lib/types";
import type { CpdRequirement } from "@/lib/rules/nsw-cpd";

type Countable = Pick<CpdRecord, "hours" | "provider" | "completed_date"> & {
  source_session_id?: string | null;
};

/**
 * True when a record counts toward the year's CPD hours: it names the
 * approved provider who delivered it (or came from a session that did, since
 * recordAttendance only logs CPD for a session with a named provider), and it
 * has both hours and a date. A record still waiting on its hours or date is
 * shown and asked about, but adds nothing until it has them.
 */
export function countsTowardCpd(r: Countable): boolean {
  if (r.hours === null || r.hours === undefined || !Number.isFinite(Number(r.hours))) return false;
  if (!r.completed_date) return false;
  return Boolean(r.provider && r.provider.trim()) || Boolean(r.source_session_id);
}

export function countableCpdHours(records: Countable[]): number {
  return records.filter(countsTowardCpd).reduce((sum, r) => sum + Number(r.hours), 0);
}

// ── Where a person's CPD year stands ────────────────────────────────────────
//
// For the reminder Adam has not yet decided on (see the PR for the proposal).
// No email uses this yet. It exists so that whichever schedule is chosen,
// "done means quiet" is already decided in one tested place:
//
//   * The year is complete when the person's CPD for that CPD year (1 July to
//     30 June) is confirmed under the existing rule: a cpd_year_signoffs row
//     for that year. That tick is the only "complete" the product has; it
//     does not add up hours (0023 records why).
//   * Complete means no reminder for the rest of that year. A confirmation
//     for last year does not count for this one, so reminders start again on
//     1 July.
//   * Not complete means the reminder keeps going and says what is still
//     outstanding, in hours or units where a requirement can be stated.

export type CpdYearStanding = {
  complete: boolean;
  /** Approved-provider hours (or units) recorded for the year. */
  counted: number;
  /** The requirement, or null where it cannot be stated (rules/nsw-cpd.ts). */
  target: number | null;
  /** Plain words for a reminder, or null when nothing is outstanding. */
  outstanding: string | null;
  remind: boolean;
};

export function cpdYearStanding(input: {
  /** This person's records dated inside the CPD year. */
  records: Countable[];
  /** cpd_year_start of each confirmation on file for this person. */
  confirmedYears: string[];
  /** 1 July that starts the year being asked about, YYYY-07-01. */
  yearStart: string;
  requirement: CpdRequirement;
}): CpdYearStanding {
  const counted = countableCpdHours(input.records);
  const units = input.requirement.units !== null;
  const target = input.requirement.units ?? input.requirement.coreHours;
  const complete = input.confirmedYears.includes(input.yearStart);

  if (complete) return { complete, counted, target, outstanding: null, remind: false };

  const word = units ? "units" : "hours";
  const outstanding =
    target === null
      ? `${counted} ${word} recorded from approved providers, and the year isn't confirmed as done yet.`
      : counted >= target
        ? `${counted} of ${target} ${word} recorded. The year still needs confirming as done.`
        : `${counted} of ${target} ${word} recorded. ${round1(target - counted)} still to go, and the year isn't confirmed as done yet.`;

  return { complete, counted, target, outstanding, remind: true };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
