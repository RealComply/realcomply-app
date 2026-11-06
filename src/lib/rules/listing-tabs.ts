// THE LISTING TABS (Job B; mockup v6, Adam's OK; Master's brief, 5 Nov 2026).
//
// Listings splits four ways:
//   * On the market (the default): not yet exchanged, so Listing set-up,
//     Pre-market, On market and Campaign.
//   * Sold: from the Sold stage (exchange) until all six stages are complete,
//     with the licensee's sign-off. Each row says what's left.
//   * Settled: all six stages complete and signed off. Read only, with the
//     settlement and sign-off dates.
//   * Withdrawn from sale: taken off the market before exchange
//     (0114, listing_withdrawals). Read only until put back.
// Both moves are automatic. Agents see their own listings, the licensee the
// office's (who sees what is the database's rule, unchanged). Tabs don't
// change how listings are counted for plans: that counts listings created in
// the last 365 days, whatever their tab.
//
// No database or browser here, so every rule is tested (listing-tabs.test.ts).

import { itemsForStage, type RuleContext } from "@/lib/rules/nsw-sales";
import type { Property, PropertyItem, PropertyStage } from "@/lib/types";
import { formatAuDate, formatAuDateTimeShort } from "@/lib/format-date";

export type ListingTab = "market" | "sold" | "settled" | "withdrawn";

export const LISTING_TABS: { key: ListingTab; label: string }[] = [
  { key: "market", label: "On the market" },
  { key: "sold", label: "Sold" },
  { key: "settled", label: "Settled" },
  { key: "withdrawn", label: "Withdrawn from sale" },
];

/** The tab in a link (?tab=), or On the market. */
export function readTab(value: string | string[] | undefined): ListingTab {
  const v = Array.isArray(value) ? value[0] : value;
  return LISTING_TABS.some((t) => t.key === v) ? (v as ListingTab) : "market";
}

/** The Sold stage: a listing that reaches it has exchanged. */
export const SOLD_STAGE = 4;

/** Which tab a listing is in. */
export function tabFor(input: {
  storedStage: number;
  withdrawn: boolean;
  /** Every required card in all six stages complete. */
  allStagesComplete: boolean;
  /** The licensee in charge has signed the file off. */
  signedOff: boolean;
}): ListingTab {
  if (input.withdrawn) return "withdrawn";
  if (input.storedStage < SOLD_STAGE) return "market";
  return input.storedStage === 5 && input.allStagesComplete && input.signedOff ? "settled" : "sold";
}

/**
 * Where a file is up to across all six stages: whether every required card
 * is done, how many aren't (the licensee's signature counted on its own, not
 * as a card), and whether the licensee has signed it off.
 */
export function fileProgress(
  property: Property,
  allItems: Record<string, PropertyItem>,
  ctx: RuleContext = {},
): { allStagesComplete: boolean; cardsLeft: number; signedOff: boolean } {
  let cardsLeft = 0;
  let allStagesComplete = true;
  for (const stage of [0, 1, 2, 3, 4, 5] as PropertyStage[]) {
    for (const item of itemsForStage(stage, property, allItems, ctx)) {
      if (!item.requiredForStageCompletion || allItems[item.key]?.status === "done") continue;
      allStagesComplete = false;
      if (item.key !== "sign_licensee") cardsLeft += 1;
    }
  }
  return { allStagesComplete, cardsLeft, signedOff: allItems.sign_licensee?.status === "done" };
}

/** What a Sold row says is left: "3 cards to do", or "Licensee sign-off to do", or both. */
export function soldLeftLine(left: { cards: number; signOff: boolean }): string {
  const parts: string[] = [];
  if (left.cards > 0) parts.push(`${left.cards} card${left.cards === 1 ? "" : "s"} to do`);
  if (left.signOff) parts.push("Licensee sign-off to do");
  return parts.join(" · ");
}

/** Search on Settled and Withdrawn from sale: by address, any part, any case. */
export function matchesAddress(address: string, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return true;
  return address.toLowerCase().replace(/\s+/g, " ").includes(q);
}

// ── Withdraw from market ───────────────────────────────────────────────────

export type WithdrawReason = "seller_changed_mind" | "listed_with_another_agency" | "agreement_ended" | "other";

export const WITHDRAW_REASONS: { value: WithdrawReason; label: string }[] = [
  { value: "seller_changed_mind", label: "Seller changed their mind" },
  { value: "listed_with_another_agency", label: "Listed with another agency" },
  { value: "agreement_ended", label: "Agency agreement ended" },
  { value: "other", label: "Other" },
];

export function reasonLabel(reason: string, other?: string | null): string {
  if (reason === "other") return other?.trim() ? `Other: ${other.trim()}` : "Other";
  return WITHDRAW_REASONS.find((r) => r.value === reason)?.label ?? reason;
}

/** On the form, word for word from the mockup. */
export const WITHDRAW_EXPLAINER =
  "Use this when the property comes off the market without selling. The file is kept as it is, and it moves to Withdrawn from sale.";
export const WITHDRAW_WARNING =
  "the morning price check and reminders stop for this listing, and any cards still to do are left as they are. You can put it back on the market later.";
export const PUT_BACK_HINT = "Moves it back to On the market with every card as it was. Recorded with who and when.";
export const WITHDRAWN_READ_ONLY = "This listing is withdrawn from sale. Put it back on the market to change it.";

/** The form's answers, checked before they go to the database (which checks them again). */
export function withdrawalProblem(input: {
  withdrawnOn: string;
  reason: string;
  reasonOther: string;
  /** Today in Sydney, YYYY-MM-DD. */
  today: string;
}): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.withdrawnOn)) return "Enter the date it was withdrawn.";
  if (input.withdrawnOn > input.today) return "The date withdrawn can't be in the future.";
  if (!WITHDRAW_REASONS.some((r) => r.value === input.reason)) return "Choose a reason.";
  if (input.reason === "other" && !input.reasonOther.trim()) return "Say why it was withdrawn.";
  if (input.reasonOther.length > 500) return "Keep the reason under 500 characters.";
  return null;
}

/** Withdraw is offered before exchange only, and not on a listing already withdrawn. */
export function canOfferWithdraw(input: { storedStage: number; withdrawn: boolean }): boolean {
  return !input.withdrawn && input.storedStage < SOLD_STAGE;
}

/** The record's lines: each withdrawal, and its put-back, oldest first. */
export function withdrawalRecordLines(
  withdrawals: Array<{
    withdrawn_on: string;
    reason: string;
    reason_other: string | null;
    withdrawn_by: string | null;
    put_back_by: string | null;
    put_back_at: string | null;
  }>,
  name: (profileId: string | null) => string,
): string[] {
  const lines: string[] = [];
  for (const w of withdrawals) {
    lines.push(`Withdrawn on ${formatAuDate(w.withdrawn_on)} by ${name(w.withdrawn_by)}. Reason: ${reasonLabel(w.reason, w.reason_other)}.`);
    if (w.put_back_at) {
      lines.push(`Put back on the market on ${formatAuDateTimeShort(w.put_back_at)} (Sydney time) by ${name(w.put_back_by)}.`);
    }
  }
  return lines;
}
