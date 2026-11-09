import { formatAuDate } from "@/lib/format-date";
import { addNswBusinessDays } from "@/lib/licensee-history";
import { reformsInForce } from "./underquoting-reforms";

// The lowest price a listing's advertising can start at, and the written
// offers behind it (Adam, 9 Nov 2026; Master, 9 Nov 2026, additions 2 and 3).
//
// From 17 November 2026, s73(1) as amended: the advertised price can't be
// below the highest of
//   * the estimated selling price (ESP) on foot,
//   * the highest bid at an auction where the property was passed in, made by
//     a registered bidder (not a vendor bid), and
//   * a written offer the vendor rejected because the price was too low.
// A written offer rejected over its terms (finance, the settlement date), or
// over price and terms, leaves the advertised price as it is.
//
// Before 17 November only the ESP counts, as it always has.
//
// One rule, used by the advertised price card (c1), the offers log (d2) and
// the daily website check, so the three can never disagree.

export type RejectedFor = "price" | "terms";

/** One logged offer (d2 entries). The fields after `recordedAt` are 9 Nov 2026. */
export type OfferRecord = {
  amount: number;
  outcome: string;
  vendorInformed: boolean;
  /** Below the vendor's written instruction about which offers to pass on (Sch 2 s5). */
  belowFloor: boolean;
  /** Asked when belowFloor: does this offer mean the ESP needs revising? (Sch 2 s5(1A)) */
  needsEspRevision?: boolean | null;
  /** The offer was made in writing (Reg s12F(1)(d), 12G(1)(e): amount, conditions, date rejected, reasons). */
  inWriting?: boolean;
  conditions?: string | null;
  rejectedFor?: RejectedFor | null;
  /** YYYY-MM-DD. */
  rejectedOn?: string | null;
};

/**
 * Adam's question for offers kept in the agent's own system (Rex, LockedOn,
 * VaultRE): "Has the vendor rejected an offer that falls at or above the
 * lowest advertised price?" Then the same three things as a logged offer.
 */
export type ElsewhereOfferAnswer = {
  rejected: "yes" | "no";
  inWriting?: boolean;
  rejectedFor?: RejectedFor | null;
  amount?: number | null;
  rejectedOn?: string | null;
};

export type RaisingOffer = { amount: number; rejectedOn: string | null };

export const OFFER_QUESTION = "Has the vendor rejected an offer that falls at or above the lowest advertised price";
export const IN_WRITING_LABEL = "It was in writing";
export const WHY_REJECTED_LABEL = "Why did the vendor reject it?";
export const REJECTED_FOR_OPTIONS: { value: RejectedFor; label: string }[] = [
  { value: "price", label: "Price only" },
  { value: "terms", label: "Terms, or price and terms" },
];
// Adam, 9 Nov 2026: "a little information icon after why did the vendor reject
// it that explains the reasoning behind why you do or don't have to change the
// advertised price." Approved on the mockup.
export const WHY_REJECTED_INFO =
  "If the vendor turned down a written offer only because the price was too low, your advertised price can't start below it (s73(1)). If they turned it down over the terms, like finance or the settlement date, your advertised price can stay as it is.";
export const ONLY_PRICE_ONLY_RAISES =
  "Only a written offer rejected on price only raises the lowest price. If a higher one comes in, change the amount and date.";
export const NEEDS_REVISION_QUESTION = "Does this offer mean the ESP needs revising?";
export const NEEDS_REVISION_TELL_VENDOR =
  "This offer is below the vendor's written instruction, but it means the ESP needs revising, so the vendor must still be told of it in writing (Sch 2 s5(1A)).";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;

/** A written offer the vendor rejected on price only. Only these raise the lowest price. */
export function raisesLowestPrice(o: Pick<OfferRecord, "outcome" | "inWriting" | "rejectedFor">): boolean {
  return o.outcome === "rejected" && o.inWriting === true && o.rejectedFor === "price";
}

/**
 * The highest written offer rejected on price only, from the log and from the
 * answer for offers kept elsewhere. Null when there's none.
 */
export function highestPriceOnlyRejection(
  entries: OfferRecord[],
  elsewhere?: ElsewhereOfferAnswer | null,
): RaisingOffer | null {
  let best: RaisingOffer | null = null;
  for (const e of entries) {
    if (!raisesLowestPrice(e) || !(e.amount > 0)) continue;
    if (!best || e.amount > best.amount) best = { amount: e.amount, rejectedOn: e.rejectedOn ?? null };
  }
  if (
    elsewhere?.rejected === "yes" &&
    elsewhere.inWriting === true &&
    elsewhere.rejectedFor === "price" &&
    (elsewhere.amount ?? 0) > 0 &&
    (!best || (elsewhere.amount as number) > best.amount)
  ) {
    best = { amount: elsewhere.amount as number, rejectedOn: elsewhere.rejectedOn ?? null };
  }
  return best;
}

/** The highest bid at a pass-in, when a registered bidder made it (not a vendor bid). */
export function registeredPassInBid(outcome: {
  outcome?: string | null;
  highestBid?: number | null;
  vendorBid?: boolean | null;
} | null | undefined): number | null {
  if (!outcome || outcome.outcome !== "passed_in" || outcome.vendorBid) return null;
  return outcome.highestBid != null && outcome.highestBid > 0 ? outcome.highestBid : null;
}

export type LowestPrice = {
  /** The lowest price the advertising can start at, or null with nothing to go on. */
  floor: number | null;
  /** Which figure it is. When two are equal, the ESP is named first, then the pass-in bid. */
  source: "esp" | "pass_in" | "offer" | null;
  /** Plain words for the card: what the figure is made of. Empty with no floor. */
  why: string;
  /**
   * From 17 Nov 2026, the date of the "relevant event" that set this figure
   * (s73(4)): the ESP revised, the pass-in, or the written offer rejected on
   * price only. Null for the ESP as first given, which was never anything
   * else, and before 17 Nov. YYYY-MM-DD.
   */
  since: string | null;
};

/**
 * The lowest price the advertising can start at. Before 17 November 2026 it
 * is the ESP. From then, the highest of the ESP, a registered bidder's
 * pass-in bid and a written offer rejected on price only (s73(1)).
 */
export function lowestAdvertisedPrice(input: {
  espLow: number | null;
  /** "ESP", or "revised ESP" once a revision is on the file. */
  espName?: string;
  /** When the ESP was revised (the notice), if it was. YYYY-MM-DD. */
  espRevisedOn?: string | null;
  passInBid: number | null;
  /** The auction date the property was passed in. YYYY-MM-DD. */
  passInOn?: string | null;
  rejectedOffer: RaisingOffer | null;
  now?: Date;
}): LowestPrice {
  const espName = input.espName ?? "ESP";
  const esp = input.espLow != null && input.espLow > 0 ? input.espLow : null;
  if (!reformsInForce(input.now)) {
    return esp == null
      ? { floor: null, source: null, why: "", since: null }
      : { floor: esp, source: "esp", why: `Your ${espName} (${money(esp)}).`, since: null };
  }
  const parts: { source: "esp" | "pass_in" | "offer"; amount: number; words: string; since: string | null }[] = [];
  if (esp != null) {
    parts.push({ source: "esp", amount: esp, words: `your ${espName} (${money(esp)})`, since: input.espRevisedOn ?? null });
  }
  if (input.passInBid != null && input.passInBid > 0) {
    parts.push({
      source: "pass_in",
      amount: input.passInBid,
      words: `the registered bidder's highest bid when it passed in (${money(input.passInBid)})`,
      since: input.passInOn ?? null,
    });
  }
  if (input.rejectedOffer && input.rejectedOffer.amount > 0) {
    const on = input.rejectedOffer.rejectedOn ? `, rejected ${formatAuDate(input.rejectedOffer.rejectedOn)}` : "";
    parts.push({
      source: "offer",
      amount: input.rejectedOffer.amount,
      words: `the written offer the vendor rejected on price only (${money(input.rejectedOffer.amount)}${on})`,
      since: input.rejectedOffer.rejectedOn ?? null,
    });
  }
  if (parts.length === 0) return { floor: null, source: null, why: "", since: null };
  // Highest wins; on a tie the earlier part (ESP, then pass-in) is named.
  const top = parts.reduce((best, p) => (p.amount > best.amount ? p : best));
  const words = parts.map((p) => p.words);
  const why =
    parts.length === 1
      ? `${capitalise(words[0])}.`
      : `The ${parts.length === 2 ? "higher" : "highest"} of ${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}.`;
  return { floor: top.amount, source: top.source, why, since: top.since };
}

/**
 * s73(3), from 17 Nov 2026: after a relevant event, an online ad that starts
 * below the lowest price has to be fixed or taken down within 1 business day
 * of the agent becoming aware of it; other ads as soon as practicable. The
 * event's date is taken as when the agent knew. YYYY-MM-DD.
 */
export function onlineAdsDeadline(since: string): string {
  return addNswBusinessDays(since, 1);
}

/** "Update your online ads to start at $1,250,000 or more by 20 November 2026." */
export function fixOnlineAdsLine(floor: number, deadline: string): string {
  return `Update your online ads to start at ${money(floor)} or more by ${formatAuDate(deadline)}.`;
}

export const OTHER_ADS_LINE = "Other ads as soon as practicable (s73(3)).";
export const ADS_UPDATED_LABEL = "Online ads updated";
export const STEPS_TAKEN_LABEL = "Steps taken";
export const STEPS_TAKEN_HINT =
  "For example: changed the price on our website, and asked realestate.com.au and Domain to change theirs.";

/** What's missing from "Online ads updated", or null. */
export function adsUpdateProblem(input: { updated: boolean; on: string | null; steps: string }): string | null {
  if (!input.updated) return null;
  if (!input.on) return "Enter the date the online ads were updated.";
  if (!input.steps.trim()) return "Say what steps were taken to update the ads.";
  return null;
}

/**
 * Where the live ad stands against the deadline on a given day: before it,
 * the ad still has time; after it, it is late. Null when there's no deadline
 * (no relevant event, or before 17 Nov).
 */
export function deadlineState(since: string | null, today: string): { deadline: string; late: boolean } | null {
  if (!since) return null;
  const deadline = onlineAdsDeadline(since);
  return { deadline, late: today > deadline };
}

/** "Your advertised price can't start below $1,250,000." */
export function lowestPriceLine(floor: number): string {
  return `Your advertised price can't start below ${money(floor)}.`;
}

/**
 * The message when the advertised price starts below the lowest price, for
 * the price card and the website check. Null when it doesn't.
 */
export function belowLowestPrice(advertisedLow: number | null, lowest: LowestPrice): string | null {
  if (advertisedLow == null || lowest.floor == null || advertisedLow >= lowest.floor) return null;
  return `The advertised price starts at ${money(advertisedLow)}, below ${money(lowest.floor)}, the lowest it can start at (s73(1)). ${lowest.why}`;
}

/**
 * Whether the vendor still has to be told of this offer in writing. Every
 * offer, except one below the vendor's written instruction (Sch 2 s5), and
 * even then when it means the ESP needs revising (Sch 2 s5(1A)).
 */
export function vendorMustBeTold(o: Pick<OfferRecord, "vendorInformed" | "belowFloor" | "needsEspRevision">): boolean {
  if (o.vendorInformed) return false;
  return !o.belowFloor || o.needsEspRevision === true;
}

/**
 * What's missing from a logged offer, or null. A written offer the vendor
 * rejected needs the reason and the date (Reg s12F(1)(d)); an offer below the
 * vendor's instruction needs the ESP question answered (Sch 2 s5(1A)).
 */
export function offerProblem(o: OfferRecord, now: Date = new Date()): string | null {
  if (!(o.amount > 0)) return "Enter the offer amount.";
  // Sch 2 s5(1A) starts on 17 November: not asked before then (Master, 10 Nov 2026).
  if (o.belowFloor && o.needsEspRevision == null && reformsInForce(now)) return `Answer: ${NEEDS_REVISION_QUESTION}`;
  if (o.inWriting && o.outcome === "rejected") {
    if (!o.rejectedFor) return `Answer: ${WHY_REJECTED_LABEL}`;
    if (!o.rejectedOn) return "Enter the date the vendor rejected it.";
  }
  return null;
}

/** The same for the answer about offers kept elsewhere. */
export function elsewhereAnswerProblem(a: ElsewhereOfferAnswer): string | null {
  if (a.rejected !== "yes") return null;
  if (!a.inWriting) return null;
  if (!a.rejectedFor) return `Answer: ${WHY_REJECTED_LABEL}`;
  if (a.rejectedFor === "price") {
    if (!(a.amount && a.amount > 0)) return "Enter the amount of the offer.";
    if (!a.rejectedOn) return "Enter the date the vendor rejected it.";
  }
  return null;
}

/** One line for a logged offer in the list, with no dashes. */
export function offerSummary(o: OfferRecord): string {
  const parts = [o.outcome];
  parts.push(o.vendorInformed ? "vendor informed" : "vendor not yet informed");
  if (o.belowFloor) {
    parts.push(o.needsEspRevision ? "below the vendor's instruction, ESP needs revising" : "below the vendor's instruction");
  }
  if (o.inWriting) {
    const why = o.rejectedFor === "price" ? ", price only" : o.rejectedFor === "terms" ? ", terms" : "";
    parts.push(`in writing${o.outcome === "rejected" ? why : ""}`);
  }
  if (o.conditions) parts.push(`conditions: ${o.conditions}`);
  if (o.outcome === "rejected" && o.rejectedOn) parts.push(`rejected ${formatAuDate(o.rejectedOn)}`);
  return parts.join(" · ");
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
