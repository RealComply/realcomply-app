// The ESP and its evidence, given to the vendor before the agency agreement
// is signed (s72A(2), from 17 November 2026; Adam, 9 Nov 2026: "on the ESP
// card").
//
// The amended s72A(2): before entering into the agency agreement, the agent
// gives the seller written notice of the ESP and evidence of its
// reasonableness. The ESP card already holds the evidence (the comparable
// sales report). It now also holds the date both were given to the vendor,
// and the ESP notice when it is a separate document. Cited as plain "s72A",
// which is right on both sides of the date (underquoting-reforms.ts).
//
// Only agreements signed from 17 November. One with no signing date on the
// file yet counts from today's date, so it starts asking on 17 November.
//
// Missing: Mark done is refused, as for every card whose date is the record
// (a2, the consumer guide). After the signing date: flagged, never refused,
// like the inspection after the agreement (b6). The agent may have mistyped.

import type { PropertyItem } from "@/lib/types";
import { reformsInForce } from "./underquoting-reforms";

export const ESP_GIVEN_LABEL = "Date the ESP and evidence were given to the vendor";
export const ESP_GIVEN_HINT = "Before the agency agreement was signed (s72A).";
export const ESP_NOTICE_LABEL = "The ESP notice, if it isn't part of the report";

/** Mark done without the date (from 17 November). */
export const ESP_GIVEN_MISSING = "Put in the date the ESP and evidence were given to the vendor.";

/** The card's flag when the date is after the agreement was signed. */
export const ESP_GIVEN_AFTER_SIGNING =
  "The ESP and evidence are dated after the agency agreement was signed. From 17 November they have to be given to the vendor before it is signed (s72A). If the date is a typo, correct it. If it is not, tell the licensee.";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (v: unknown): string | null => (typeof v === "string" && ISO_DATE.test(v) ? v : null);

/**
 * Whether the agreement falls under the 17 November rule. No signing date yet:
 * today. Never before midnight Sydney on 17 November 2026, whatever date was
 * typed (Master, 10 Nov 2026: nothing from the 17 Nov work shows before its
 * date), so a date typed ahead can't switch anything on early.
 */
export function espGivenApplies(agreementDate: string | null | undefined, now: Date = new Date()): boolean {
  if (!reformsInForce(now)) return false;
  const signed = isoDate(agreementDate);
  return reformsInForce(signed ? new Date(`${signed}T12:00:00+11:00`) : now);
}

/** The date on the ESP card, when there is one. */
export function espGivenOf(row: Pick<PropertyItem, "data"> | null | undefined): string | null {
  return isoDate((row?.data as { espGivenOn?: unknown } | null | undefined)?.espGivenOn);
}

/** The ESP notice on the ESP card, when one is attached. */
export function espNoticeOf(
  row: Pick<PropertyItem, "data"> | null | undefined,
): { path: string; name: string } | null {
  const d = (row?.data ?? {}) as { espNoticePath?: unknown; espNoticeFileName?: unknown };
  if (typeof d.espNoticePath !== "string" || !d.espNoticePath) return null;
  const name =
    typeof d.espNoticeFileName === "string" && d.espNoticeFileName.trim()
      ? d.espNoticeFileName.trim()
      : (d.espNoticePath.split("/").pop() ?? "ESP notice");
  return { path: d.espNoticePath, name };
}

/** Mark done: refused without the date, from 17 November. Null when it can go ahead. */
export function espGivenMissing(
  givenOn: string | null,
  agreementDate: string | null | undefined,
  now: Date = new Date(),
): string | null {
  return espGivenApplies(agreementDate, now) && !isoDate(givenOn) ? ESP_GIVEN_MISSING : null;
}

/** Given after the agreement was signed, from 17 November: the card's flag. Null otherwise. */
export function espGivenAfterSigning(
  givenOn: string | null,
  agreementDate: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const given = isoDate(givenOn);
  const signed = isoDate(agreementDate);
  if (!given || !signed || !espGivenApplies(signed, now)) return null;
  return given > signed ? ESP_GIVEN_AFTER_SIGNING : null;
}
