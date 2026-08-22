import nodemailer from "nodemailer";

// One way out of the app for every email, with a swappable provider behind it.
//
// WHY THIS IS PLUGGABLE, 22 Aug 2026. AWS refused SES production access on
// 15 Aug without giving a reason, and a resubmitted request may be refused
// again. Until it lands, SES is in sandbox and every email to an unverified
// address hard-fails: licensee sign-off links, Monday digests, licence expiry
// reminders. That is the dominant thing standing between RealComply and a
// second agency using it.
//
// So the provider is now configuration rather than code. If AWS refuses a
// second time, switching to Resend is two environment variables in Vercel and
// a redeploy, with nothing in the application changed and nothing to test
// beyond the send itself.
//
// THE TRADE-OFF, recorded because it is not obvious and it is not ours to
// decide quietly. SES sends from ap-southeast-2, which keeps mail in Sydney
// and matches what RealComply tells agencies about data residency. Resend has
// no Australian region (Virginia, Ireland, São Paulo, Tokyo). The weekly
// digest carries property addresses, vendor and agent names and compliance
// status, all personal information, so sending it from overseas is a
// cross-border disclosure engaging APP 8 under the Privacy Act. That is
// permitted, but it must be disclosed in the privacy policy, and it makes
// RealComply accountable for the overseas provider's handling of it.
//
// Hence SES stays the default. Resend is the escape hatch, not the plan.

export type EmailProvider = "ses" | "resend";

function selectedProvider(): EmailProvider {
  return process.env.EMAIL_PROVIDER === "resend" ? "resend" : "ses";
}

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
};

// ── SES, over SMTP ─────────────────────────────────────────────────────────
//
// One transport per invocation rather than a module-level singleton. This only
// runs in short-lived server actions and cron handlers at low volume, so
// re-authenticating each send costs less than managing a long-lived connection
// across serverless invocations that may not share a warm instance anyway.
//
// Requires (server-only, never NEXT_PUBLIC_-prefixed):
//   SES_SMTP_HOST      e.g. email-smtp.ap-southeast-2.amazonaws.com
//   SES_SMTP_PORT      587
//   SES_SMTP_USER      IAM SMTP username (see realcomply-notifications-smtp)
//   SES_SMTP_PASSWORD  IAM SMTP password
async function sendViaSes(from: string, input: SendEmailInput): Promise<void> {
  const host = process.env.SES_SMTP_HOST;
  const port = Number(process.env.SES_SMTP_PORT ?? "587");
  const user = process.env.SES_SMTP_USER;
  const pass = process.env.SES_SMTP_PASSWORD;

  if (!host || !user || !pass) {
    throw new Error("SES_SMTP_HOST / SES_SMTP_USER / SES_SMTP_PASSWORD are not all set.");
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: false, // STARTTLS on 587, not implicit TLS
    auth: { user, pass },
  });

  await transport.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
}

// ── Resend, over HTTPS ─────────────────────────────────────────────────────
//
// Deliberately plain fetch rather than the resend npm package. The whole
// integration is one POST, so a dependency would add a supply-chain surface
// and a version to maintain in exchange for nothing.
//
// Requires:
//   RESEND_API_KEY
async function sendViaResend(from: string, input: SendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(input.to) ? input.to : [input.to],
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
    }),
  });

  if (!response.ok) {
    // Read the body: Resend explains refusals properly (unverified domain,
    // suppressed address), and losing that to a bare status code would make
    // a failed send much harder to diagnose than it needs to be.
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend returned ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
}

// Fire-and-log rather than fire-and-throw: notification and digest emails are
// a courtesy layer on top of the app, not something that should take down a
// signup or a cron run because a provider had a bad moment. Callers that
// genuinely need to know whether the send succeeded get the boolean back.
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    console.error("sendEmail: EMAIL_FROM is not set — skipping send.", { subject: input.subject });
    return false;
  }

  const provider = selectedProvider();

  try {
    if (provider === "resend") {
      await sendViaResend(from, input);
    } else {
      await sendViaSes(from, input);
    }
    return true;
  } catch (error) {
    // The provider is named in the log. Without it, a misconfigured switch
    // looks identical to a provider outage, and the first question anyone
    // asks is "which one was it even trying?"
    console.error("sendEmail failed", {
      provider,
      subject: input.subject,
      to: input.to,
      error,
    });
    return false;
  }
}

/**
 * What the current email configuration is, without sending anything.
 *
 * Exists so a misconfiguration is answerable by looking rather than by
 * sending a test email and waiting to see whether it arrives. EMAIL_FROM also
 * has to match a domain the selected provider has verified, and that mismatch
 * is invisible until a send fails, so both are reported together.
 *
 * Never returns key material.
 */
export function emailConfigStatus(): {
  provider: EmailProvider;
  configured: boolean;
  from: string | null;
  missing: string[];
} {
  const provider = selectedProvider();
  const from = process.env.EMAIL_FROM ?? null;
  const missing: string[] = [];

  if (!from) missing.push("EMAIL_FROM");

  if (provider === "resend") {
    if (!process.env.RESEND_API_KEY) missing.push("RESEND_API_KEY");
  } else {
    if (!process.env.SES_SMTP_HOST) missing.push("SES_SMTP_HOST");
    if (!process.env.SES_SMTP_USER) missing.push("SES_SMTP_USER");
    if (!process.env.SES_SMTP_PASSWORD) missing.push("SES_SMTP_PASSWORD");
  }

  return { provider, configured: missing.length === 0, from, missing };
}
