"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/data/current-profile";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import {
  ADMIN_COPY_ADDRESS,
  SENDER_NAME,
  buildPersonalInvitationEmail,
  greetingName,
  invitationUrl,
} from "@/lib/email/early-access-invite";
import { isTestAddress, looksLikeEmail, personalInviteMaySendTo } from "@/lib/early-access/rules";

// Emailing and cancelling founder invites (Personal invites on the staff
// page since 12 Oct 2026) — the links that let somebody set up
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

// ── Emailing a personal invite (12 Oct 2026) ─────────────────────────────
//
// Adam, 12 Oct 2026: "I would like anyone that I personally invite to ... have
// the same functionality as early access invites. So I can send the
// invitation via the website." He had made a link for another agent and the
// only option was still to copy it into his own email.
//
// So a personal invite now works like the early access list: type a first
// name and an email, preview the exact email, then a second click sends it,
// BCC'd to admin@realcomply.com.au. Copy link stays, for when he would rather
// send it himself. Migration 0064 adds email, first_name and sent_at.
//
// Three ways in, one action:
//   - New: no token. A fresh link is made and emailed.
//   - Email it: the token of a link made earlier and never emailed. That same
//     link is emailed, so one he already texted keeps working.
//   - Resend: the token of one already emailed. A fresh link is made and the
//     old one expired, the same rule as Resend on the early access list.
//
// SERVICE KEY, and the admin check comes first, for the reason at the top of
// this file.

export type PersonalInvitePreview =
  | { error: string }
  | { error: null; to: string; bcc: string; from: string; subject: string; html: string };

export type PersonalInviteState = FounderInviteState & { notice?: string };

type InviteRecord = {
  token: string;
  label: string;
  email: string | null;
  first_name: string | null;
  sent_at: string | null;
  accepted_at: string | null;
};

function senderLine(): string {
  const configured = process.env.EMAIL_FROM ?? "";
  const address = /<([^>]+)>/.exec(configured)?.[1] ?? configured.trim();
  return address ? `${SENDER_NAME} <${address}>` : `${SENDER_NAME} (EMAIL_FROM is not set)`;
}

function checkRecipient(email: string): string | null {
  if (!email) return "Add their email address.";
  if (!looksLikeEmail(email)) return "That email address doesn't look right. Check it and try again.";
  if (!personalInviteMaySendTo(email)) {
    return "This is a test copy of the site, so invitations only go to your test addresses (getadamc3+…@gmail.com). Use the live site to invite someone real.";
  }
  return null;
}

/** The email exactly as it will go. Sends nothing and writes nothing. */
export async function previewPersonalInvite(input: {
  firstName: string;
  email: string;
}): Promise<PersonalInvitePreview> {
  const profile = await requireProfile();
  if (profile.is_platform_admin !== true) return { error: "Only RealComply staff can do that." };

  const email = input.email.trim();
  const blocked = checkRecipient(email);
  if (blocked) return { error: blocked };

  const { html, subject } = buildPersonalInvitationEmail({
    firstName: input.firstName.trim() || null,
    inviteUrl: invitationUrl("made-when-you-press-send"),
  });
  return { error: null, to: email, bcc: ADMIN_COPY_ADDRESS, from: senderLine(), subject, html };
}

export async function sendPersonalInvite(
  _prev: PersonalInviteState,
  formData: FormData,
): Promise<PersonalInviteState> {
  const profile = await requireProfile();
  if (profile.is_platform_admin !== true) {
    return { error: "Only RealComply staff can send invitations." };
  }

  const existingToken = String(formData.get("token") ?? "").trim();
  let firstName = String(formData.get("firstName") ?? "").trim();
  let email = String(formData.get("email") ?? "").trim();
  let label = String(formData.get("label") ?? "").trim();
  if (firstName.length > 80) return { error: "Keep the first name shorter than 80 characters." };
  if (label.length > 120) return { error: "Keep the agency shorter than 120 characters." };

  const supabase = createServiceClient();
  const now = () => new Date().toISOString();

  let token: string;
  let newlyMade = false;

  if (existingToken) {
    // Only a link that still works. Expiry is the database's clock, as on the
    // staff page, because that is the clock that decides at signup.
    const { data } = await supabase
      .from("founder_invites")
      .select("token, label, email, first_name, sent_at, accepted_at")
      .eq("token", existingToken)
      .gt("expires_at", "now()")
      .maybeSingle();
    const row = data as InviteRecord | null;
    if (!row) return { error: "That invite has expired or been cancelled. Make a new one." };
    if (row.accepted_at) return { error: "They've already used this invite and set up their office." };

    // A resend goes to the address on record unless a new one was typed.
    email = email || row.email || "";
    firstName = firstName || row.first_name || "";
    label = label || row.label;
    const blocked = checkRecipient(email);
    if (blocked) return { error: blocked };

    if (!row.sent_at) {
      // EMAIL IT: the same link, claimed so two clicks send one email.
      const { data: claimed } = await supabase
        .from("founder_invites")
        .update({ email, first_name: firstName || null, sent_at: now() })
        .eq("token", row.token)
        .is("sent_at", null)
        .is("accepted_at", null)
        .select("token");
      if (!claimed || claimed.length === 0) {
        return { error: "Nothing was sent. This invite was already emailed. Reload the page." };
      }
      token = row.token;
    } else {
      // RESEND: a fresh link, and the old one stops working. The claim is
      // expiring the old one: a second click finds it already expired and
      // sends nothing.
      token = newToken();
      const { error: mintError } = await supabase
        .from("founder_invites")
        .insert({ token, label, email, first_name: firstName || null, sent_at: now() });
      if (mintError) {
        console.error("sendPersonalInvite: could not mint resend", mintError.message);
        return { error: "Couldn't create the new link. Try again." };
      }
      const { data: claimed } = await supabase
        .from("founder_invites")
        .update({ expires_at: now() })
        .eq("token", row.token)
        .is("accepted_at", null)
        .gt("expires_at", "now()")
        .select("token");
      if (!claimed || claimed.length === 0) {
        await supabase.from("founder_invites").update({ expires_at: now() }).eq("token", token);
        return { error: "Nothing was sent. This invite was already resent or used. Reload the page." };
      }
      newlyMade = true;
    }
  } else {
    const blocked = checkRecipient(email);
    if (blocked) return { error: blocked };
    // The list shows the label, so it falls back to the person.
    label = label ? `${firstName || email} (${label})` : firstName || email;
    token = newToken();
    const { error: mintError } = await supabase
      .from("founder_invites")
      .insert({ token, label, email, first_name: firstName || null, sent_at: now() });
    if (mintError) {
      console.error("sendPersonalInvite: could not mint invite", mintError.message);
      return { error: "Couldn't create the invitation. Try again." };
    }
    newlyMade = true;
  }

  const url = invitationUrl(token);
  const { subject, text, html } = buildPersonalInvitationEmail({ firstName: firstName || null, inviteUrl: url });
  const sent = await sendEmail({
    to: email,
    bcc: ADMIN_COPY_ADDRESS,
    replyTo: ADMIN_COPY_ADDRESS,
    fromName: SENDER_NAME,
    subject,
    text,
    html,
  });

  if (!sent) {
    // The link exists and works; it just was not emailed. Leave it on the list
    // as "link only" so it can be emailed again or copied.
    await supabase.from("founder_invites").update({ sent_at: null }).eq("token", token);
    revalidatePath("/dashboard/admin");
    return {
      error: `The invitation was made but the email didn't send. Copy the link and send it yourself: ${url}`,
    };
  }

  revalidatePath("/dashboard/admin");
  const name = greetingName(firstName) ?? email;
  const test = isTestAddress(email) ? " (test address)" : "";
  return {
    error: null,
    notice: `${newlyMade && existingToken ? "New link sent" : "Invitation sent"} to ${name}${test}. Copy BCC'd to ${ADMIN_COPY_ADDRESS}.`,
  };
}
