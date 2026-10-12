import type { SupabaseClient } from "@supabase/supabase-js";

// The estimated selling price currently on foot for a listing.
//
// WHY THIS EXISTS, 22 Aug 2026. Three separate checks read the ESP, and until
// today all three read it straight off a4 — the figure recorded at listing
// set-up:
//
//   * the daily advertised-price check (website-scan.ts), comparing the live
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

type EspData = { espLow?: unknown; espHigh?: unknown };
type RevisionDraft = {
  revisedEspLow?: unknown;
  revisedEspHigh?: unknown;
  noticeServedOn?: string;
};

// A figure as the database reads it (jsonb_to_numeric in 0066): a number, or
// a string of digits, with or without decimals, once the spaces round it are
// trimmed. Anything else is no figure at all. The two have to agree to the
// dollar: the price statement link is refused once the ESP on foot stops
// matching the one the licensee was shown (12 Oct 2026).
//
// Spaces only, because the database's btrim trims spaces only. JavaScript's
// trim() also took tabs, line breaks and non-breaking spaces, so "900000\n"
// was a revised ESP here and no figure there. The app then measured against
// the revision, while the licensee was shown a4's ESP and approved against
// it (review, 11 Oct 2026). The app only ever writes numbers. This is for a
// row written some other way.
const FIGURE = /^ *([0-9]+(?:\.[0-9]+)?) *$/;

function figure(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const match = FIGURE.exec(value);
  return match ? Number(match[1]) : null;
}

/**
 * The rule itself, from the a4 and d3 records the caller already has: d3's
 * revised figures when both are there, otherwise a4's. Pure, so the page can
 * use it without another query, and so it can be held against
 * listing_effective_esp in 0066, which applies the same rule in the database.
 */
export function espFrom(a4Data: unknown, d3Data: unknown): EffectiveEsp {
  const revision = ((d3Data ?? {}) as RevisionDraft | null) ?? {};
  const revisedLow = figure(revision.revisedEspLow);
  const revisedHigh = figure(revision.revisedEspHigh);
  // Both figures, or neither. A revision carrying only one end of a range is
  // a half-read document, and silently mixing a revised low with the original
  // high would invent a range nobody ever set.
  if (revisedLow !== null && revisedHigh !== null) {
    return {
      low: revisedLow,
      high: revisedHigh,
      revised: true,
      revisedOn: revision.noticeServedOn ?? null,
    };
  }

  const original = ((a4Data ?? {}) as EspData | null) ?? {};
  return {
    low: figure(original.espLow),
    high: figure(original.espHigh),
    revised: false,
    revisedOn: null,
  };
}

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
  return espFrom(byKey.get("a4"), byKey.get("d3"));
}

/** For messages: "the ESP" or "the revised ESP", so a finding says which it measured against. */
export function espLabel(esp: EffectiveEsp): string {
  return esp.revised ? "revised ESP" : "ESP";
}
