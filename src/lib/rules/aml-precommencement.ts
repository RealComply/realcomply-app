// AML/CTF pre-commencement customers — the rule, in one place.
//
// See supabase/migrations/0018_aml_precommencement.sql for the full reasoning.
// The short version: real estate became a reporting sector on 1 July 2026, a
// seller's agent starts providing the designated service when the agency
// agreement is signed, and AUSTRAC does not require initial CDD to keep
// serving a customer whose business relationship predates commencement.
//
// This file is the rules layer, not the engine — when the multi-tenant/
// multi-state split happens (RealComply-rules-schema.md) the date and the
// conditions below are content, and everything that reads them is engine.
// Federal law, so unlike nsw-sales.ts this one does NOT vary by state.

import type { PropertyItem } from "@/lib/types";

/**
 * The day the real-estate sector became reporting entities. An agency
 * agreement signed strictly before this date is capable of being a
 * pre-commencement relationship; one signed on or after it is not.
 */
export const AML_COMMENCEMENT_DATE = "2026-07-01";

/**
 * True where the agency agreement recorded on a3 predates commencement.
 *
 * Reads a3's event_date — the date the agent entered as "the date this
 * happened", which setItemStatus requires before a3 can be marked done. Not
 * extracted_date, and not created_at: what matters is when the agreement was
 * signed, not when anyone typed it in or when the AI read it off a PDF.
 *
 * Returns false when there is no date at all. An unanswered question is not
 * an exemption.
 */
export function agreementPredatesAml(allItems: Record<string, PropertyItem>): boolean {
  const signed = allItems["a3"]?.event_date;
  if (!signed) return false;
  return signed < AML_COMMENCEMENT_DATE;
}

/**
 * The conditions shown on the item card and stored with the record.
 *
 * Kept as data rather than prose buried in a component because they are the
 * substance of the exemption, they get written into the file as the reason
 * the item was closed, and they are what an auditor would read. If any of
 * them turns out to be wrong, this is the one place to correct it.
 */
export const PRE_COMMENCEMENT_CONDITIONS = [
  "The relationship must be a business relationship, not an occasional transaction. This is the unsettled point — confirm the agency's position with your adviser.",
  "Ongoing monitoring still applies from 1 July 2026, including keeping customer information current.",
  "If a suspicious matter report obligation arises for this vendor, the full check must be completed.",
  "If the nature or purpose of the relationship changes significantly and the risk becomes medium or high, the full check must be completed.",
  "The exemption dies with the agreement. A renewal, extension or new agreement signed on or after 1 July 2026 is a new service and needs the full check.",
] as const;

/**
 * What gets written into the item's note, so the file explains itself without
 * anyone having to remember this conversation.
 */
export function preCommencementNote(agreementDate: string): string {
  return [
    `No identity check recorded with an AML provider: treated as a pre-commencement customer.`,
    `The agency agreement was signed ${agreementDate}, before the sector's commencement date of ${AML_COMMENCEMENT_DATE}.`,
    `This is the agency's position under AUSTRAC's pre-commencement customer guidance, taken by the licensee in charge, not a determination by RealComply.`,
    `Ongoing monitoring obligations continue to apply.`,
  ].join(" ");
}
