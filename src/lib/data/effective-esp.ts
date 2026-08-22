import type { SupabaseClient } from "@supabase/supabase-js";

// The estimated selling price currently on foot for a listing.
//
// WHY THIS EXISTS, 22 Aug 2026. Three separate checks read the ESP, and until
// today all three read it straight off a4 — the figure recorded at listing
// set-up:
//
//   * the weekly advertised-price check (website-scan.ts), comparing the live
//     ad against the ESP under s73(1),
//   * the rejected-offer check (compliance.ts), flagging an offer refused at
//     or above the ESP under s73A,
//   * the licensee sign-off summary (signoff-links.ts), which is the number a
//     licensee sees at the moment they put their name to the file.
//
// None of them knew a revision had happened. On a campaign where the price
// was revised down in week six, all three spent the rest of the campaign
// measuring against a figure that had been formally superseded, and the first
// two would have produced findings that were simply wrong: the advertised
// price check against a stale higher figure flags compliant advertising, and
// against a stale lower one misses a real breach.
//
// Adam, 22 Aug 2026, on making the revision notice an upload: "the AI then
// reads it, records it, and that's how it knows what price it needs to be
// looking for when reviewing the agent's website." Correct, and it applies to
// more than the website.
//
// So: one place that answers "what is the ESP right now", and everything asks
// it rather than reading a4 and hoping.

export type EffectiveEsp = {
  low: number | null;
  high: number | null;
  /** True when this came from a revision notice rather than the original agreement. */
  revised: boolean;
  /** ISO date the revision notice was served, where one applies. */
  revisedOn: string | null;
};

type EspData = { espLow?: number; espHigh?: number };
type RevisionDraft = {
  revisedEspLow?: number;
  revisedEspHigh?: number;
  noticeServedOn?: string;
};

/**
 * Reads d3 first, then falls back to a4.
 *
 * Deliberately NOT a stored column on the property. A denormalised "current
 * ESP" would need writing from every path that can change it and would be
 * wrong the moment one of them forgot. Two rows and a null check is cheap,
 * and it cannot drift.
 */
export async function effectiveEsp(
  supabase: SupabaseClient,
  propertyId: string,
): Promise<EffectiveEsp> {
  const { data: rows } = await supabase
    .from("property_items")
    .select("item_key, data")
    .eq("property_id", propertyId)
    .in("item_key", ["a4", "d3"]);

  const byKey = new Map(
    ((rows ?? []) as Array<{ item_key: string; data: unknown }>).map((r) => [r.item_key, r.data]),
  );

  const revision = ((byKey.get("d3") ?? {}) as RevisionDraft | null) ?? {};
  // Both figures, or neither. A revision carrying only one end of a range is
  // a half-read document, and silently mixing a revised low with the original
  // high would invent a range nobody ever set.
  if (revision.revisedEspLow != null && revision.revisedEspHigh != null) {
    return {
      low: revision.revisedEspLow,
      high: revision.revisedEspHigh,
      revised: true,
      revisedOn: revision.noticeServedOn ?? null,
    };
  }

  const original = ((byKey.get("a4") ?? {}) as EspData | null) ?? {};
  return {
    low: original.espLow ?? null,
    high: original.espHigh ?? null,
    revised: false,
    revisedOn: null,
  };
}

/** For messages: "the ESP" or "the revised ESP", so a finding says which it measured against. */
export function espLabel(esp: EffectiveEsp): string {
  return esp.revised ? "revised ESP" : "ESP";
}
