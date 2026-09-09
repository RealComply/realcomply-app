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
    licensee_name?: string | null;
    website_url?: string | null;
    is_licensee?: boolean;
    /** Permission to create a NEW agency while signups are closed — 0045. */
    founder_token?: string | null;
  };

  if (meta.invite_token || meta.agency_name) {
    // v3, not v1. Two things were wrong with calling bootstrap_agency here.
    //
    // It could not carry a founder token, so somebody invited to start their
    // own agency (0045) whose confirmation redirect missed /auth/callback would
    // land on this path and be refused — signups are closed, and v1 knows
    // nothing about invites that open the door for one person.
    //
    // And v1 records EVERY founder as the licensee in charge, which is the bug
    // migration 0029 fixed at the other two call sites and left standing at
    // this one. Defaulting to false is the safe direction: an agency with no
    // licensee is visible and fixable in Team settings, a wrongly appointed one
    // is not.
    const { error: joinError } = meta.invite_token
      ? await supabase.rpc("accept_invite", { p_token: meta.invite_token, p_full_name: meta.full_name ?? "" })
      : await supabase.rpc("bootstrap_agency_v3", {
          p_agency_name: meta.agency_name!,
          p_full_name: meta.full_name ?? "",
          p_is_licensee: meta.is_licensee === true,
          p_founder_token: meta.founder_token ?? null,
        });

    // Same sign-off address write as the other two bootstrap call sites. This
    // is the last of the three, for a confirmation redirect that missed
    // /auth/callback entirely.
    const licenseeEmail = typeof meta.licensee_email === "string" ? meta.licensee_email : "";
    const licenseeName = typeof meta.licensee_name === "string" ? meta.licensee_name : "";
    if (!joinError && !meta.invite_token && (licenseeEmail || licenseeName)) {
      await supabase.rpc("set_agency_licensee", { p_name: licenseeName, p_email: licenseeEmail });
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
