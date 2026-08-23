import type { SupabaseClient } from "@supabase/supabase-js";
import type { RuleContext } from "@/lib/rules/nsw-sales";
import type { Property } from "@/lib/types";

/**
 * The facts the rules layer needs that live outside the property row.
 *
 * ONE ANSWER PER FILE, computed the same way everywhere.
 *
 * The only fact so far is whether the agent this listing belongs to is also
 * the agency's licensee in charge, which decides whether the Settled stage
 * shows "Send to licensee" or "Licensee signature" (Adam, 23 Aug 2026).
 *
 * It has to be derived from the FILE — this listing's agent — rather than from
 * whoever is looking at the screen. A card hidden per-viewer would still be
 * required for the file to complete, so a licensee viewing their own listing
 * would be blocked by an item they cannot see, with nothing on screen
 * explaining why. Every caller that renders items and the one that checks
 * stage completion use this same helper for exactly that reason.
 */
export async function ruleContextFor(
  supabase: SupabaseClient,
  property: Pick<Property, "created_by">,
): Promise<RuleContext> {
  // created_by IS the owning agent, not merely whoever typed the form in. When
  // an assistant sets a listing up they must name the agent it belongs to, and
  // createProperty writes that person here — see the ownerId logic in
  // actions/properties.ts. So this is the right column to ask about.
  if (!property.created_by) return {};

  const { data } = await supabase
    .from("profiles")
    .select("is_licensee_in_charge")
    .eq("id", property.created_by)
    .maybeSingle();

  return {
    agentIsLicensee: (data as { is_licensee_in_charge?: boolean } | null)?.is_licensee_in_charge === true,
  };
}
