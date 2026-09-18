"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/data/current-profile";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import { buildFounderInviteEmail, founderInviteUrl } from "@/lib/email/founder-invite";
import { formatAuDate } from "@/lib/format-date";

// Working the early-access queue: invite, or decline.
//
// Adam, 18 Sep 2026: "I want to know what it looks like once we are ready and
// live to accept invitations... so I can either deny or accept anyone that's
// registered for early access."
//
// SERVICE KEY, AND THE ORDER OF TWO LINES. Same rule as founder-invites.ts and
// the staff page: `early_access` is insert-only to the browser (0013) and
// `founder_invites` has no write policy at all, because a table whose rows are
// their own passwords should not be writable from a session. Writes therefore
// need the service key, which bypasses row-level security entirely — so the
// platform-admin check happens BEFORE the client is created, every time.
// Reversed, this becomes an endpoint any signed-in agent could use to mint
// themselves the ability to create agencies.

export type DecisionState = { error: string | null; notice?: string };

const ok: DecisionState = { error: null };

/** 32 hex characters, from the platform's own CSPRNG. Same shape as 0045 minted. */
function newToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * Accept a registrant: mint a founder invite, record it against them, and
 * email them the link.
 *
 * IDEMPOTENT ON PURPOSE. Pressing Invite twice is a normal thing to do — the
 * first press may have been slow, or the page may have been left open. Minting
 * a second token would leave two live invites for one person, either of which
 * creates an agency, and the second one silently widens the door that signups
 * being closed is supposed to keep shut. So an already-invited registrant gets
 * their EXISTING link re-sent rather than a new one.
 *
 * THE EMAIL IS ALLOWED TO FAIL WITHOUT LOSING THE INVITE. The token is written
 * first and the send happens after. If the send fails, the invite still exists
 * and the staff page shows the link to copy by hand — the reverse order would
 * mean a failed email costs the whole decision.
 */
export async function inviteFromEarlyAccess(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const profile = await requireProfile();
  if (profile.is_platform_admin !== true) {
    return { error: "Only RealComply staff can send invitations." };
  }

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing registrant." };

  const supabase = createServiceClient();

  const { data: row } = await supabase
    .from("early_access")
    .select("id, email, first_name, agency_name, invited_token, declined_at")
    .eq("id", id)
    .maybeSingle();

  if (!row) return { error: "Couldn't find that registration." };

  const registrant = row as {
    id: string;
    email: string;
    first_name: string | null;
    agency_name: string | null;
    invited_token: string | null;
    declined_at: string | null;
  };

  // Re-use the existing token, or mint one. See the note above on why this
  // must not create a second live invite.
  let token = registrant.invited_token;
  let expiresAt: string | null = null;

  if (token) {
    const { data: existing } = await supabase
      .from("founder_invites")
      .select("token, expires_at, accepted_at")
      .eq("token", token)
      .maybeSingle();

    const found = existing as { expires_at: string; accepted_at: string | null } | null;

    if (found?.accepted_at) {
      return { error: "They've already used their invitation and set up their agency." };
    }
    // An expired token is not re-sendable — a link that cannot work is worse
    // than no link, because they will try it and conclude the product is
    // broken. Mint a fresh one in that case.
    if (!found || new Date(found.expires_at) <= new Date()) {
      token = null;
    } else {
      expiresAt = found.expires_at;
    }
  }

  if (!token) {
    token = newToken();
    const label = [registrant.first_name, registrant.agency_name]
      .filter(Boolean)
      .join(" — ") || registrant.email;

    const { data: created, error: mintError } = await supabase
      .from("founder_invites")
      .insert({ token, label })
      .select("expires_at")
      .single();

    if (mintError || !created) {
      console.error("inviteFromEarlyAccess: could not mint invite", mintError?.message);
      return { error: "Couldn't create the invitation. Try again." };
    }
    expiresAt = (created as { expires_at: string }).expires_at;
  }

  // Recorded before the send, deliberately — see the note above.
  await supabase
    .from("early_access")
    .update({
      invited_at: new Date().toISOString(),
      invited_token: token,
      // Inviting someone previously declined clears the decline. The note is
      // kept: it is the reasoning, and reversing a decision does not unmake
      // the thinking behind it.
      declined_at: null,
    })
    .eq("id", registrant.id);

  const { subject, text, html } = buildFounderInviteEmail({
    firstName: registrant.first_name,
    agencyName: registrant.agency_name,
    token,
    expiresAt: formatAuDate((expiresAt ?? "").slice(0, 10)),
  });

  const sent = await sendEmail({
    to: registrant.email,
    subject,
    text,
    html,
    // Replies reach a person. This email asks someone to click a link and set
    // up an account; a noreply address on it invites exactly the hesitation
    // the message is trying to overcome.
    ...(process.env.ADMIN_NOTIFICATION_EMAIL ? { replyTo: process.env.ADMIN_NOTIFICATION_EMAIL } : {}),
  });

  revalidatePath("/dashboard/admin");

  if (!sent) {
    return {
      error: `The invitation was created but the email didn't send. Copy the link and send it yourself: ${founderInviteUrl(token)}`,
    };
  }

  return { ...ok, notice: `Invitation sent to ${registrant.email}.` };
}

/**
 * Decline a registrant.
 *
 * SENDS NOTHING, deliberately. An automated rejection reads badly to a real
 * prospect who was simply too early, and to a competitor it confirms they were
 * noticed. This is a filing decision — anything Adam wants to say, he says
 * himself, in his own words.
 *
 * The note is the point. A row that is simply gone looks identical to someone
 * who never registered, so the same name arriving in three months gets judged
 * from scratch. See 0049, and Think Real Estate on 18 Sep 2026.
 */
export async function declineEarlyAccess(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const profile = await requireProfile();
  if (profile.is_platform_admin !== true) {
    return { error: "Only RealComply staff can decline registrations." };
  }

  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  if (!id) return { error: "Missing registrant." };
  if (!note) {
    return { error: "Add a short reason — it's what stops them being reconsidered from scratch later." };
  }
  if (note.length > 300) return { error: "Keep the reason under 300 characters." };

  const supabase = createServiceClient();

  const { error } = await supabase
    .from("early_access")
    .update({ declined_at: new Date().toISOString(), declined_note: note })
    .eq("id", id)
    // Never quietly un-invite someone who already has a live link in their
    // inbox. Declining is for people still waiting on a decision.
    .is("invited_at", null);

  if (error) {
    console.error("declineEarlyAccess failed:", error.message);
    return { error: "Couldn't record that. Try again." };
  }

  revalidatePath("/dashboard/admin");
  return { ...ok, notice: "Declined. Nothing was sent to them." };
}
