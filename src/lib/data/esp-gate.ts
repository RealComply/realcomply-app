import type { createClient } from "@/lib/supabase/server";
import { ESP_REASONING_KEY, espReasoningComplete, espReasoningMissing } from "@/lib/rules/esp-reasoning-gate";
import type { Property } from "@/lib/types";

// The listing and the ESP reasoning gate, read through the caller's own access.
//
// Moved out of lib/actions/compliance.ts on 12 Oct 2026 so the price
// statement link (lib/actions/signoff-links.ts) can check the same gate. They
// could not simply be exported from there: every export of a "use server"
// file becomes an endpoint anyone can call. compliance.ts imports them back.

type Client = Awaited<ReturnType<typeof createClient>>;

export async function loadProperty(supabase: Client, propertyId: string) {
  const { data: property } = await supabase
    .from("properties")
    .select("*")
    .eq("id", propertyId)
    .maybeSingle();
  return property as Property | null;
}

// Where the ESP reasoning card stands on this file, read fresh from the
// database. See lib/rules/esp-reasoning-gate.ts for the rule itself.
export async function espGateFor(supabase: Client, propertyId: string) {
  const [{ data: rows }, { count }, property] = await Promise.all([
    supabase
      .from("property_items")
      .select("item_key, status, data")
      .eq("property_id", propertyId)
      .in("item_key", [ESP_REASONING_KEY, "sign_licensee"]),
    supabase
      .from("property_market_listings")
      .select("id", { count: "exact", head: true })
      .eq("property_id", propertyId)
      .is("as_at", null),
    loadProperty(supabase, propertyId),
  ]);
  const byKey = new Map(
    ((rows ?? []) as { item_key: string; status: string; data: Record<string, unknown> | null }[]).map((r) => [
      r.item_key,
      r,
    ]),
  );
  const a4c = byKey.get(ESP_REASONING_KEY);
  const input = {
    status: a4c?.status ?? "open",
    data: a4c?.data ?? null,
    onMarketCount: count ?? 0,
    signedOff: byKey.get("sign_licensee")?.status === "done",
  };
  return {
    complete: espReasoningComplete(input),
    missing: espReasoningMissing(input),
    testMode: Boolean(property?.test_mode),
  };
}
