import type { SupabaseClient } from "@supabase/supabase-js";

// The licensed entity name given at sign-up (brief, 14 Oct 2026, Part 4),
// saved once the office exists, by whichever of the three sign-up paths
// created it (lib/actions/auth.ts, lib/auth/complete-signup.ts,
// lib/data/current-profile.ts). Recorded as given at sign-up, by the person
// signing up (0070). Never fails a sign-up: the name can be added in Office
// profile at any time.
export async function saveSignupEntityName(supabase: Pick<SupabaseClient, "rpc">, name: string): Promise<void> {
  const { error } = await supabase.rpc("set_agency_licensed_entity_name", { p_name: name, p_via: "sign_up" });
  if (error) console.error("sign-up licensed entity name not saved:", error.message);
}
