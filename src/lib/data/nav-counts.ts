import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computePropertyDigests } from "@/lib/property-digest";
import { expiryStatus } from "@/lib/expiry-status";
import {
  auditDueOn,
  buildMonths,
  daysUntil,
  previousAuditPeriodEnd,
  auditPeriodEndFor,
  type ReconciliationRecord,
} from "@/lib/trust-account";
import type {
  Agency, Breach, Profile, Property, PropertyItem, PropertyStage,
  SignoffDocument, SignoffSignature, TrustAudit,
} from "@/lib/types";

// The numbers on the sidebar, and the per-listing breakdown behind the arrow.
//
// WHY THEY EXIST. The sidebar was built with room for badges and they were
// never plumbed through. Adam, 24 Aug 2026, after the CRM interface research:
// an open flag or an outstanding item should be visible from any page, not
// only once you have navigated to the file that holds it.
//
// WHAT "OUTSTANDING" MEANS (Adam, 24 Aug 2026): "what is yet to be done within
// a single stage and also what's been flagged. So the clock resets every time
// we get to a new stage. We don't wanna overwhelm the users."
//
// So, per listing:
//
//   outstanding — required items in the stage the listing is CURRENTLY in that
//                 are not done. Nothing from a later stage counts, because it
//                 has not come up yet, and nothing from an earlier one does,
//                 because completing a stage is what clears it.
//   flagged     — items marked flagged in any stage the file has reached.
//                 These deliberately do NOT reset at a stage boundary. A flag
//                 means something is actually wrong, and letting it fall off
//                 the edge of a stage would make a real problem disappear
//                 quietly. Shown in red rather than amber for that reason.
//
// Items that are not required for stage completion are excluded from the
// count. The auction-day records, the offers log and the price-quotes record
// are all real obligations but none of them is a condition of proceeding, and
// counting them would block a file on something the Act does not block it on.
//
// HONESTY RULE. A badge is a claim that something needs a person. Each count
// is narrow enough to be true, because a number that cries wolf is one people
// learn to ignore — which is worse than no number.

export type ListingStatus = {
  id: string;
  address: string;
  stage: PropertyStage;
  /** Red. Something is wrong on this file. */
  flagged: number;
  /** Amber. Left to do before this stage is complete. */
  outstanding: number;
};

export type NavCounts = {
  /**
   * Everything outstanding across the office, flagged plus to-do.
   *
   * NOT rendered as a number on the Listings row. Adam, 24 Aug 2026: "the
   * number next to listings in the sidebar makes it look like I have thirty
   * one listings" — and he is right, a number immediately after a plural noun
   * is read as a count of that noun. The row shows a red and an amber dot
   * instead and the counting happens in the breakdown underneath, where each
   * number sits against the address it belongs to. This total survives for
   * screen readers and for anything that needs a single figure.
   */
  listings: number;
  /** Split out because the row shows one dot per kind, not a combined number. */
  listingsFlagged: number;
  listingsOutstanding: number;
  /** One entry per listing, most urgent first. The sidebar shows the first few. */
  listingRows: ListingStatus[];
  /** Documents awaiting THIS person's signature. Always amber. */
  signoffs: number;
  /**
   * Everything outstanding across the registers, split by severity (Adam,
   * 25 Aug 2026: "add the orange and red dots to anything outstanding in the
   * licensee section").
   *
   * RED is for something that has actually lapsed or run out of time: an
   * expired licence or certificate, expired insurance, a notifiable breach
   * still not notified with the s89 five days running, a trust reconciliation
   * past its 21 days, an audit past 30 September.
   *
   * AMBER is for something that wants a look but has not gone wrong yet: a
   * credential inside 30 days, a flagged gift, an unresolved complaint, an open
   * breach already notified, a reconciliation waiting on a signature inside the
   * window.
   *
   * The split matters more than the total. Before this the row carried one
   * number and one colour, so an expired licence and an unresolved complaint
   * were indistinguishable from the sidebar — which is how a badge stops being
   * read.
   */
  registersRed: number;
  registersAmber: number;
};

export const EMPTY_NAV_COUNTS: NavCounts = {
  listings: 0,
  listingsFlagged: 0,
  listingsOutstanding: 0,
  listingRows: [],
  signoffs: 0,
  registersRed: 0,
  registersAmber: 0,
};

// Runs in the dashboard layout, so it runs on every page. Wrapped in cache()
// for the same reason requireProfile is — the layout, the Listings page and
// anything else that wants these numbers share one lookup per request rather
// than each paying for their own.
//
// COST, STATED PLAINLY. Working out what a stage still needs means running the
// rules engine, and the rules engine reads item data — "Material facts
// disclosed to the purchaser(s)" only appears once a material fact has been
// recorded against the file, and several auction items work the same way. So
// this fetches whole item rows rather than a light projection: a cheaper
// select would silently change which items exist, which is a wrong number
// rather than a slow one. It is the same fetch the Home dashboard already
// does. If an agency ever grows big enough for this to bite, the fix is to
// keep a per-property counter updated on write, not to trim this query.
export const navCountsFor = cache(async function navCountsFor(
  supabase: SupabaseClient,
  profile: Profile,
): Promise<NavCounts> {
  // Read once, so every deadline below is measured against the same instant.
  const today = new Date();

  const { data: propertyRows } = await supabase
    .from("properties")
    .select("*")
    .order("created_at", { ascending: false });

  // Test listings are excluded everywhere here. Adam runs files in test mode
  // to try things out, and a sidebar that counts his sandbox is a sidebar he
  // learns to ignore.
  const properties = ((propertyRows ?? []) as Property[]).filter((p) => !p.test_mode);
  const propertyIds = properties.map((p) => p.id);

  // Everything the sidebar needs, in one parallel batch. The extra register
  // queries below are all small and indexed; the cost of this function is
  // dominated by the property_items fetch above it, and they resolve inside
  // that window rather than adding to it.
  const [
    { data: itemRows },
    { data: signatureRows },
    { data: staffRows },
    { data: agencyRow },
    { count: giftCount },
    { count: complaintCount },
    { data: breachRows },
    { data: trustDocRows },
    { data: trustAuditRows },
  ] = await Promise.all([
    propertyIds.length > 0
      ? supabase.from("property_items").select("*").in("property_id", propertyIds)
      : Promise.resolve({ data: [] as PropertyItem[] }),
    // Rows rather than a count, because this one query answers two questions:
    // what is waiting on ME, and which trust reconciliations have been signed
    // by anyone. The table is small — one row per signer per document.
    supabase.from("signoff_signatures").select("document_id, signer_id, signed_at"),
    // One query answers two questions: who the licensees are (the rules layer
    // needs it to decide whether a settled file wants "Send to licensee" or
    // "Licensee signature") and whose licence is lapsing.
    supabase.from("profiles").select("id, is_licensee_in_charge, licence_expiry"),
    // A single row by primary key — the cheapest query in the batch.
    supabase
      .from("agencies")
      .select("pi_expiry, cyber_expiry, icare_expiry, corporation_licence_expiry")
      .eq("id", profile.agency_id)
      .maybeSingle(),
    supabase.from("gifts").select("id", { count: "exact", head: true }).eq("status", "flagged"),
    supabase.from("complaints").select("id", { count: "exact", head: true }).neq("status", "resolved"),
    supabase.from("breaches").select("status, notifiable, notified_date"),
    supabase.from("signoff_documents").select("id, period_month").eq("category", "trust_reconciliation"),
    supabase.from("trust_audits").select("period_end, confirmed_at"),
  ]);

  const itemsByProperty = new Map<string, Map<string, PropertyItem>>();
  for (const row of (itemRows ?? []) as PropertyItem[]) {
    if (!itemsByProperty.has(row.property_id)) itemsByProperty.set(row.property_id, new Map());
    itemsByProperty.get(row.property_id)!.set(row.item_key, row);
  }

  const staff = (staffRows ?? []) as Pick<Profile, "id" | "is_licensee_in_charge" | "licence_expiry">[];
  const licenseeIds = new Set(staff.filter((s) => s.is_licensee_in_charge).map((s) => s.id));

  // The same rollup the Portfolio page and the Monday digest use, rather than
  // a second definition of "what is outstanding" that could drift from them.
  const digests = computePropertyDigests(properties, itemsByProperty, licenseeIds);

  const listingRows: ListingStatus[] = digests
    .map((d) => ({
      id: d.property.id,
      address: d.property.address,
      stage: d.property.stage,
      flagged: d.flagged.length,
      outstanding: Math.max(0, d.requiredCurrentStage.length - d.doneCurrentStage.length),
    }))
    // Flagged first, then whoever has the most left to do, then alphabetical.
    // The reason to open the list is to find where to go next, so the answer
    // belongs at the top.
    .sort(
      (a, b) =>
        b.flagged - a.flagged ||
        b.outstanding - a.outstanding ||
        a.address.localeCompare(b.address, "en-AU"),
    );

  const signatures = (signatureRows ?? []) as Pick<
    SignoffSignature,
    "document_id" | "signer_id" | "signed_at"
  >[];

  // ── The registers rollup ────────────────────────────────────────────────
  const agency = agencyRow as Pick<
    Agency,
    "pi_expiry" | "cyber_expiry" | "icare_expiry" | "corporation_licence_expiry"
  > | null;

  const credentialStatuses = staff.map((s) => expiryStatus(s.licence_expiry));
  if (agency?.corporation_licence_expiry) {
    credentialStatuses.push(expiryStatus(agency.corporation_licence_expiry));
  }
  const insuranceStatuses = agency
    ? [agency.pi_expiry, agency.cyber_expiry, agency.icare_expiry].map((d) => expiryStatus(d))
    : [];
  const allExpiries = [...credentialStatuses, ...insuranceStatuses];

  const breachRowsTyped = (breachRows ?? []) as Pick<Breach, "status" | "notifiable" | "notified_date">[];
  // s89 gives five days to notify. A notifiable breach that has not been
  // notified is the one with a clock on it, so it is the red one; an open
  // breach already notified is work in progress.
  const breachesUnnotified = breachRowsTyped.filter((b) => b.notifiable && !b.notified_date).length;
  const breachesOpen = breachRowsTyped.filter((b) => b.status !== "closed").length;

  // Trust account. Reuses the same helpers the Trust register screen uses, so
  // the dot and the page can never disagree about whether something is late.
  const trustRecords = new Map<string, ReconciliationRecord>();
  for (const doc of (trustDocRows ?? []) as Pick<SignoffDocument, "id" | "period_month">[]) {
    if (!doc.period_month || trustRecords.has(doc.period_month)) continue;
    trustRecords.set(doc.period_month, {
      documentId: doc.id,
      month: doc.period_month,
      fileName: null,
      uploadedByName: null,
      signedAt: signatures.find((sig) => sig.document_id === doc.id && sig.signed_at)?.signed_at ?? null,
    });
  }
  const trustMonths = buildMonths(auditPeriodEndFor(today), trustRecords, today);
  const trustOverdue = trustMonths.filter((m) => m.status === "overdue").length;
  const trustPending = trustMonths.filter(
    (m) => m.status === "awaiting_signature" || m.status === "awaiting_upload",
  ).length;

  const auditPeriod = previousAuditPeriodEnd(today);
  const audit = ((trustAuditRows ?? []) as Pick<TrustAudit, "period_end" | "confirmed_at">[]).find(
    (a) => a.period_end === auditPeriod,
  );
  const auditOutstanding = !audit?.confirmed_at;
  const auditLate = auditOutstanding && daysUntil(auditDueOn(auditPeriod), today) < 0;

  const registersRed =
    allExpiries.filter((st) => st === "expired").length +
    breachesUnnotified +
    trustOverdue +
    (auditLate ? 1 : 0);

  const registersAmber =
    allExpiries.filter((st) => st === "urgent").length +
    (giftCount ?? 0) +
    (complaintCount ?? 0) +
    (breachesOpen - breachesUnnotified > 0 ? breachesOpen - breachesUnnotified : 0) +
    trustPending +
    (auditOutstanding && !auditLate ? 1 : 0);

  const listingsFlagged = listingRows.reduce((n, l) => n + l.flagged, 0);
  const listingsOutstanding = listingRows.reduce((n, l) => n + l.outstanding, 0);

  return {
    listings: listingsFlagged + listingsOutstanding,
    listingsFlagged,
    listingsOutstanding,
    listingRows,
    // "soon" (within 90 days) is deliberately excluded from both. A licence
    // three months out is a reminder, not a badge — the licence reminder emails
    // already cover that cadence, and a dot that never goes out stops meaning
    // anything.
    signoffs: signatures.filter((sig) => sig.signer_id === profile.id && !sig.signed_at).length,
    registersRed,
    registersAmber,
  };
});
