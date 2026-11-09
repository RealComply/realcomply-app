import type { SupabaseClient } from "@supabase/supabase-js";
import { espFrom, espLabel } from "@/lib/data/effective-esp";
import {
  highestPriceOnlyRejection,
  lowestAdvertisedPrice,
  registeredPassInBid,
  type ElsewhereOfferAnswer,
  type LowestPrice,
  type OfferRecord,
} from "@/lib/rules/lowest-advertised-price";

// The lowest price a listing's advertising can start at, from what is on the
// file: the ESP on foot (a4, or d3's revision), the auction outcome (x8) and
// the offers log (d2). Adam, 9 Nov 2026; s73(1) from 17 November 2026. The
// rule itself is lib/rules/lowest-advertised-price.ts.

type ItemData = Record<string, unknown> | null | undefined;

/** From the item data the caller already has (the listing page has every item). */
export function lowestPriceFromItems(
  items: { a4?: ItemData; d3?: ItemData; x8?: ItemData; d2?: ItemData },
  now?: Date,
): LowestPrice {
  const esp = espFrom(items.a4, items.d3);
  const d2 = (items.d2 ?? {}) as { entries?: OfferRecord[]; elsewhereOffer?: ElsewhereOfferAnswer | null };
  return lowestAdvertisedPrice({
    espLow: esp.low,
    espName: espLabel(esp),
    passInBid: registeredPassInBid(items.x8 as Parameters<typeof registeredPassInBid>[0]),
    rejectedOffer: highestPriceOnlyRejection(d2.entries ?? [], d2.elsewhereOffer ?? null),
    now,
  });
}

/** The same, read from the database: the price card, the offers log and the daily website check. */
export async function lowestPriceFor(supabase: SupabaseClient, propertyId: string, now?: Date): Promise<LowestPrice> {
  const { data: rows } = await supabase
    .from("property_items")
    .select("item_key, data")
    .eq("property_id", propertyId)
    .in("item_key", ["a4", "d3", "x8", "d2"]);
  const byKey = new Map(
    ((rows ?? []) as Array<{ item_key: string; data: ItemData }>).map((r) => [r.item_key, r.data]),
  );
  return lowestPriceFromItems(
    { a4: byKey.get("a4"), d3: byKey.get("d3"), x8: byKey.get("x8"), d2: byKey.get("d2") },
    now,
  );
}
