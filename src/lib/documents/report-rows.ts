import type { SupabaseClient } from "@supabase/supabase-js";
import type { ComparableSaleRead, MarketListingRead } from "@/lib/documents/listing-reader";

// THE COMPARABLE-SALES REPORT'S ROWS, ADDED TO A LISTING.
//
// Moved here unchanged from lib/actions/extraction.ts on 2 Nov 2026, so the
// agent's "Read again" and Adam's re-reads on the staff page
// (lib/documents/cma-reread) add the rows the same way. Two code paths that
// are supposed to do the same thing eventually stop doing the same thing.
//
// THE AGENT'S WORK IS NEVER OVERWRITTEN. A row they have weighted or written
// a note on survives a re-read untouched, and a row they typed themselves is
// never replaced by one the model read. Someone who re-attaches a corrected
// report should not lose an afternoon's judgement to it. So a re-read only
// ever ADDS a row whose address isn't on the listing yet, and never writes a
// weighting.

export type ReportRows = {
  comparableSales?: ComparableSaleRead[];
  marketListings?: MarketListingRead[];
};

export type RowsAdded = {
  salesAdded: number;
  listingsAdded: number;
  /** Plain words, when a set of rows couldn't be written. */
  problems: string[];
};

export async function addReportRows(
  supabase: SupabaseClient,
  where: { agencyId: string; propertyId: string },
  rows: ReportRows,
): Promise<RowsAdded> {
  const added: RowsAdded = { salesAdded: 0, listingsAdded: 0, problems: [] };
  const { agencyId, propertyId } = where;

  if (rows.comparableSales?.length) {
    const { data: existingRows } = await supabase
      .from("property_comparables")
      .select("id, address")
      .eq("property_id", propertyId);

    const seen = new Set(((existingRows ?? []) as Array<{ address: string }>).map((r) => normaliseAddress(r.address)));

    const fresh = rows.comparableSales
      .filter((c) => c.address?.trim())
      .filter((c) => !seen.has(normaliseAddress(c.address)))
      .map((c, index) => ({
        agency_id: agencyId,
        property_id: propertyId,
        address: c.address.trim(),
        sale_price: c.salePrice ?? null,
        sale_date: c.saleDate ?? null,
        bedrooms: c.bedrooms ?? null,
        bathrooms: c.bathrooms ?? null,
        car_spaces: c.carSpaces ?? null,
        land_size_sqm: c.landSizeSqm ?? null,
        internal_area_sqm: c.internalAreaSqm ?? null,
        distance_m: c.distanceM ?? null,
        property_type: c.propertyType ?? null,
        source: "report",
        position: seen.size + index,
      }));

    if (fresh.length > 0) {
      const { error } = await supabase.from("property_comparables").insert(fresh);
      if (error) added.problems.push(`the sales couldn't be added (${error.message})`);
      else added.salesAdded = fresh.length;
    }
  }

  // ON THE MARKET (29 Sep 2026). Same two rules as the sales: a re-read only
  // ever ADDS listings it has not seen (matched on the normalised address),
  // and it never writes a weighting. Only the ORIGINAL list (as_at null) is
  // checked for duplicates: a list recorded at an ESP revision is a different
  // snapshot and may legitimately repeat an address.
  if (rows.marketListings?.length) {
    const { data: existingListings } = await supabase
      .from("property_market_listings")
      .select("id, address")
      .eq("property_id", propertyId)
      .is("as_at", null);

    const seenListings = new Set(
      ((existingListings ?? []) as Array<{ address: string }>).map((r) => normaliseAddress(r.address)),
    );

    const freshListings = rows.marketListings
      .filter((l) => l.address?.trim())
      .filter((l) => !seenListings.has(normaliseAddress(l.address)))
      .map((l, index) => ({
        agency_id: agencyId,
        property_id: propertyId,
        address: l.address.trim(),
        asking_price: l.askingPrice?.trim() || null,
        sale_method: l.saleMethod?.trim() || null,
        listed_date: /^\d{4}-\d{2}-\d{2}$/.test(l.listedDate ?? "") ? l.listedDate : null,
        bedrooms: l.bedrooms ?? null,
        bathrooms: l.bathrooms ?? null,
        car_spaces: l.carSpaces ?? null,
        land_size_sqm: l.landSizeSqm ?? null,
        internal_area_sqm: l.internalAreaSqm ?? null,
        distance_m: l.distanceM ?? null,
        property_type: l.propertyType ?? null,
        source: "report",
        as_at: null,
        position: seenListings.size + index,
      }));

    if (freshListings.length > 0) {
      const { error } = await supabase.from("property_market_listings").insert(freshListings);
      if (error) added.problems.push(`the listings on the market couldn't be added (${error.message})`);
      else added.listingsAdded = freshListings.length;
    }
  }

  return added;
}

// Address matching for the re-read guard above.
//
// Deliberately crude: lowercase, collapse whitespace and punctuation, and drop
// the common street-type abbreviations so "14 Smith St" and "14 Smith Street"
// are one property rather than two. It does not need to be clever: the only
// job is stopping a second read of the same report from doubling every row,
// and a false miss shows up as a visible duplicate the agent can remove, while
// a false match would silently hide a genuinely different sale. Erring towards
// the visible failure is the right way round.
export function normaliseAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(street|st|road|rd|avenue|ave|drive|dr|place|pl|court|ct|crescent|cres|parade|pde|lane|ln|way|close|cl|terrace|tce)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
