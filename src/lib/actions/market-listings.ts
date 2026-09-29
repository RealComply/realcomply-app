"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import type { ListingWeighting } from "@/lib/data/market-listings";

// Everything the AGENT does to the on-market listings. Extraction writes the
// facts (extraction.ts); this file writes the judgement. Same split as
// actions/comparables.ts, for the same reason — see that file.

export type ListingActionState = { error: string | null };

/** Pressing the current mark again clears it, as on the sales. */
export async function setListingWeighting(
  propertyId: string,
  listingId: string,
  weighting: ListingWeighting | null,
): Promise<ListingActionState> {
  const { supabase } = await requireAuthContext();

  const { error } = await supabase
    .from("property_market_listings")
    .update({ weighting })
    .eq("id", listingId)
    .eq("property_id", propertyId);

  if (error) return { error: "Couldn't save that. Try again." };

  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null };
}

/** The agent's own words about one listing. */
export async function setListingNote(
  propertyId: string,
  listingId: string,
  note: string,
): Promise<ListingActionState> {
  const { supabase } = await requireAuthContext();

  const { error } = await supabase
    .from("property_market_listings")
    .update({ agent_note: note.trim() || null })
    .eq("id", listingId)
    .eq("property_id", propertyId);

  if (error) return { error: "Couldn't save that note. Try again." };

  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null };
}

/**
 * A listing the agent knows about that the report did not show — the one that
 * came on last week, or an off-portal campaign. Address is all that's required.
 */
export async function addListing(
  propertyId: string,
  _prev: ListingActionState,
  formData: FormData,
): Promise<ListingActionState> {
  const { supabase, profile } = await requireAuthContext();

  const address = String(formData.get("address") ?? "").trim();
  if (!address) return { error: "Give the address." };

  const number = (name: string): number | null => {
    const raw = String(formData.get(name) ?? "").replace(/[,\s]/g, "");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const text = (name: string): string | null => String(formData.get(name) ?? "").trim() || null;

  const { error } = await supabase.from("property_market_listings").insert({
    agency_id: profile.agency_id,
    property_id: propertyId,
    address,
    asking_price: text("askingPrice"),
    sale_method: text("saleMethod"),
    listed_date: text("listedDate"),
    bedrooms: number("bedrooms"),
    bathrooms: number("bathrooms"),
    car_spaces: number("carSpaces"),
    land_size_sqm: number("landSizeSqm"),
    source: "agent",
    as_at: null, // the original list, as at the agency agreement date
    position: 900, // after the report's own list
  });

  if (error) return { error: "Couldn't add that listing. Try again." };

  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null };
}

/**
 * Takes a listing off. Unlike the old sales rule, this IS how an agent says a
 * listing doesn't belong (Adam, 29 Sep 2026) — there is no "not comparable".
 */
export async function removeListing(propertyId: string, listingId: string): Promise<ListingActionState> {
  const { supabase } = await requireAuthContext();

  const { error } = await supabase
    .from("property_market_listings")
    .delete()
    .eq("id", listingId)
    .eq("property_id", propertyId);

  if (error) return { error: "Couldn't remove that listing." };

  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null };
}
