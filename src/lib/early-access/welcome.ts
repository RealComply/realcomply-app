import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import { ADMIN_COPY_ADDRESS, SENDER_NAME, buildWelcomeEmail } from "@/lib/email/early-access-invite";
import { welcomeSwitchedOn } from "./rules";

// The welcome email (brief Part C, 10 Oct 2026): sent once, as soon as a new
// office is created with an invitation link that came from the early access
// list.
//
// SWITCHED OFF until Adam turns it on. It links to the Getting started page,
// and Adam checks that page before anyone is sent there. The switch is the
// EARLY_ACCESS_WELCOME_EMAIL environment variable, set to "on" in Vercel.
//
// CALLED FROM ALL THREE PLACES AN OFFICE CAN BE CREATED: the signup form
// (lib/actions/auth.ts), the email-confirmation return (lib/auth/complete-signup.ts)
// and the self-heal in requireProfile (lib/data/current-profile.ts). Each calls
// it only after bootstrap_agency_v3 succeeded.
//
// ONCE ONLY. The row is claimed by an UPDATE that requires welcome_sent_at to
// be empty (0061), so if two of those paths run for the same person, the
// second claims nothing and sends nothing.
//
// NEVER BREAKS A SIGNUP. Every failure is logged and swallowed: a missing
// welcome email is ours to notice, an error page on someone's first sign-in is
// not acceptable.

export async function sendEarlyAccessWelcomeIfDue(input: {
  founderToken: string | null | undefined;
  /** The address they signed up with, which is where the welcome goes. */
  signupEmail: string | null | undefined;
}): Promise<"sent" | "skipped" | "failed"> {
  const token = input.founderToken?.trim();
  const to = input.signupEmail?.trim();
  if (!token || !to) return "skipped";

  if (!welcomeSwitchedOn()) {
    console.info("early access welcome: switched off (EARLY_ACCESS_WELCOME_EMAIL is not \"on\"); not sent");
    return "skipped";
  }

  try {
    const supabase = createServiceClient();

    // Only for an invitation that was actually spent on creating an office.
    const { data: invite } = await supabase
      .from("founder_invites")
      .select("accepted_at")
      .eq("token", token)
      .maybeSingle();
    if (!(invite as { accepted_at: string | null } | null)?.accepted_at) return "skipped";

    const sentAt = new Date().toISOString();
    const { data: claimed, error: claimError } = await supabase
      .from("early_access")
      .update({ welcome_sent_at: sentAt })
      .eq("invited_token", token)
      .is("welcome_sent_at", null)
      .is("unsubscribed_at", null)
      .select("id, first_name");

    if (claimError) {
      console.error("early access welcome: claim failed", claimError.message);
      return "failed";
    }
    // Not from the early access list, or already welcomed.
    const row = (claimed as Array<{ id: string; first_name: string | null }> | null)?.[0];
    if (!row) return "skipped";

    const { subject, text, html } = buildWelcomeEmail({ firstName: row.first_name });
    const sent = await sendEmail({
      to,
      bcc: ADMIN_COPY_ADDRESS,
      replyTo: ADMIN_COPY_ADDRESS,
      fromName: SENDER_NAME,
      subject,
      text,
      html,
    });

    if (!sent) {
      // Undo the claim, so the staff page never says "welcome sent" for an
      // email that did not go.
      await supabase.from("early_access").update({ welcome_sent_at: null }).eq("id", row.id).eq("welcome_sent_at", sentAt);
      console.error("early access welcome: send failed", { to });
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error("early access welcome failed:", err);
    return "failed";
  }
}
