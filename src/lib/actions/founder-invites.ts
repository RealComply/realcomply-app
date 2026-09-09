"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/data/current-profile";
import { createServiceClient } from "@/lib/supabase/service";

// Making and cancelling founder invites — the links that let somebody set up
// their OWN agency (migration 0045).
//
// Adam, 9 Sep 2026: "the only way I can generate an invitation link is through
// the team. And I have to select agent, assistant, or licensee in charge. But
// that's only to invite people into my team. Which isn't what I want to do."
//
// He is right, and the gap was mine. 0045 minted ten links and left the only
// way to read them in the SQL editor — so the interface offered exactly one
// invite button, the one that does the wrong thing. Somebody looking for a
// feature reasonably concludes the nearest thing IS the feature, and the
// nearest thing here would have put a friend from another office inside Cass
// Property, looking at Cass's listings and trust records.
//
// This is the same correction as the RealComply master switch a few hours
// earlier: something done once in SQL is fine, and something done every time
// belongs on a screen.
//
// SERVICE KEY, AND WHY THE ORDER OF TWO LINES MATTERS. founder_invites has a
// select policy for platform admins and deliberately NO insert or update
// policy — a table whose rows are their own passwords should not be writable
// from a browser session. So writes need the service key, which bypasses RLS
// entirely, and the admin check therefore has to happen BEFORE the client is
// created. Reversed, this would be an endpoint any signed-in agent could use
// to mint themselves a way to create agencies.

export type FounderInviteState = { error: string | null };

const ok: FounderInviteState = { error: null };

/** 32 hex characters, from the platform's own CSPRNG. Same shape as the ones 0045 minted. */
function newToken(): string {
  return crypto.randomUUID().replace(/-/g, "") ;
}

export async function createFounderInvite(
  _prev: FounderInviteState,
  formData: FormData,
): Promise<FounderInviteState> {
  const profile = await requireProfile();
  if (profile.is_platform_admin !== true) {
    return { error: "Only RealComply staff can create founder invites." };
  }

  // Who it is for. Required, and deliberately so — an unlabelled invite is a
  // row you cannot account for later, and the whole point of one link per
  // person is being able to say which person.
  const label = String(formData.get("label") ?? "").trim();
  if (!label) {
    return { error: "Add a name so you know who this link went to." };
  }
  if (label.length > 120) {
    return { error: "Keep the name shorter than 120 characters." };
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("founder_invites").insert({
    token: newToken(),
    label,
  });

  if (error) {
    console.error("createFounderInvite failed:", error.message);
    return { error: "Couldn't create that invite — try again." };
  }

  revalidatePath("/dashboard/admin");
  return ok;
}

/**
 * Cancels an unused invite by expiring it.
 *
 * EXPIRED, NOT DELETED, and the difference is the point. The row stays as a
 * record that the link existed and who it was for — which is what you want if
 * the reason for cancelling is that it went to the wrong person. An expired
 * link also refuses politely on the signup page, where a deleted one would look
 * identical to a typo and invite a "the link you sent is broken" conversation.
 */
export async function expireFounderInvite(token: string): Promise<FounderInviteState> {
  const profile = await requireProfile();
  if (profile.is_platform_admin !== true) {
    return { error: "Only RealComply staff can cancel founder invites." };
  }

  const supabase = createServiceClient();
  // Only an unused one. A spent invite has already produced an agency and
  // "cancelling" it would say something untrue about a real account.
  const { error } = await supabase
    .from("founder_invites")
    .update({ expires_at: new Date().toISOString() })
    .eq("token", token)
    .is("accepted_at", null);

  if (error) {
    console.error("expireFounderInvite failed:", error.message);
    return { error: "Couldn't cancel that invite — try again." };
  }

  revalidatePath("/dashboard/admin");
  return ok;
}
