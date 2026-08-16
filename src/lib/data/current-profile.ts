import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { notifyNewAgencySignup } from "@/lib/email/signup-notification";
import type { Profile } from "@/lib/types";

// Fetches the logged-in user's profile (agency + role), redirecting to
// /login if there's no session. If a session exists but the agency
// bootstrap never ran — e.g. an email-confirmation redirect that missed
// /auth/callback, which is exactly what happened before the emailRedirectTo
// fix in lib/actions/auth.ts — this self-heals by running the bootstrap
// here from the full_name/agency_name stashed in user_metadata at signup,
// rather than sending the user to a dead-end /signup page (they can't
// re-signup with an email that's already registered).
// Wrapped in React's cache() so the dashboard layout and the page rendering
// inside it share one lookup per request instead of each hitting the database.
// Both need the profile now that the layout owns the sidebar and user bar.
export const requireProfile = cache(async function requireProfile(): Promise<Profile> {
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

  const meta = user.user_metadata as {
    full_name?: string;
    agency_name?: string;
    invite_token?: string;
    licensee_email?: string | null;
    website_url?: string | null;
  };

  if (meta.invite_token || meta.agency_name) {
    const { error: joinError } = meta.invite_token
      ? await supabase.rpc("accept_invite", { p_token: meta.invite_token, p_full_name: meta.full_name ?? "" })
      : await supabase.rpc("bootstrap_agency", { p_agency_name: meta.agency_name!, p_full_name: meta.full_name ?? "" });

    // Same sign-off address write as the other two bootstrap call sites. This
    // is the last of the three, for a confirmation redirect that missed
    // /auth/callback entirely.
    if (!joinError && !meta.invite_token && typeof meta.licensee_email === "string" && meta.licensee_email) {
      await supabase.rpc("set_agency_licensee_email", { p_email: meta.licensee_email });
    }
    if (!joinError && !meta.invite_token && typeof meta.website_url === "string" && meta.website_url) {
      await supabase.rpc("set_agency_website", { p_url: meta.website_url });
    }

    if (!joinError) {
      const { data: healedProfile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

      if (healedProfile) {
        // Same "new agency, not an invite join" guard as the other two
        // bootstrap_agency call sites (lib/actions/auth.ts, auth/callback) —
        // this is the third and last place bootstrap can run, for a
        // confirmation redirect that missed /auth/callback entirely.
        if (!meta.invite_token) {
          await notifyNewAgencySignup({
            agencyName: meta.agency_name ?? "My agency",
            fullName: meta.full_name ?? "",
            email: user.email ?? "",
          });
        }
        return healedProfile as Profile;
      }
    }
  }

  redirect("/signup");
});
