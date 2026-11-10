// The tiles at the top of the Complaints register (Master, 10 Nov 2026:
// "clearer tile labels with 'Change' for the licensee"). Each says what it
// counts in words, the days written out, and the resolution target can be
// changed by the licensee in charge from its own tile.

/** The most days the office can allow to resolve a complaint. */
export const MAX_COMPLAINT_TARGET_DAYS = 365;

/** "1 day", "12 days". */
export function daysSaid(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

export type ComplaintTile = {
  key: "open" | "resolved" | "overdue" | "oldest" | "target";
  value: string;
  label: string;
  /** What it counts, in words, under the label. */
  hint: string;
  tone: "bad" | "ok" | "plain";
};

export function complaintTiles(c: {
  open: number;
  resolved: number;
  overdue: number;
  oldestOpenDays: number;
  targetDays: number;
}): ComplaintTile[] {
  return [
    { key: "open", value: String(c.open), label: "Open", hint: "Not yet resolved", tone: c.open > 0 ? "bad" : "plain" },
    { key: "resolved", value: String(c.resolved), label: "Resolved", hint: "Resolved to date", tone: "ok" },
    {
      key: "overdue",
      value: String(c.overdue),
      label: "Overdue",
      hint: `Open longer than ${daysSaid(c.targetDays)}`,
      tone: c.overdue > 0 ? "bad" : "ok",
    },
    {
      key: "oldest",
      value: c.open > 0 ? daysSaid(c.oldestOpenDays) : "None",
      label: "Oldest open",
      hint: c.open > 0 ? "Since it was received" : "No complaint open",
      tone: "plain",
    },
    {
      key: "target",
      value: daysSaid(c.targetDays),
      label: "Resolution target",
      hint: "To resolve a complaint, from the day it's received",
      tone: "plain",
    },
  ];
}

/** A target typed by the licensee: a whole number of days, 1 to 365. */
export function targetDaysProblem(typed: string): string | null {
  const raw = String(typed ?? "").trim();
  const n = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return Number.isInteger(n) && n >= 1 && n <= MAX_COMPLAINT_TARGET_DAYS
    ? null
    : `Give the target as a whole number of days, 1 to ${MAX_COMPLAINT_TARGET_DAYS}.`;
}
