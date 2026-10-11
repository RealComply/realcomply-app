import { espFrom } from "@/lib/data/effective-esp";

// b4, the licensee's approval of the price statement, when it goes by email.
//
// Adam, 12 Oct 2026, option (a): when the office's licensee in charge does
// not use RealComply, b4 goes to them by an emailed link, the same way as the
// final sign-off, and they approve the exact words there. The approval stays
// theirs. Before this, an office whose licensee had no login could never
// complete b4, so every listing stopped at Pre-market.
//
// Pure rules only, so the page, the card, the audit pack and the tests all
// read the same answers. The database holds the same rules in 0065 and is the
// one that counts: the app works them out to decide what to show, and to say
// no in plain words before the database does.

/** The longest price statement a link can carry. The database refuses longer (0065). */
export const PRICE_STATEMENT_MAX = 300;

/**
 * The price statement as it is stored and shown: trimmed, every run of
 * spaces or line breaks made one space. Null when empty or too long.
 *
 * Mirrors the database's own clean-up in 0065, so what the agent sees in the
 * box after sending is what the licensee reads. Counted in characters, as the
 * database counts them, not in UTF-16 units.
 */
export function normalisePriceStatement(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  if ([...text].length > PRICE_STATEMENT_MAX) return null;
  return text;
}

/**
 * Whether b4 goes to the licensee by email: true when nobody in the office is
 * an active licensee in charge on RealComply.
 *
 * A fact about the office, so everyone looking at the listing gets the same
 * answer. Not the viewer's own role, and not the plan: an agent on their own
 * plan who answered "No, someone else" has a licensee who is not on
 * RealComply, and one who answered "Yes, that's me" approves in the app.
 * people comes from agency_people() (lib/data/people.ts), which every member
 * can read. The database asks the same question (office_has_active_licensee,
 * 0065) and refuses a link when the answer is no.
 */
export function priceStatementByEmail(
  people: Array<{ is_licensee_in_charge: boolean; archived_at: string | null }>,
): boolean {
  return !people.some((p) => p.is_licensee_in_charge && !p.archived_at);
}

/**
 * What the agent does about a card the licensee sent back, where the usual
 * "fix it and mark it done" is wrong. Null for every other card.
 *
 * b4 that goes by email is the one case (review, 11 Oct 2026). Nobody signed
 * in can mark it done: the database lets only an active licensee in charge
 * do that, and the office has none. The way forward is the send form on the
 * card, and the licensee's approval clears the note (0063). Shared by the
 * note on the card and the to-do list at the top, so they say the same.
 */
export function sentBackPriceStatementLine(itemKey: string, byEmail: boolean): string | null {
  if (itemKey !== "b4" || !byEmail) return null;
  return "Send the price statement to your licensee again from this card. Their approval clears this note.";
}

export type PriceApproval = {
  /** The price statement approved. Null on an older row approved with a file and no note. */
  text: string | null;
  /** Through the emailed link, or in the app by the licensee signed in. */
  via: "link" | "app";
  /** The name typed on the link, or the licensee's name in the app where it is known. */
  name: string | null;
  /** When. Null on rows approved before 0058 stamped a time. */
  at: string | null;
  /** The address the link went to. Link approvals only. */
  sentTo: string | null;
};

type ItemRow = { status?: string | null; data?: unknown; completed_by?: string | null } | null | undefined;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * Who approved b4, how and when, read off its row. Null unless b4 is done:
 * keys on an open row prove nothing, since anyone who can see the listing can
 * write an open row's data.
 *
 * "link" only when all three marks of submit_signoff are there: signedVia
 * "link", no completed_by (nobody was signed in), and the request it came
 * from. An in-app approval always has completed_by (guard_listing_signoff,
 * 0058), so a row carrying both reads as the app, the safer reading.
 */
export function priceApproval(
  row: ItemRow,
  peopleById?: Map<string, { full_name: string | null }>,
): PriceApproval | null {
  if (!row || row.status !== "done") return null;
  const d = (row.data ?? {}) as Record<string, unknown>;
  const note = text(d.note);
  const at = text(d.signedAt);

  if (d.signedVia === "link" && !row.completed_by && text(d.signoffRequestId)) {
    return { text: note, via: "link", name: text(d.signedName), at, sentTo: text(d.sentTo) };
  }

  const who = row.completed_by ?? text(d.signedBy);
  const name = who ? (peopleById?.get(who)?.full_name?.trim() || null) : null;
  return { text: note, via: "app", name, at, sentTo: null };
}

/**
 * "$750,000 to $790,000", or "$750,000" when both ends are the same. Null
 * when not recorded.
 *
 * Whole dollars, rounding a half up, because that is how the database writes
 * the same figures into the statement the licensee approves (to_char in
 * 0065's price_statement_text). An ESP typed with cents would otherwise read
 * as one figure in the email and on the card, and another on the page.
 */
export function espRangeText(low: number | null, high: number | null): string | null {
  if (low === null || high === null) return null;
  const money = (n: number) =>
    `$${n.toLocaleString("en-AU", { maximumFractionDigits: 0, roundingMode: "halfExpand" })}`;
  return low === high ? money(low) : `${money(low)} to ${money(high)}`;
}

/**
 * The longest name the licensee can type to approve a price statement. The
 * database refuses longer (0065), and its refusal reads on the page as a
 * link that no longer works, so the page says it first.
 */
export const APPROVER_NAME_MAX = 200;

/**
 * Whether a typed name is too long to approve with. Counted in characters,
 * as the database counts them, not in UTF-16 units. The name is trimmed
 * first, as it is before it goes to the database.
 */
export function approverNameTooLong(name: string): boolean {
  return [...name.trim()].length > APPROVER_NAME_MAX;
}

/**
 * What to do when there is no email on file for the licensee in charge.
 *
 * Who can add it decides the words. The agent on their own plan can, in
 * Team. Their assistant can't, but their agent can, so that is who to ask.
 * In an office whose founder answered "No, someone else", nobody signed in
 * can see Team, so support adds it (Adam's default, 12 Oct 2026).
 */
export function noLicenseeEmailMessage(viewer: { actsAsLicensee: boolean; isAgentPlan: boolean }): string {
  if (viewer.actsAsLicensee) return "Add your licensee in charge's email in Team settings first.";
  if (viewer.isAgentPlan) return "Ask your agent to add your licensee in charge's email in Team settings.";
  return "There's no email on file for your licensee in charge. Contact RealComply support to add it.";
}

type StaleInput = { espLow: number | null; espHigh: number | null };

/**
 * True when the licensee can no longer approve this request: the ESP on foot
 * is not the one they were shown, or the ESP reasoning card is not done.
 *
 * The same test as price_request_current in 0065, which hides the request
 * from the page and refuses the approval. items is the listing's rows as
 * stored, not the page's effective statuses: the database reads a4c's stored
 * status, and the two have to agree on whether the licensee can still approve.
 */
export function priceRequestStale(
  link: StaleInput,
  items: Record<string, { status?: string | null; data?: unknown } | undefined>,
): boolean {
  if (items["a4c"]?.status !== "done") return true;
  const esp = espFrom(items["a4"]?.data, items["d3"]?.data);
  return esp.low !== link.espLow || esp.high !== link.espHigh;
}
