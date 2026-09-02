import { sendEmail } from "@/lib/email/send";
import { renderEmailHtml, renderEmailText, type EmailDocument } from "./layout";

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

  // Internal, but branded like everything else. Adam, 3 Sep: "I think it's
  // important to be consistent." A notification that looks unlike the product
  // is also harder to spot in an inbox than one that does.
  const doc: EmailDocument = {
    preheader: `${signup.agencyName} — ${signup.fullName}`,
    title: "New agency signup",
    meta: when + " AEST/AEDT",
    sections: [
      {
        kind: "rows",
        rows: [
          {
            title: signup.agencyName,
            sub: signup.email,
            detail: `Principal: ${signup.fullName}`,
            tone: "routine",
          },
        ],
      },
    ],
    footer: ["Sent by RealComply because a new agency completed signup."],
  };

  await sendEmail({
    to,
    subject: `New signup: ${signup.agencyName}`,
    text: renderEmailText(doc),
    html: renderEmailHtml(doc),
  });
}
