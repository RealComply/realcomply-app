// The council area as a form sends it (0118): the comparables card and Edit
// listing. Kept apart from the action so it can be tested without a database.

import { COUNCIL_AREA_MISSING, isCouncilArea } from "@/lib/rules/council-area";

export type CouncilAreaUpdate = { council_area: string | null; council_area_from: "agent" | null };

/**
 * What to write for the council area chosen in a form, or nothing when it's
 * unchanged. `was` is the listing's council area as the form showed it, so a
 * form that wasn't touched writes nothing, and one read off the planning
 * certificate stays "read from the planning certificate". Choosing "not
 * chosen yet" clears it. Anything not on the list of 128 is refused.
 */
export function councilAreaChange(
  raw: FormDataEntryValue | null,
  was: string | null,
): { update: CouncilAreaUpdate | null } | { error: string } {
  const chosen = typeof raw === "string" ? raw.trim() : "";
  if (chosen === (was ?? "")) return { update: null };
  if (!chosen) return { update: { council_area: null, council_area_from: null } };
  if (!isCouncilArea(chosen)) return { error: COUNCIL_AREA_MISSING };
  return { update: { council_area: chosen, council_area_from: "agent" } };
}
