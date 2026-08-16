"use server";

import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/send";

// Early-access signup from the public landing page. Runs unauthenticated —
// this is the one action in the app reachable by a stranger — so it stays
// deliberately narrow: one field in, a boolean out, no reads.
//
// Uses the anon client rather than createServiceClient(). The service client
// bypasses RLS and its own file says never to reach it from a request driven
// by end-user input. The table's insert-only policy (0013) is what makes the
// anon path safe: this can add a row and cannot read one back.
//
// NOTIFICATION ADDED 16 Aug 2026. Until then a registration landed in the table
// and told nobody — Adam had to remember to open the Supabase dashboard. With
// paid ads pointing at this page that is the wrong way round: the whole cost of
// a click is wasted if the lead sits unread for a week. It emails
// ADMIN_NOTIFICATION_EMAIL, which is a verified SES identity, so this works
// despite the sandbox — unlike anything addressed to a customer.

export type EarlyAccessState = { ok: boolean; error: string | null };

// Deliberately permissive. The job here is to catch a typo or an empty box,
// not to adjudicate what is a valid address — over-strict patterns reject
// real addresses and the only cost of a bad one is a bounced email.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function joinEarlyAccess(
  _prevState: EarlyAccessState,
  formData: FormData,
): Promise<EarlyAccessState> {
  // Honeypot. A field hidden from people but not from naive form-fillers; if
  // it arrives with anything in it, accept the submission silently and drop it
  // on the floor rather than returning an error a bot could learn from.
  if (String(formData.get("company_website") ?? "").trim() !== "") {
    return { ok: true, error: null };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const source = String(formData.get("source") ?? "").trim().slice(0, 120) || null;

  if (!email) {
    return { ok: false, error: "Enter your email address." };
  }
  if (!EMAIL.test(email) || email.length > 320) {
    return { ok: false, error: "That does not look like an email address." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("early_access").insert({ email, source });

  if (error) {
    // 23505 = unique violation, i.e. already on the list. Treat as success:
    // they did what we asked, and saying "already registered" would confirm
    // to a stranger whether a given address is on the list.
    if (error.code === "23505") {
      return { ok: true, error: null };
    }
    // Anything else is ours, not theirs. Don't surface the database message.
    console.error("joinEarlyAccess insert failed:", error.message, error.code);
    return { ok: false, error: "Something went wrong at our end. Please try again." };
  }

  await notifyEarlyAccessSignup(email, source);

  return { ok: true, error: null };
}

/**
 * Tells us someone registered.
 *
 * Only on a genuinely new row: a duplicate returns above without reaching here,
 * so re-submitting the same address does not send a second email.
 *
 * Never awaited into the result. A registration that succeeded must not be
 * reported as failed because the mail server had a bad moment — the row is
 * already saved, and the list in Supabase remains the source of truth. Failures
 * are logged, not surfaced.
 */
async function notifyEarlyAccessSignup(email: string, source: string | null): Promise<void> {
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!to) {
    console.error("Early-access signup not notified: ADMIN_NOTIFICATION_EMAIL is not set.", { email });
    return;
  }

  const sent = await sendEmail({
    to,
    subject: `RealComply early access — ${email}`,
    text: [
      "Someone registered for early access on the landing page.",
      "",
      `Email: ${email}`,
      // ?src= on the ad's link, so a run of these reads as which ad is working
      // without going to Meta's own attribution for it.
      `Came from: ${source ?? "no source recorded (typed the address in, or an ad with no ?src= tag)"}`,
      `When: ${new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney" })} (Sydney)`,
      "",
      "The full list is in the Supabase dashboard, table early_access.",
    ].join("\n"),
  });

  if (!sent) {
    console.error("Early-access signup saved but not notified:", email);
  }
}
