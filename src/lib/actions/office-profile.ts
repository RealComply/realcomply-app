"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { ENTITY_NAME_MAX, tidyName } from "@/lib/agency-names";

// Office profile: the office's trading name and licensed entity name (brief,
// 14 Oct 2026, Parts 1 and 6; 0070). Editable at any time by the licensee in
// charge, or an agent on their own plan; the database refuses anyone else
// (set_agency_trading_name, set_agency_licensed_entity_name) and records who
// changed which name, and when (agency_name_changes).

export type OfficeNamesState = { error: string | null; saved: boolean };

export async function saveOfficeNames(_prev: OfficeNamesState, formData: FormData): Promise<OfficeNamesState> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.actsAsLicensee) {
    return { error: "Only the licensee in charge can change the office's names.", saved: false };
  }

  const trading = tidyName(String(formData.get("tradingName") ?? ""));
  const entity = tidyName(String(formData.get("licensedEntityName") ?? ""));
  if (!trading) return { error: "Type your trading name.", saved: false };
  if (trading.length > ENTITY_NAME_MAX || (entity?.length ?? 0) > ENTITY_NAME_MAX) {
    return { error: "That name is too long.", saved: false };
  }

  const { data: row } = await supabase
    .from("agencies")
    .select("name, licensed_entity_name")
    .eq("id", profile.agency_id)
    .maybeSingle();
  const current = (row ?? {}) as { name?: string | null; licensed_entity_name?: string | null };

  if (trading !== (current.name ?? null)) {
    const { error } = await supabase.rpc("set_agency_trading_name", { p_name: trading });
    if (error) {
      console.error("trading name not saved", error.message);
      return { error: "Couldn't save the trading name. Try again.", saved: false };
    }
  }
  if (entity !== (current.licensed_entity_name ?? null)) {
    const { error } = await supabase.rpc("set_agency_licensed_entity_name", {
      p_name: entity ?? "",
      p_via: "office_profile",
    });
    if (error) {
      console.error("licensed entity name not saved", error.message);
      return { error: "Couldn't save the licensed entity name. Try again.", saved: false };
    }
  }

  // The trading name is at the top of every page.
  revalidatePath("/dashboard", "layout");
  return { error: null, saved: true };
}
