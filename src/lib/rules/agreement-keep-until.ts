// Keeping the agency agreement (Reg s8A, from 17 November 2026; Master,
// 9 Nov 2026: "Keep until" date and download reminder).
//
// Property and Stock Agents Regulation 2022, s8A, as inserted by Regulation
// 2026 No 578: "A licensee must keep an agency agreement (a) in electronic
// form, and (b) while the agreement is in force and for 3 years after the
// date the agreement ends." Sch 15 cl 1: it applies to an agreement entered
// into, or amended, after 17 November 2026. An ESP revision notice amends the
// agreement (s72A(5); see the d3 note in nsw-sales.ts), so a revision given
// from then brings an earlier agreement in too.
//
// RealComply keeps the agreement electronically on the agreement card (a3).
// The Regulation doesn't say when an agreement ends. On the file it ends at
// settlement (the settlement date on the order on the agent card) or when the
// listing is withdrawn from sale. Until then: while it is in force and for 3
// years after it ends.

import type { PropertyItem } from "@/lib/types";
import { formatAuDate } from "@/lib/format-date";
import { addYears } from "@/lib/subscription-end/dates";
import { settlementDateOf } from "./nsw-sales";

/** The day s8A starts (Sch 15 cl 1). */
export const S8A_FROM = "2026-11-17";
export const KEEP_AGREEMENT_YEARS = 3;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (v: unknown): string | null => (typeof v === "string" && ISO_DATE.test(v) ? v : null);
const sydneyToday = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/**
 * Whether s8A covers the agreement: signed from 17 November, or amended from
 * then (an ESP revision notice). No signing date on the file yet: from today.
 * Never before midnight Sydney on 17 November 2026, whatever date was typed
 * (Master, 10 Nov 2026).
 */
export function s8aApplies(
  input: { signedOn: string | null; lastAmendedOn: string | null },
  now: Date = new Date(),
): boolean {
  if (sydneyToday(now) < S8A_FROM) return false;
  const signed = isoDate(input.signedOn) ?? sydneyToday(now);
  const amended = isoDate(input.lastAmendedOn);
  return signed >= S8A_FROM || (amended !== null && amended >= S8A_FROM);
}

/** When the agreement ended on the file: withdrawn from sale, or settled. Null while it is in force. */
export function agreementEndedOn(input: { settledOn: string | null; withdrawnOn: string | null }): string | null {
  const dates = [isoDate(input.withdrawnOn), isoDate(input.settledOn)].filter((d): d is string => d !== null).sort();
  return dates[0] ?? null;
}

/** 3 years after the agreement ended. */
export function keepUntil(endedOn: string): string {
  return addYears(endedOn, KEEP_AGREEMENT_YEARS);
}

/**
 * The line on the agreement card and in the compliance record. Null when s8A
 * doesn't cover the agreement.
 */
export function keepUntilLine(
  input: { signedOn: string | null; lastAmendedOn: string | null; settledOn: string | null; withdrawnOn: string | null },
  now: Date = new Date(),
): string | null {
  if (!s8aApplies(input, now)) return null;
  const ended = agreementEndedOn(input);
  return ended
    ? `Keep until ${formatAuDate(keepUntil(ended))}, 3 years after the agreement ended (Reg s8A).`
    : "Keep until 3 years after the agreement ends, and for as long as it is in force (Reg s8A).";
}

/** The same line, from the listing's cards and its current withdrawal. */
export function keepUntilLineFor(
  cards: { a3?: Pick<PropertyItem, "event_date"> | null; d3?: Pick<PropertyItem, "data"> | null; f5?: Pick<PropertyItem, "data"> | null },
  withdrawnOn: string | null,
  now: Date = new Date(),
): string | null {
  return keepUntilLine(
    {
      signedOn: cards.a3?.event_date ?? null,
      // The latest ESP revision's notice: revisions only go forward, so it is the last amendment.
      lastAmendedOn: isoDate((cards.d3?.data as { noticeServedOn?: unknown } | null | undefined)?.noticeServedOn),
      settledOn: settlementDateOf(cards.f5),
      withdrawnOn,
    },
    now,
  );
}

/**
 * When a subscription ends (the day 0 and day 7 emails, the records page),
 * from 17 November. Null before then: no agreement is covered yet.
 */
export function agreementsDownloadLine(deleteOn: string, now: Date = new Date()): string | null {
  if (sydneyToday(now) < S8A_FROM) return null;
  return (
    "Agency agreements signed or amended from 17 November 2026 have to be kept in electronic form while " +
    "they are in force and for 3 years after they end (Property and Stock Agents Regulation 2022, s8A). " +
    `They are in your records download. Download them before ${formatAuDate(deleteOn)}, when RealComply ` +
    "deletes them with the rest of your records."
  );
}
