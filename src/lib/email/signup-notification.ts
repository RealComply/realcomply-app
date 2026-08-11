import { sendEmail } from "@/lib/email/send";

export type NewAgencySignup = {
  agencyName: string;
  fullName: string;
  email: string;
};

// Fired once, right after bootstrap_agency succeeds — from both signup()
// (immediate-session path) and /auth/callback (email-confirmation path),
// since which one actually runs depends on whether Supabase email
// confirmation is switched on for this project. Deliberately not fired for
// accept_invite — joining an existing agency isn't a new-agency signup.
export async function notifyNewAgencySignup(signup: NewAgencySignup) {
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!to) {
    console.error("notifyNewAgencySignup: ADMIN_NOTIFICATION_EMAIL is not set — skipping.");
    return;
  }

  const when = new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney", dateStyle: "medium", timeStyle: "short" });

  const text = [
    "New RealComply agency signup.",
    "",
    `Agency: ${signup.agencyName}`,
    `Principal: ${signup.fullName} <${signup.email}>`,
    `When: ${when} AEST/AEDT`,
  ].join("\n");

  await sendEmail({
    to,
    subject: `New signup: ${signup.agencyName}`,
    text,
  });
}
