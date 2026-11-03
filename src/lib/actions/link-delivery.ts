"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAuthContext } from "@/lib/actions/compliance";
import { appBaseUrl } from "@/lib/site-url";
import type { LinkKind } from "@/lib/links/delivery";

// Email that gets through (Adam, 2 Nov 2026; 0107). See lib/links/delivery.ts.

/**
 * A person opened an emailed link in a browser. Called by the page itself
 * (components/links/OpenedBeacon.tsx) once they scroll, tap, move the mouse
 * or type, never on the page load a security scanner makes. With the
 * visitor's own session, so someone signed in to the same office (an agent
 * checking a link they copied) doesn't count. Says nothing back, and never
 * throws: it must not get in the way of the page.
 */
export async function noteLinkOpened(kind: LinkKind, token: string): Promise<void> {
  if (!["signoff", "office_manager", "annexure"].includes(kind)) return;
  if (!/^[0-9a-f-]{36}$/i.test(token)) return;
  try {
    const supabase = await createClient();
    await supabase.rpc("note_link_opened", { p_kind: kind, p_token: token });
  } catch {
    // Nothing to do: an open that isn't recorded only means the card says
    // "Not opened yet" a little longer.
  }
}

/**
 * Copy link on the file sign-off (option 2, Adam 3 Nov 2026). The database
 * records who copied it and when, then hands back the link; a signature
 * given after a copy says so on the record (0107).
 */
export async function copySignoffLink(requestId: string, propertyId: string): Promise<{ url: string | null; error: string | null }> {
  const { supabase } = await requireAuthContext();
  const { data, error } = await supabase.rpc("copy_signoff_link", { p_request_id: requestId });
  if (error || typeof data !== "string") {
    const said = error && (error.code === "P0001" || error.code === "42501") && error.message;
    return { url: null, error: said || "Couldn't copy the link just now. Try again." };
  }
  revalidatePath(`/dashboard/${propertyId}`);
  return { url: `${appBaseUrl()}/signoff/${data}`, error: null };
}
