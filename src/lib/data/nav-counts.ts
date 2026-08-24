import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computePropertyDigests } from "@/lib/property-digest";
import { expiryStatus } from "@/lib/expiry-status";
import type { Profile, Property, PropertyItem, PropertyStage } from "@/lib/types";

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
  /** Every outstanding task across the office — the number on the Listings row. */
  listings: number;
  /** One entry per listing, most urgent first. The sidebar shows the first few. */
  listingRows: ListingStatus[];
  signoffs: number;
  registers: number;
  /** Red where a licence has actually expired, amber where one is close. */
  registersTone: "amber" | "red";
};

export const EMPTY_NAV_COUNTS: NavCounts = {
  listings: 0,
  listingRows: [],
  signoffs: 0,
  registers: 0,
  registersTone: "amber",
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
  const { data: propertyRows } = await supabase
    .from("properties")
    .select("*")
    .order("created_at", { ascending: false });

  // Test listings are excluded everywhere here. Adam runs files in test mode
  // to try things out, and a sidebar that counts his sandbox is a sidebar he
  // learns to ignore.
  const properties = ((propertyRows ?? []) as Property[]).filter((p) => !p.test_mode);
  const propertyIds = properties.map((p) => p.id);

  const [{ data: itemRows }, { count: signoffCount }, { data: staffRows }] = await Promise.all([
    propertyIds.length > 0
      ? supabase.from("property_items").select("*").in("property_id", propertyIds)
      : Promise.resolve({ data: [] as PropertyItem[] }),
    supabase
      .from("signoff_signatures")
      .select("id", { count: "exact", head: true })
      .eq("signer_id", profile.id)
      .is("signed_at", null),
    // One query answers two questions: who the licensees are (the rules layer
    // needs it to decide whether a settled file wants "Send to licensee" or
    // "Licensee signature") and whose licence is lapsing.
    supabase.from("profiles").select("id, is_licensee_in_charge, licence_expiry"),
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

  const licences = staff.map((s) => expiryStatus(s.licence_expiry));
  const expired = licences.filter((s) => s === "expired").length;
  const urgent = licences.filter((s) => s === "urgent").length;

  return {
    listings: listingRows.reduce((n, l) => n + l.flagged + l.outstanding, 0),
    listingRows,
    signoffs: signoffCount ?? 0,
    // "soon" (within 90 days) is deliberately excluded. A licence three months
    // out is a reminder, not a badge — the licence reminder emails already
    // cover that cadence, and a number that never reaches zero stops meaning
    // anything.
    registers: expired + urgent,
    registersTone: expired > 0 ? "red" : "amber",
  };
});
