import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

// Fetches the logged-in user's profile (agency + role), redirecting to
// /login if there's no session. If a session exists but the agency
// bootstrap never ran — e.g. an email-confirmation redirect that missed
// /auth/callback, which is exactly what happened before the emailRedirectTo
// fix in lib/actions/auth.ts — this self-heals by running the bootstrap
// here from the full_name/agency_name stashed in user_metadata at signup,
// rather than sending the user to a dead-end /signup page (they can't
// re-signup with an email that's already registered).
export async function requireProfile(): Promise<Profile> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profile) {
    return profile as Profile;
  }

  const meta = user.user_metadata as { full_name?: string; agency_name?: string };

  if (meta.agency_name) {
    const { error: bootstrapError } = await supabase.rpc("bootstrap_agency", {
      p_agency_name: meta.agency_name,
      p_full_name: meta.full_name ?? "",
    });

    if (!bootstrapError) {
      const { data: healedProfile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

      if (healedProfile) {
        return healedProfile as Profile;
      }
    }
  }

  redirect("/signup");
}
