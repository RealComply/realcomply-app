import { sendEmail, type SendEmailInput } from "@/lib/email/send";
import { ADMIN_COPY_ADDRESS, SENDER_NAME, buildWelcomeEmail } from "@/lib/email/early-access-invite";
import { welcomeSwitchedOn } from "./rules";

// The welcome email (brief Part C, 10 Oct 2026), sent once to someone from the
// early access list after they have set up their office with their invitation
// link.
//
// WHEN: ONCE THE CARD IS IN, not when the office is created (Adam, 11 Oct
// 2026). A new office sees only "Start your 14-day trial" until Stripe has
// its card, so a welcome sent any earlier would say "your office is all set
// up" and link a video the reader cannot reach yet. The Stripe webhook calls
// this after it records the subscription (app/api/stripe/webhook/route.ts),
// which is the moment the trial starts.
//
// SWITCHED OFF until Adam turns it on: EARLY_ACCESS_WELCOME_EMAIL=on in
// Vercel. It links to the Getting started page, which he checks first.
//
// ONCE ONLY. The early access row is claimed by an UPDATE that requires
// welcome_sent_at to be empty (0061). Stripe sends more than one event for a
// new subscription, and resends any it likes; the second claim matches
// nothing and sends nothing.
//
// NEVER THROWS. A failed welcome is logged, and the claim is undone so the
// staff page never shows "welcome sent" for an email that did not go. It must
// not fail the webhook: Stripe would retry an update that already succeeded.

/** The few query-builder calls this uses, so a test can stand in for Supabase. */
type Client = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type WelcomeOutcome = "sent" | "switched_off" | "not_early_access" | "already_sent" | "failed";

export async function sendEarlyAccessWelcome(
  supabase: Client,
  agencyId: string,
  deps: {
    send?: (input: SendEmailInput) => Promise<boolean>;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<WelcomeOutcome> {
  const send = deps.send ?? sendEmail;
  const env = deps.env ?? process.env;

  if (!welcomeSwitchedOn(env)) return "switched_off";

  try {
    // The invitation that created this office. bootstrap_agency_v3 stamps the
    // agency and the person on the token it consumed (0045).
    const { data: invites } = await supabase
      .from("founder_invites")
      .select("token, accepted_by")
      .eq("agency_id", agencyId)
      .not("accepted_at", "is", null);
    const used = (invites ?? []) as Array<{ token: string; accepted_by: string | null }>;
    if (used.length === 0) return "not_early_access";

    const sentAt = new Date().toISOString();
    const { data: claimed, error: claimError } = await supabase
      .from("early_access")
      .update({ welcome_sent_at: sentAt })
      .in(
        "invited_token",
        used.map((u) => u.token),
      )
      .is("welcome_sent_at", null)
      .is("unsubscribed_at", null)
      .select("id, first_name, invited_token");

    if (claimError) {
      console.error("early access welcome: claim failed", claimError.message);
      return "failed";
    }
    const row = ((claimed ?? []) as Array<{ id: string; first_name: string | null; invited_token: string }>)[0];
    if (!row) {
      // Either not from the early access list, or welcomed already. Tell them
      // apart only for the log line.
      const { data: rows } = await supabase
        .from("early_access")
        .select("id")
        .in(
          "invited_token",
          used.map((u) => u.token),
        );
      return (rows ?? []).length > 0 ? "already_sent" : "not_early_access";
    }

    const undo = () =>
      supabase.from("early_access").update({ welcome_sent_at: null }).eq("id", row.id).eq("welcome_sent_at", sentAt);

    // To the address they signed up with (brief), which is often not the one
    // they registered with.
    const personId = used.find((u) => u.token === row.invited_token)?.accepted_by ?? null;
    const { data: person } = personId
      ? await supabase.from("profiles").select("email").eq("id", personId).maybeSingle()
      : { data: null };
    const to = (person as { email: string | null } | null)?.email?.trim();
    if (!to) {
      await undo();
      console.error("early access welcome: no sign-up address for agency", agencyId);
      return "failed";
    }

    const { subject, text, html } = buildWelcomeEmail({ firstName: row.first_name });
    const sent = await send({ to, bcc: ADMIN_COPY_ADDRESS, replyTo: ADMIN_COPY_ADDRESS, fromName: SENDER_NAME, subject, text, html });
    if (!sent) {
      await undo();
      console.error("early access welcome: send failed", { agencyId });
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error("early access welcome failed:", agencyId, err);
    return "failed";
  }
}
