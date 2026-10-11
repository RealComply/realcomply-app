import type { SupabaseClient } from "@supabase/supabase-js";
import { allItemsFor, getItem } from "@/lib/rules/nsw-sales";
import { ruleContextFor } from "@/lib/data/rule-context";
import type { Property, PropertyItem } from "@/lib/types";

// The licensee's review: the cards they can flag, and the cards they flagged
// that are still to be fixed (0062; Adam, 12 Oct 2026).

/** A card the licensee flagged that the agent has not marked done again (0063). */
export type OpenFlag = {
  id: string;
  itemKey: string;
  label: string;
  stage: number;
  note: string;
  mayBeBreach: boolean;
  sentBackAt: string;
};

/** A card the licensee can flag. */
export type ReviewCard = { key: string; label: string; stage: number };

// The signing steps are what a send-back resets, not something to flag.
const NOT_FLAGGABLE = new Set(["sign_agent", "sign_licensee", "send_licensee"]);

export async function openFlagsFor(supabase: SupabaseClient, propertyId: string): Promise<OpenFlag[]> {
  const { data: items } = await supabase
    .from("listing_send_back_items")
    .select("id, item_key, note, may_be_breach, send_back_id")
    .eq("property_id", propertyId)
    .is("cleared_at", null);
  const rows = (items ?? []) as Array<{
    id: string;
    item_key: string;
    note: string;
    may_be_breach: boolean;
    send_back_id: string;
  }>;
  if (rows.length === 0) return [];

  const { data: backs } = await supabase
    .from("listing_send_backs")
    .select("id, sent_back_at")
    .in(
      "id",
      [...new Set(rows.map((r) => r.send_back_id))],
    );
  const when = new Map(((backs ?? []) as Array<{ id: string; sent_back_at: string }>).map((b) => [b.id, b.sent_back_at]));

  return rows
    .map((r) => {
      const item = getItem(r.item_key);
      return {
        id: r.id,
        itemKey: r.item_key,
        label: item?.label ?? r.item_key,
        stage: item?.stage ?? 0,
        note: r.note,
        mayBeBreach: r.may_be_breach,
        sentBackAt: when.get(r.send_back_id) ?? "",
      };
    })
    .sort((a, b) => a.stage - b.stage || a.label.localeCompare(b.label));
}

/**
 * Every card on this file, in stage order, as the audit pack shows them.
 * The same rules the listing page and the pack use (allItemsFor with this
 * file's rule context), so the licensee can flag exactly the cards they read.
 */
export async function reviewCardsFor(
  supabase: SupabaseClient,
  property: Property,
  rows: PropertyItem[],
): Promise<ReviewCard[]> {
  const byKey = Object.fromEntries(rows.map((i) => [i.item_key, i]));
  const items = allItemsFor(property, byKey, await ruleContextFor(supabase, property));
  return items
    .filter((i) => !NOT_FLAGGABLE.has(i.key))
    .map((i) => ({ key: i.key, label: i.label, stage: i.stage }))
    .sort((a, b) => a.stage - b.stage);
}
