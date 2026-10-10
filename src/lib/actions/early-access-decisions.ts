"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/data/current-profile";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import {
  ADMIN_COPY_ADDRESS,
  SENDER_NAME,
  buildInvitationEmail,
  invitationUnsubscribeUrl,
  invitationUrl,
  greetingName,
} from "@/lib/email/early-access-invite";
import { maySendTo } from "@/lib/early-access/rules";

// Working the early-access list: send an invitation, resend one, or decline.
//
// Adam, 18 Sep 2026: "I want to know what it looks like once we are ready and
// live to accept invitations... so I can either deny or accept anyone that's
// registered for early access." Rebuilt 10 Oct 2026 to the early access
// invites brief: a preview of the exact email first, then a second click to
// send, one person at a time.
//
// SERVICE KEY, AND THE ORDER OF TWO LINES. `early_access` is insert-only to the
// browser (0013) and `founder_invites` has no write policy at all, because a
// table whose rows are their own passwords should not be writable from a
// session. Writes therefore need the service key, which bypasses row-level
// security entirely, so the platform-admin check happens BEFORE the client is
// created, every time, in every action here. The staff page checks too, but a
// server action is a public POST endpoint and cannot lean on the page.

export type DecisionState = { error: string | null; notice?: string };

export type SendState = DecisionState & {
  /** Set after a send, so the list can move the row without a reload. */
  sent?: { id: string; invitedAt: string; invitedToken: string };
};

export type InvitePreview =
  | { error: string }
  | { error: null; to: string; bcc: string; from: string; subject: string; html: string; firstName: string | null };

const notStaff = "Only RealComply staff can do that.";

/** 32 hex characters, from the platform's own CSPRNG. Same shape as 0045 minted. */
function newToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function senderLine(): string {
  const configured = process.env.EMAIL_FROM ?? "";
  const address = /<([^>]+)>/.exec(configured)?.[1] ?? configured.trim();
  return address ? `${SENDER_NAME} <${address}>` : `${SENDER_NAME} (EMAIL_FROM is not set)`;
}

type Registrant = {
  id: string;
  email: string;
  first_name: string | null;
  invited_at: string | null;
  invited_token: string | null;
  unsubscribed_at: string | null;
  declined_at: string | null;
};

async function readRegistrant(supabase: ReturnType<typeof createServiceClient>, id: string) {
  const { data } = await supabase
    .from("early_access")
    .select("id, email, first_name, invited_at, invited_token, unsubscribed_at, declined_at")
    .eq("id", id)
    .maybeSingle();
  return (data as Registrant | null) ?? null;
}

function cannotEmail(r: Registrant): string | null {
  if (r.unsubscribed_at) return "They've unsubscribed, so they can't be emailed.";
  if (r.declined_at) return "They were declined, so they can't be emailed.";
  if (!maySendTo(r.email)) {
    return "Invitations are locked to your test addresses (getadamc3+…@gmail.com) until EARLY_ACCESS_INVITES is set to live on the live site.";
  }
  return null;
}

/**
 * The email exactly as it will go, for the confirm panel. Sends nothing and
 * writes nothing. The button's link is a stand-in: the real one is made only
 * when Send is pressed, so opening and cancelling a preview never leaves a
 * live link lying around.
 */
export async function previewEarlyAccessInvite(id: string): Promise<InvitePreview> {
  const profile = await requireProfile();
  if (profile.is_platform_admin !== true) return { error: notStaff };

  const supabase = createServiceClient();
  const r = await readRegistrant(supabase, id);
  if (!r) return { error: "Couldn't find that registration." };

  const blocked = cannotEmail(r);
  if (blocked) return { error: blocked };

  const { html, subject } = buildInvitationEmail({
    firstName: r.first_name,
    inviteUrl: invitationUrl("made-when-you-press-send"),
    unsubscribeUrl: invitationUnsubscribeUrl(r.email),
  });

  return {
    error: null,
    to: r.email,
    bcc: ADMIN_COPY_ADDRESS,
    from: senderLine(),
    subject,
    html,
    firstName: greetingName(r.first_name),
  };
}

/**
 * Send, or resend, one person's invitation.
 *
 * NEVER TWICE FOR ONE CLICK. The form carries the invited_at the page was
 * showing ("" for never). The row is then claimed by an UPDATE whose WHERE
 * clause carries that value along with "not unsubscribed" and "not declined",
 * the same claim-is-the-check pattern as the founder invite itself (0045). A
 * double click, or the same button in two tabs, sends two requests that both
 * expect the same old value; the first claim changes it, so the second matches
 * nothing and sends nothing. Checking unsubscribed and declined inside that
 * same UPDATE is what makes the check happen at the moment of sending, not
 * when the page loaded.
 *
 * RESEND makes a fresh link and expires the old one, the way "cancel" on a
 * founder invite does: expired, not deleted, so the row still records that the
 * link existed and who it was for.
 *
 * The link is recorded before the email goes. If the send fails, the
 * invitation still exists and the message gives the link to send by hand.
 */
export async function sendEarlyAccessInvite(_prev: SendState, formData: FormData): Promise<SendState> {
  const profile = await requireProfile();
  if (profile.is_platform_admin !== true) return { error: notStaff };

  const id = String(formData.get("id") ?? "");
  const seen = String(formData.get("seenInvitedAt") ?? "");
  if (!id) return { error: "Missing registrant." };

  const supabase = createServiceClient();
  const r = await readRegistrant(supabase, id);
  if (!r) return { error: "Couldn't find that registration." };

  const blocked = cannotEmail(r);
  if (blocked) return { error: blocked };

  if ((r.invited_at ?? "") !== seen) {
    return { error: "This invitation has already been sent. Reload the page to see the latest." };
  }

  // An invitation already used to set up an office is never replaced.
  if (r.invited_token) {
    const { data: old } = await supabase
      .from("founder_invites")
      .select("accepted_at")
      .eq("token", r.invited_token)
      .maybeSingle();
    if ((old as { accepted_at: string | null } | null)?.accepted_at) {
      return { error: "They've already used their invitation and set up their office." };
    }
  }

  const token = newToken();
  // Labelled with their email (brief, 10 Oct 2026), so the founder invites
  // list says exactly who each link went to.
  const { error: mintError } = await supabase.from("founder_invites").insert({ token, label: r.email });
  if (mintError) {
    console.error("sendEarlyAccessInvite: could not mint invite", mintError.message);
    return { error: "Couldn't create the invitation. Try again." };
  }

  const invitedAt = new Date().toISOString();
  let claim = supabase
    .from("early_access")
    .update({ invited_at: invitedAt, invited_token: token })
    .eq("id", r.id)
    .is("unsubscribed_at", null)
    .is("declined_at", null);
  claim = r.invited_at ? claim.eq("invited_at", r.invited_at) : claim.is("invited_at", null);
  const { data: claimed, error: claimError } = await claim.select("id");

  if (claimError || !claimed || claimed.length === 0) {
    // Lost the race, or they unsubscribed a moment ago. The link just made was
    // never sent anywhere: expire it so it can never be used.
    await supabase.from("founder_invites").update({ expires_at: new Date().toISOString() }).eq("token", token);
    if (claimError) console.error("sendEarlyAccessInvite: claim failed", claimError.message);
    return { error: "Nothing was sent. The invitation was already sent, or they can no longer be emailed. Reload the page." };
  }

  // Resend: the old link stops working now. Only an unused one.
  if (r.invited_token) {
    await supabase
      .from("founder_invites")
      .update({ expires_at: new Date().toISOString() })
      .eq("token", r.invited_token)
      .is("accepted_at", null);
  }

  const url = invitationUrl(token);
  const { subject, text, html } = buildInvitationEmail({
    firstName: r.first_name,
    inviteUrl: url,
    unsubscribeUrl: invitationUnsubscribeUrl(r.email),
  });

  const sent = await sendEmail({
    to: r.email,
    bcc: ADMIN_COPY_ADDRESS,
    replyTo: ADMIN_COPY_ADDRESS,
    fromName: SENDER_NAME,
    subject,
    text,
    html,
  });

  revalidatePath("/dashboard/admin");
  const done = { id: r.id, invitedAt, invitedToken: token };

  if (!sent) {
    return {
      error: `The invitation was made but the email didn't send. Copy the link and send it yourself: ${url}`,
      sent: done,
    };
  }

  const name = greetingName(r.first_name) ?? r.email;
  return { error: null, notice: `Invitation sent to ${name}. Copy BCC'd to ${ADMIN_COPY_ADDRESS}.`, sent: done };
}

/**
 * Decline a registrant.
 *
 * SENDS NOTHING, deliberately. An automated rejection reads badly to a real
 * prospect who was simply too early, and to a competitor it confirms they were
 * noticed. This is a filing decision. Anything Adam wants to say, he says
 * himself, in his own words.
 *
 * The note is the point. A row that is simply gone looks identical to someone
 * who never registered, so the same name arriving in three months gets judged
 * from scratch. See 0049, and Think Real Estate on 18 Sep 2026. Kept on the
 * rebuilt list by Adam, 10 Oct 2026.
 */
export async function declineEarlyAccess(_prev: DecisionState, formData: FormData): Promise<DecisionState> {
  const profile = await requireProfile();
  if (profile.is_platform_admin !== true) return { error: notStaff };

  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  if (!id) return { error: "Missing registrant." };
  if (!note) {
    return { error: "Add a short reason. It's what stops them being reconsidered from scratch later." };
  }
  if (note.length > 300) return { error: "Keep the reason under 300 characters." };

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("early_access")
    .update({ declined_at: new Date().toISOString(), declined_note: note })
    .eq("id", id)
    // Never quietly un-invite someone who already has a live link in their
    // inbox. Declining is for people still waiting on a decision.
    .is("invited_at", null)
    .select("id");

  if (error) {
    console.error("declineEarlyAccess failed:", error.message);
    return { error: "Couldn't record that. Try again." };
  }
  if (!data || data.length === 0) {
    return { error: "They've already been invited, so they can't be declined." };
  }

  revalidatePath("/dashboard/admin");
  return { error: null, notice: "Declined. Nothing was sent to them." };
}
