import { formatAuTimestamp } from "@/lib/format-date";

// b4, the price statement card: what the file says about it.
//
// REVERSAL (Adam, 2 Nov 2026).
// WAS: the licensee in charge's own card. They ticked it in the app, or
//   approved the price statement through a link sent to them by email
//   (property_signoff_requests, item_key 'b4'; Adam, 12 Oct 2026, option (a)).
//   This file held the rules for that link.
// NOW: any agent on the listing ticks it, to confirm the licensee in charge
//   approved the price statement. No link, no name, no date, no upload. The
//   database stamps who ticked it and when (0104), and the file reads
//   "Ticked by [name], [date]".
// WHY: the Act doesn't require the licensee's sign-off at this point; the
//   licensee already signs the whole file off before it's filed, and Adam
//   wants no extra steps that slow agents down.
//
// Every approval the licensee gave before then still reads as it did: through
// the emailed link, with the address and the time, or in RealComply.

export type PriceApproval = {
  /** The price statement recorded on the card. Null on an older row with no note. */
  text: string | null;
  /**
   * "tick": an agent's tick, from 2 Nov 2026. "link" and "app": the
   * licensee's own approval from before then, through the emailed link or in
   * the app while signed in.
   */
  via: "tick" | "link" | "app";
  /** Who ticked it; the name typed on the link; or the licensee's name in the app where it is known. */
  name: string | null;
  /** When. Null on an approval made before 0058 stamped a time. */
  at: string | null;
  /** The address the link went to. Link approvals only. */
  sentTo: string | null;
};

type ItemRow = { status?: string | null; data?: unknown; completed_by?: string | null } | null | undefined;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * Who recorded b4, how and when, read off its row. Null unless b4 is done:
 * keys on an open row prove nothing.
 *
 * "tick" when the database stamped a tick (tickedAt, 0104): only it writes
 * one, and only on a card someone signed in marks done.
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
  const nameOf = (id: string | null) => (id ? (peopleById?.get(id)?.full_name?.trim() || null) : null);

  const tickedAt = text(d.tickedAt);
  if (tickedAt) {
    return { text: note, via: "tick", name: nameOf(text(d.tickedBy) ?? row.completed_by ?? null), at: tickedAt, sentTo: null };
  }

  const at = text(d.signedAt);
  if (d.signedVia === "link" && !row.completed_by && text(d.signoffRequestId)) {
    return { text: note, via: "link", name: text(d.signedName), at, sentTo: text(d.sentTo) };
  }

  return { text: note, via: "app", name: nameOf(row.completed_by ?? text(d.signedBy)), at, sentTo: null };
}

/** "Ticked by Ana Agent, 2 November 2026", as any other card says it. */
export function tickedLine(approval: Pick<PriceApproval, "name" | "at">): string {
  const when = approval.at ? `, ${formatAuTimestamp(approval.at)}` : "";
  return `Ticked by ${approval.name ?? "a team member"}${when}`;
}

/**
 * The licensee's approval from before 2 Nov 2026, in one line, as the file
 * and the audit record have said it since 12 Oct 2026.
 */
export function earlierApprovalLine(approval: PriceApproval, when: (iso: string) => string): string {
  const at = approval.at ? `, ${when(approval.at)} (Sydney time)` : "";
  return approval.via === "link"
    ? `Approved by ${approval.name ?? "the licensee in charge"} through the emailed link to ${approval.sentTo ?? "the licensee's email"}${at}`
    : `Approved in RealComply by the licensee in charge${at}`;
}

/**
 * "$750,000 to $790,000", or "$750,000" when both ends are the same. Null
 * when not recorded.
 *
 * Whole dollars, rounding a half up, because that is how the database wrote
 * the same figures into the price statement the licensee approved by link
 * (to_char in 0066's price_statement_text). The sale price check uses it too.
 */
export function espRangeText(low: number | null, high: number | null): string | null {
  if (low === null || high === null) return null;
  const money = (n: number) =>
    `$${n.toLocaleString("en-AU", { maximumFractionDigits: 0, roundingMode: "halfExpand" })}`;
  return low === high ? money(low) : `${money(low)} to ${money(high)}`;
}
