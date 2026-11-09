"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { councilAreaChange } from "@/lib/rules/council-area-form";
import { COUNCIL_AREA_MISSING } from "@/lib/rules/council-area";
import type { ActionState } from "@/lib/actions/auth";

/**
 * The council area chosen on the comparables card (Reg s12A; 0118), when the
 * contract's planning certificate didn't give one. The database stamps who
 * and when, and decides who may change the listing.
 */
export async function setCouncilArea(propertyId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!String(formData.get("councilArea") ?? "").trim()) return { error: COUNCIL_AREA_MISSING };
  const change = councilAreaChange(formData.get("councilArea"), null);
  if ("error" in change) return { error: change.error };
  if (!change.update) return { error: null };

  const supabase = await createClient();
  const { data, error } = await supabase.from("properties").update(change.update).eq("id", propertyId).select("id");
  if (error) {
    if (/withdrawn from sale/i.test(error.message)) return { error: "This listing is withdrawn from sale. Put it back on the market to change it." };
    return { error: "Couldn't save the council area. Try again." };
  }
  if (!data || data.length === 0) return { error: "You can't change this listing." };

  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null };
}
