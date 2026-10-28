import type { SupabaseClient } from "@supabase/supabase-js";
import { linkRequestNeedingTime } from "@/lib/rules/listing-signature";
import type { Cancellation, ReopenRequest, ReopenWhy } from "@/lib/rules/reopen";

// A listing's cancelled approvals and sign-offs, and its requests to reopen
// (0100, Adam 28 Oct 2026). Read by the listing page with the caller's own
// access: whoever can see the listing can read both.

export async function reopenHistoryFor(
  supabase: SupabaseClient,
  propertyId: string,
): Promise<{ cancellations: Cancellation[]; requests: ReopenRequest[] }> {
  const [{ data: cancelled }, { data: asked }] = await Promise.all([
    supabase
      .from("listing_signoff_cancellations")
      .select("id, item_key, card, cancelled_at, cancelled_by, because_item_key, because")
      .eq("property_id", propertyId)
      .order("cancelled_at", { ascending: false }),
    supabase
      .from("listing_reopen_requests")
      .select("id, item_key, reason, requested_by, requested_at, status, answered_by, answered_at")
      .eq("property_id", propertyId)
      .order("requested_at", { ascending: false }),
  ]);

  const cancellations: Cancellation[] = [];
  for (const row of (cancelled ?? []) as Array<Record<string, unknown>>) {
    const itemKey = row.item_key;
    if (itemKey !== "b4" && itemKey !== "sign_agent" && itemKey !== "sign_licensee") continue;
    cancellations.push({
      id: String(row.id),
      itemKey,
      card: (row.card ?? {}) as Cancellation["card"],
      cancelledAt: String(row.cancelled_at),
      cancelledBy: (row.cancelled_by as string | null) ?? null,
      becauseItemKey: (row.because_item_key as string | null) ?? null,
      because: row.because as ReopenWhy,
    });
  }

  // A signature given through the emailed link has its time on the link, not
  // on the card (lib/rules/listing-signature.ts). Only a final sign-off link.
  const linkIds = cancellations
    .filter((c) => c.itemKey !== "b4")
    .map((c) => linkRequestNeedingTime(c.card.data))
    .filter((id): id is string => Boolean(id));
  if (linkIds.length > 0) {
    const { data: links } = await supabase
      .from("property_signoff_requests")
      .select("id, signed_at")
      .eq("property_id", propertyId)
      .eq("item_key", "sign_licensee")
      .in("id", linkIds);
    const signedAt = new Map(
      ((links ?? []) as Array<{ id: string; signed_at: string | null }>).map((l) => [l.id, l.signed_at]),
    );
    for (const c of cancellations) {
      const id = c.itemKey === "b4" ? null : linkRequestNeedingTime(c.card.data);
      if (id) c.linkSignedAt = signedAt.get(id) ?? null;
    }
  }

  const requests: ReopenRequest[] = ((asked ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    itemKey: String(row.item_key),
    reason: String(row.reason),
    requestedBy: (row.requested_by as string | null) ?? null,
    requestedAt: String(row.requested_at),
    status: row.status as ReopenRequest["status"],
    answeredBy: (row.answered_by as string | null) ?? null,
    answeredAt: (row.answered_at as string | null) ?? null,
  }));

  return { cancellations, requests };
}
