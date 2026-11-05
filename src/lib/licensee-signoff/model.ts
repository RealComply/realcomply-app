// The monthly licensee sign-off pack, and the licensee's email links (Adam,
// 3 Nov 2026; 0109). Pure: every rule here is tested (model.test.ts).
//
// WHY. In larger offices (450 sales a year) the licensee in charge doesn't
// sign each item as it comes in: the office manager brings them everything
// once a month. And a licensee with no login had no way to sign a trust
// reconciliation, the SG Manual, a training plan, a complaint or a gift.
// Signing in the pack, or by link, does exactly what signing each item on its
// own does (Adam: "This is the main rule").

export type ItemType =
  | "sales_file"
  | "trust_reconciliation"
  | "trust_audit"
  | "sg_manual"
  | "training_plan"
  | "complaint"
  | "gift";

export type Group = "sales" | "pm" | "trust" | "office";

export const GROUP_ORDER: Group[] = ["sales", "pm", "trust", "office"];

/** The pack's groups, in Adam's words. */
export const GROUP_HEADINGS: Record<Group, string> = {
  sales: "Sales files ready for final sign-off",
  pm: "Property management",
  trust: "Trust accounts",
  office: "Office",
};

/** The count tiles on the licensee's page. */
export const GROUP_TILES: Record<Group, string> = {
  sales: "Sales files",
  pm: "Property management",
  trust: "Trust reconciliations",
  office: "Office items",
};

export const GROUP_OF: Record<ItemType, Group> = {
  sales_file: "sales",
  trust_reconciliation: "trust",
  trust_audit: "trust",
  sg_manual: "office",
  training_plan: "office",
  complaint: "office",
  gift: "office",
};

/** An empty group (Adam, 3 Nov 2026). */
export const NOTHING_WAITING = "Nothing waiting this month.";

/** The one tick for the whole pack (Adam, 3 Nov 2026). */
export const PACK_TICK = "I've reviewed each item in this pack.";

/** Every page of the pack before it is signed (Adam, 3 Nov 2026). */
export const UNSIGNED_MARK = "For review. Not yet signed.";

export type WaitingItem = {
  type: ItemType;
  /** The record it signs: the sign-off request, document, audit, plan, complaint or gift. */
  id: string;
  group: Group;
  /** What it is, e.g. "7 Example Parade, Sampleton" or "Gift over $60". */
  title: string;
  /** Who and when, e.g. "Jordan Ellis · settled 9 Oct". */
  details: string;
  /** Open flags, or a gift over the limit: at the top of its group, in amber. */
  flagged: boolean;
  /** Why, e.g. "1 flag: Final sale price more than 10% above the estimate". */
  flagText: string | null;
  /** Where it opens in the app, for the office manager and a licensee with a login. */
  href: string;
  /** For ordering within a group, oldest first. */
  at: string;
};

/** Flagged first, then oldest first, within each group in the pack's order. */
export function grouped<T extends Pick<WaitingItem, "group" | "flagged" | "at" | "title">>(
  items: T[],
): Array<{ group: Group; items: T[] }> {
  return GROUP_ORDER.map((group) => ({
    group,
    items: items
      .filter((i) => i.group === group)
      .sort((a, b) =>
        a.flagged !== b.flagged ? (a.flagged ? -1 : 1) : a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.title.localeCompare(b.title),
      ),
  }));
}

export function countsByGroup(items: Array<Pick<WaitingItem, "group">>): Record<Group, number> {
  const counts: Record<Group, number> = { sales: 0, pm: 0, trust: 0, office: 0 };
  for (const i of items) counts[i.group] += 1;
  return counts;
}

// ── Months ────────────────────────────────────────────────────────────

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-10-01" -> "October". */
export function monthName(firstOfMonth: string): string {
  const m = Number(firstOfMonth.slice(5, 7));
  return MONTHS[m - 1] ?? firstOfMonth;
}

/** "2026-10-01" -> "2026-11-01". */
export function nextMonth(firstOfMonth: string): string {
  const y = Number(firstOfMonth.slice(0, 4));
  const m = Number(firstOfMonth.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

function previousMonth(firstOfMonth: string): string {
  const y = Number(firstOfMonth.slice(0, 4));
  const m = Number(firstOfMonth.slice(5, 7));
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}

/**
 * The month of the pack being prepared now. On 2 November it is October's,
 * unless October's has already gone (then November's, and so on). Sydney
 * date in, first of the month out.
 */
export function packMonthFor(sydneyToday: string, sentMonths: ReadonlySet<string>): string {
  let month = previousMonth(`${sydneyToday.slice(0, 7)}-01`);
  while (sentMonths.has(month)) month = nextMonth(month);
  return month;
}

// ── Words ─────────────────────────────────────────────────────────────

const plural = (n: number, one: string, many: string = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Licensee sign-off: October pack". */
export function packHeading(month: string): string {
  return `Licensee sign-off: ${monthName(month)} pack`;
}

/** The line under the office manager's heading (Adam, 3 Nov 2026). */
export function preparedLine(month: string, licenseeName: string, preparer: { name: string; officeManager: boolean }): string {
  const by = preparer.officeManager ? `Prepared by ${preparer.name}, office manager.` : `Prepared by ${preparer.name}.`;
  return `Everything waiting for ${possessive(licenseeName)} signature. ${by} Anything that comes in after you send goes into ${monthName(nextMonth(month))}'s pack.`;
}

function possessive(name: string): string {
  const n = name.trim() || "the licensee";
  return n.endsWith("s") ? `${n}'` : `${n}'s`;
}

/** The pack email's subject (Adam, 3 Nov 2026). */
export function packEmailSubject(month: string, n: number): string {
  return `Your ${monthName(month)} sign-off pack: ${plural(n, "item")}`;
}

/** The pack email's body line (Adam, 3 Nov 2026). Only the groups that have something. */
export function packEmailLine(p: {
  senderName: string;
  month: string;
  officeName: string;
  counts: Record<Group, number>;
  flagged: number;
  /** Adam's words, "[n] trust reconciliations", when that's all the trust group holds; else "trust items" (an audit too). */
  trustAllReconciliations?: boolean;
}): string {
  const parts = [
    p.counts.sales ? plural(p.counts.sales, "sales file") : null,
    p.counts.pm ? plural(p.counts.pm, "property management item") : null,
    p.counts.trust ? plural(p.counts.trust, p.trustAllReconciliations ? "trust reconciliation" : "trust item") : null,
    p.counts.office ? plural(p.counts.office, "office item") : null,
  ].filter((x): x is string => Boolean(x));
  const list = parts.length <= 1 ? (parts[0] ?? "nothing") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  const flagged =
    p.flagged > 0 ? ` ${p.flagged === 1 ? "1 item is" : `${p.flagged} items are`} flagged for a closer look.` : "";
  return `${p.senderName} has sent you ${monthName(p.month)}'s sign-off pack for ${p.officeName}: ${list}.${flagged}`;
}

/** Beside the Sign button (Adam, 3 Nov 2026): "Signs 40 items as Priya Nandakumar, 2 Nov 2026." */
export function signsLine(n: number, name: string, dateLabel: string): string {
  return `Signs ${plural(n, "item")} as ${name}, ${dateLabel}.`;
}

/** The button (Adam, 3 Nov 2026). */
export function signButton(n: number): string {
  return `Sign ${plural(n, "item")}`;
}

/** After signing (Adam, 3 Nov 2026). */
export function signedSummary(month: string, signed: number, name: string, dateLabel: string, held: number): string {
  return `${monthName(month)} pack signed. ${plural(signed, "item")} signed by ${name} on ${dateLabel}. ${held} held back.`;
}

/** A held-back item, after signing (Adam, 3 Nov 2026). */
export function heldBackLine(p: { officeManagerName: string | null; licenseeName: string; month: string }): string {
  const back = p.officeManagerName ? `Back with ${p.officeManagerName}` : "Back with the office";
  return `${back}, with ${possessive(p.licenseeName)} note. Goes into ${monthName(nextMonth(p.month))}'s pack.`;
}

/** On each item's own record (Adam, 3 Nov 2026): "Signed by [name], [date], in the [Month] pack". */
export function signedInPackLine(name: string, dateLabel: string, month: string): string {
  return `Signed by ${name}, ${dateLabel}, in the ${monthName(month)} pack`;
}

/** The office profile setting (Adam, 3 Nov 2026). */
export const MODE_OPTIONS = [
  {
    value: "as_they_come" as const,
    label: "As items come in",
    line: "The licensee is told about each file, reconciliation or review as it's ready.",
  },
  {
    value: "monthly" as const,
    label: "Monthly pack",
    line:
      "No emails for single items. On the 1st of each month the office manager is reminded to send the pack. If the licensee hasn't signed it within 7 days, they get a reminder.",
  },
];
export const MODE_FOOTNOTE =
  "Either way, the licensee can still sign any item on its own at any time. You can change this whenever you like.";
export type SignoffMode = (typeof MODE_OPTIONS)[number]["value"];
