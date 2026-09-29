import type { SupabaseClient } from "@supabase/supabase-js";

// Properties on the market, beside the comparable sales.
//
// Stephen Borg, 28 Sep 2026: the reasoning behind an estimated selling price
// should consider the competition — what is for sale nearby — as well as what
// has sold. Design and decisions: RealComply-on-market-properties-design.md.
//
// SAME DIVISION OF LABOUR AS THE SALES. The facts (address, the other agent's
// advertised price, beds, land) are transcription off the report. The mark —
// direct competition or considered — and the note are the agent's and only
// ever come from a person. Nothing in this file writes a weighting.
//
// AN ASKING PRICE IS NOT A SALE PRICE. It is another agent's advertised figure,
// held as free text exactly as published, and nothing here does arithmetic on
// it or compares it with the ESP.

/**
 * How the agent treated a listing. Two options, not three (Adam, 29 Sep 2026):
 * "if it's not a comparable property, it shouldn't be there" — a listing that
 * doesn't belong is removed rather than marked.
 */
export type ListingWeighting = "competition" | "considered";

export type MarketListing = {
  id: string;
  address: string;
  askingPrice: string | null;
  saleMethod: string | null;
  listedDate: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  carSpaces: number | null;
  landSizeSqm: number | null;
  internalAreaSqm: number | null;
  distanceM: number | null;
  propertyType: string | null;
  source: "report" | "agent";
  weighting: ListingWeighting | null;
  agentNote: string | null;
  /** Null for the original list (as at the agency agreement date). */
  asAt: string | null;
  position: number;
};

const numeric = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

function toListing(row: Record<string, unknown>): MarketListing {
  const w = row.weighting;
  return {
    id: String(row.id),
    address: String(row.address ?? ""),
    askingPrice: (row.asking_price as string) ?? null,
    saleMethod: (row.sale_method as string) ?? null,
    listedDate: (row.listed_date as string) ?? null,
    bedrooms: numeric(row.bedrooms),
    bathrooms: numeric(row.bathrooms),
    carSpaces: numeric(row.car_spaces),
    landSizeSqm: numeric(row.land_size_sqm),
    internalAreaSqm: numeric(row.internal_area_sqm),
    distanceM: numeric(row.distance_m),
    propertyType: (row.property_type as string) ?? null,
    source: row.source === "agent" ? "agent" : "report",
    weighting: w === "competition" || w === "considered" ? w : null,
    agentNote: (row.agent_note as string) ?? null,
    asAt: (row.as_at as string) ?? null,
    position: Number(row.position ?? 0),
  };
}

/**
 * The ORIGINAL on-market list for a listing — the one as at the agency
 * agreement date. Lists recorded at an ESP revision (as_at set) belong to the
 * revised-ESP card and are not returned here.
 *
 * Returns [] rather than throwing if the table is not there yet, so the page
 * keeps working in the window between this code deploying and migration 0050
 * being run.
 */
export async function marketListingsFor(
  supabase: SupabaseClient,
  propertyId: string,
): Promise<MarketListing[]> {
  const { data, error } = await supabase
    .from("property_market_listings")
    .select("*")
    .eq("property_id", propertyId)
    .is("as_at", null)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map(toListing);
}

/**
 * Whole days a listing had been on the market by the as-at date. Null when
 * either date is missing or the listing post-dates it — a negative count
 * would be a wrong fact, not a small one.
 */
export function daysOnMarket(listedDate: string | null, asAt: string | null): number | null {
  if (!listedDate || !asAt) return null;
  const a = Date.parse(`${listedDate.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${asAt.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "12 August 2026" from an ISO date. Null in, null out. */
export function longDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * The heading Adam chose, 28 Sep 2026: "On the market as at [date of the
 * agency agreement]" — not "now". Until the agreement date is recorded the
 * heading says so rather than guessing one.
 */
export function onMarketHeading(agreementDate: string | null | undefined): string {
  const d = longDate(agreementDate);
  return d
    ? `On the market as at ${d}`
    : "On the market as at the agency agreement date (not yet recorded)";
}
