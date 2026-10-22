import type { SupabaseClient } from "@supabase/supabase-js";
import { listingGateFrom, type ListingGate } from "@/lib/agent-acknowledgement";

// Whether the signed-in person's office may add a listing yet (0071,
// my_listing_gate). The database is the rule, on every insert; this is what
// the pages and createProperty ask so they can say why, instead of failing.
//
// REVERSAL (Adam, 14 Oct 2026): was 22 Sep design, annexure given to licensee within 14 days, no gate. Now: licensee signs the annexure's adoption section and the agent uploads it before their first listing. Add listing is blocked until then; nothing else is.
// REVERSAL (Adam, 14 Oct 2026): was (#42 brief, Part 4): Home reminder until adopted, nothing locked. Now: office plans can't add new listings until the licensee adopts the annexure; existing listings carry on.

// CHANGE (Adam, 23 Oct 2026, trial brief; 0087): was every listing, the first included, waits for the annexure. Now an office's first listing (counting archived and deleted ones) is free of the lock, on every plan; the lock applies from the second listing. Decided in the database (listing_gate_reason), so this check follows it unchanged.
/** Null when listings can be added; a failed check reads as open (the database still decides). */
export async function listingGate(supabase: SupabaseClient): Promise<ListingGate> {
  const { data, error } = await supabase.rpc("my_listing_gate");
  if (error) return null;
  return listingGateFrom(data);
}

/**
 * The licensee in charge's name, for the lock and the Home card. On an
 * agent's own plan, the one the agent confirmed on "Before you start", else
 * the one given at sign-up; on an office plan, the one in Office profile.
 */
export async function licenseeNameFor(
  supabase: SupabaseClient,
  agencyId: string,
  opts: { agentPlan: boolean },
): Promise<string | null> {
  if (opts.agentPlan) {
    const { data } = await supabase
      .from("agent_acknowledgements")
      .select("licensee_name")
      .eq("agency_id", agencyId)
      .order("confirmed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const confirmed = (data as { licensee_name?: string | null } | null)?.licensee_name?.trim();
    if (confirmed) return confirmed;
  }
  const { data: agency } = await supabase.from("agencies").select("licensee_name").eq("id", agencyId).maybeSingle();
  return (agency as { licensee_name?: string | null } | null)?.licensee_name?.trim() || null;
}
