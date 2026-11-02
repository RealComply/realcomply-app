"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { normaliseWebsiteUrl } from "@/lib/normalise-url";

// "My listings page" and the Office profile's "Agents' own listings pages"
// (Adam, 2 Nov 2026; 0105). Who may change whose page is the database's rule
// (set_agent_listings_page): your own, or anyone's in the office for the
// licensee in charge, the agent on their own plan, or an office manager.

export type ListingsPageState = { error: string | null; saved: boolean };

/**
 * The address as a person types it ("raineandhorne.com.au/agents/jo"), made a
 * full https:// address. Blank is fine: it removes the page. The check reads
 * https:// pages only (lib/net/public-page.ts), so an http:// address is
 * saved as https://.
 */
export async function listingsPageAddress(raw: string): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  const normalised = normaliseWebsiteUrl(raw);
  if (!normalised.ok) return normalised;
  if (!normalised.url) return { ok: true, url: null };
  return { ok: true, url: normalised.url.replace(/^http:\/\//i, "https://") };
}

export async function saveListingsPage(_prev: ListingsPageState, formData: FormData): Promise<ListingsPageState> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const profileId = String(formData.get("profileId") ?? "").trim() || profile.id;
  const address = await listingsPageAddress(String(formData.get("listingsPage") ?? ""));
  if (!address.ok) return { error: address.error, saved: false };

  const { error } = await supabase.rpc("set_agent_listings_page", { p_profile_id: profileId, p_url: address.url });
  if (error) {
    // The database's own words where it refused (whose page, https only);
    // anything else is a plain "try again".
    const said = /listings page|isn't in your office|lists properties|Sign in again/i.test(error.message);
    return { error: said ? error.message : "Couldn't save the listings page just now. Try again.", saved: false };
  }
  revalidatePath("/dashboard/profile");
  return { error: null, saved: true };
}

/** "Keep this one" on the group-page warning, for the page as it is now. */
export async function keepListingsPage(pageKey: string): Promise<{ error: string | null }> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("keep_listings_page", { p_page_key: pageKey });
  if (error) {
    const said = /keep|Sign in again/i.test(error.message);
    return { error: said ? error.message : "Couldn't keep this page just now. Try again." };
  }
  revalidatePath("/dashboard/profile");
  return { error: null };
}
