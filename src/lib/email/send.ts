import nodemailer from "nodemailer";

// Thin wrapper over SES SMTP. One transport per invocation rather than a
// module-level singleton — this only ever runs in short-lived server
// actions and cron route handlers (low volume, not a hot path), so the
// cost of re-authenticating each send is negligible next to the
// complexity of managing a long-lived connection across serverless
// invocations that may not share a warm instance anyway.
//
// Requires (server-only, never NEXT_PUBLIC_-prefixed):
//   SES_SMTP_HOST      e.g. email-smtp.ap-southeast-2.amazonaws.com
//   SES_SMTP_PORT      587
//   SES_SMTP_USER      IAM SMTP username (see realcomply-notifications-smtp)
//   SES_SMTP_PASSWORD  IAM SMTP password
//   EMAIL_FROM         e.g. "RealComply <notifications@notifications.realcomply.com.au>"
function getTransport() {
  const host = process.env.SES_SMTP_HOST;
  const port = Number(process.env.SES_SMTP_PORT ?? "587");
  const user = process.env.SES_SMTP_USER;
  const pass = process.env.SES_SMTP_PASSWORD;

  if (!host || !user || !pass) {
    throw new Error(
      "Email send skipped: SES_SMTP_HOST / SES_SMTP_USER / SES_SMTP_PASSWORD are not all set.",
    );
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: false, // STARTTLS on 587, not implicit TLS
    auth: { user, pass },
  });
}

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
};

// Fire-and-log rather than fire-and-throw: notification and digest emails
// are a courtesy layer on top of the app, not something that should ever
// take down a signup or a cron run if SES has a bad moment. Callers that
// genuinely need to know whether the send succeeded get the boolean back.
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    console.error("sendEmail: EMAIL_FROM is not set — skipping send.", { subject: input.subject });
    return false;
  }

  try {
    const transport = getTransport();
    await transport.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return true;
  } catch (error) {
    console.error("sendEmail failed", { subject: input.subject, to: input.to, error });
    return false;
  }
}
