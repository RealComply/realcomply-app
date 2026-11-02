import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseWebsiteUrl } from "@/lib/normalise-url";

// "Your listings page" at sign-up and when an invited agent accepts their
// invite (Adam, 2 Nov 2026; 0105). Optional, with Skip, and it NEVER blocks a
// sign-up: an address that isn't one, or a page the database refuses (an
// assistant has none), is left out, and they can add it later under Profile
// settings, "My listings page".

/** The typed address as a full https:// address, or null when blank or not an address. */
export function signupListingsPage(raw: unknown): string | null {
  const normalised = normaliseWebsiteUrl(typeof raw === "string" ? raw : "");
  if (!normalised.ok || !normalised.url) return null;
  return normalised.url.replace(/^http:\/\//i, "https://");
}

/** Saves it once the person's profile exists. Never throws. */
export async function saveSignupListingsPage(supabase: SupabaseClient, userId: string, url: unknown): Promise<void> {
  if (typeof url !== "string" || !url) return;
  try {
    const { error } = await supabase.rpc("set_agent_listings_page", { p_profile_id: userId, p_url: url });
    if (error) console.error("listings page not saved at sign-up:", error.message);
  } catch (err) {
    console.error("listings page not saved at sign-up:", err instanceof Error ? err.message : err);
  }
}
