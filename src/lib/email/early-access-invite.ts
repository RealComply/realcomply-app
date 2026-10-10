import { unsubscribeToken } from "./early-access-ack";

// The two emails an early access registrant gets (brief, 10 Oct 2026, copy and
// design approved by Adam):
//
//   1. The invitation, sent by hand from the staff page, one person at a time.
//   2. The welcome, sent once they have signed up with that invitation's link.
//
// WORDING IS ADAM'S, VERBATIM. Do not tidy it, and keep em dashes out of
// anything here a customer reads.
//
// WHY THESE DO NOT USE layout.ts. The approved mockup has its own look (logo
// at the top, the #0b7d50 pill button, a grey footer, a picture in the
// welcome) and changing the shared shell would change every other email the
// app sends. The rules from layout.ts still hold here: tables, inline styles,
// the system font stack, no web fonts. The two pictures are hosted PNGs with
// alt text, and the "RealComply" wordmark beside the logo is text, so a reader
// with images off still sees the name.

export const ADMIN_COPY_ADDRESS = "admin@realcomply.com.au";
export const SENDER_NAME = "RealComply";
export const INVITATION_SUBJECT = "Your invitation to RealComply";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.realcomply.com.au";

/**
 * Where links and pictures in these emails point.
 *
 * The live site, except on a Vercel preview, where it is that branch's own
 * stable address. Previews share the production database, so an invitation
 * sent from a preview to a test address must also be signed up through the
 * preview: that is where the new welcome code runs. On the live site this is
 * always NEXT_PUBLIC_SITE_URL.
 */
export function emailBaseUrl(): string {
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_BRANCH_URL) {
    return `https://${process.env.VERCEL_BRANCH_URL}`;
  }
  return SITE_URL;
}

export function invitationUrl(token: string, base = emailBaseUrl()): string {
  return `${base}/signup?founder=${token}`;
}

export function gettingStartedUrl(base = emailBaseUrl()): string {
  return `${base}/dashboard/getting-started`;
}

/** Null when EMAIL_UNSUBSCRIBE_SECRET is unset: the footer then offers reply-to-unsubscribe only. */
export function invitationUnsubscribeUrl(email: string, base = emailBaseUrl()): string | null {
  const token = unsubscribeToken(email);
  if (!token) return null;
  const u = new URL("/unsubscribe", base);
  u.searchParams.set("e", email);
  u.searchParams.set("t", token);
  return u.toString();
}

/**
 * The name to greet. Same rule as the acknowledgement email: blank becomes
 * "there", and only the first letter is touched, so "sarah" reads "Sarah"
 * without anyone deciding how "de Silva" is spelt.
 */
export function greetingName(firstName: string | null | undefined): string | null {
  const name = (firstName ?? "").trim();
  if (!name) return null;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// ── Rendering ─────────────────────────────────────────────────────────────

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const C = {
  ink: "#16302a",
  body: "#1c2b26",
  muted: "#5a6d66",
  footer: "#6b7c76",
  line: "#e4ebe8",
  green: "#0b7d50",
  tick: "#0f9a63",
  ground: "#f3f5f4",
};

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Block =
  | { kind: "p"; text: string; small?: boolean }
  | { kind: "button"; label: string; href: string }
  | { kind: "video"; href: string; src: string; alt: string; title: string; length: string }
  | { kind: "steps"; items: string[] }
  | { kind: "signoff"; lines: string[] };

type Email = {
  preheader: string;
  blocks: Block[];
  /** Footer lines. A link inside one is given as [text](href). */
  footer: string[];
  base: string;
};

const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;

function blockHtml(b: Block): string {
  switch (b.kind) {
    case "p":
      return `<tr><td style="padding:0 28px 16px;font-family:${FONT};font-size:${b.small ? "14px" : "16px"};line-height:1.6;color:${
        b.small ? C.muted : C.body
      }">${esc(b.text)}</td></tr>`;
    case "button":
      // Table-wrapped: Outlook ignores padding on a bare link.
      return `<tr><td style="padding:4px 28px 20px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background:${C.green};border-radius:999px"><a href="${esc(b.href)}" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none">${esc(
        b.label,
      )}</a></td></tr></table></td></tr>`;
    case "video":
      return `<tr><td style="padding:4px 28px 22px">
<a href="${esc(b.href)}" style="text-decoration:none;color:${C.ink};display:block;max-width:360px">
<img src="${esc(b.src)}" width="360" alt="${esc(b.alt)}" style="display:block;width:100%;max-width:360px;height:auto;border:1px solid #dbe4e0;border-radius:10px">
<span style="display:block;padding-top:8px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1.3;color:${C.ink}">${esc(b.title)}</span>
<span style="display:block;font-family:${FONT};font-size:13px;color:${C.muted}">${esc(b.length)}</span>
</a></td></tr>`;
    case "steps":
      return `<tr><td style="padding:0 28px 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:${C.body}">
<ol style="margin:0;padding-left:22px">${b.items.map((i) => `<li style="margin-bottom:6px">${esc(i)}</li>`).join("")}</ol></td></tr>`;
    case "signoff":
      return `<tr><td style="padding:0 28px 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:${C.body}">${b.lines
        .map(esc)
        .join("<br>")}</td></tr>`;
  }
}

function footerHtml(line: string): string {
  // Escape first, then turn the [text](href) markers back into links.
  return esc(line).replace(
    linkPattern,
    (_m, text: string, href: string) => `<a href="${href}" style="color:${C.footer};text-decoration:underline">${text}</a>`,
  );
}

function renderHtml(e: Email, title: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.ground}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0">${esc(e.preheader)}${"&#847;&zwnj;&nbsp;".repeat(
    60,
  )}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.ground}">
<tr><td align="center" style="padding:20px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px">
<tr><td style="padding:22px 28px;border-bottom:1px solid ${C.line}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding-right:10px;vertical-align:middle"><img src="${esc(e.base)}/email-logo.png" width="30" height="30" alt="" style="display:block;width:30px;height:30px"></td>
<td style="vertical-align:middle;font-family:${FONT};font-size:20px;font-weight:800;letter-spacing:-0.4px;color:${C.ink}">Real<span style="color:${C.tick}">Comply</span></td>
</tr></table></td></tr>
<tr><td style="height:26px;line-height:26px">&nbsp;</td></tr>
${e.blocks.map(blockHtml).join("\n")}
<tr><td style="padding:18px 28px 24px;border-top:1px solid ${C.line};background:${C.ground};border-radius:0 0 10px 10px;font-family:${FONT};font-size:12.5px;line-height:1.55;color:${C.footer}">${e.footer
    .map(footerHtml)
    .join("<br>")}</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function renderText(e: Email): string {
  const out: string[] = [];
  for (const b of e.blocks) {
    switch (b.kind) {
      case "p":
        out.push(b.text, "");
        break;
      case "button":
        out.push(`${b.label}: ${b.href}`, "");
        break;
      case "video":
        out.push(`Watch the video (${b.title}, ${b.length}): ${b.href}`, "");
        break;
      case "steps":
        b.items.forEach((item, i) => out.push(`${i + 1}. ${item}`));
        out.push("");
        break;
      case "signoff":
        out.push(...b.lines, "");
        break;
    }
  }
  out.push("---");
  for (const line of e.footer) out.push(line.replace(linkPattern, (_m, text: string, href: string) => `${text} <${href}>`));
  return out.join("\n").trim();
}

// ── Email 1: the invitation ───────────────────────────────────────────────

export type InvitationInput = {
  firstName: string | null;
  /** The person's own single-use sign-up link. */
  inviteUrl: string;
  /** From invitationUnsubscribeUrl; null when the secret is unset. */
  unsubscribeUrl: string | null;
  base?: string;
};

export function buildInvitationEmail(input: InvitationInput): { subject: string; text: string; html: string } {
  const name = greetingName(input.firstName);
  const email: Email = {
    base: input.base ?? emailBaseUrl(),
    preheader: "Thank you for registering for early access to RealComply. Your invitation is ready.",
    blocks: [
      { kind: "p", text: name ? `Hi ${name},` : "Hi there," },
      { kind: "p", text: "Thank you for registering for early access to RealComply. Your invitation is ready." },
      {
        kind: "p",
        text: "RealComply follows a NSW sales file from listing set-up to settled. It reads your documents, tracks each stage, and flags what needs a look.",
      },
      { kind: "button", label: "Set up your office", href: input.inviteUrl },
      { kind: "p", small: true, text: "This link is just for you and works once. It expires in 60 days." },
      { kind: "p", text: "Questions? Reply to this email." },
      { kind: "p", text: "The RealComply team" },
    ],
    footer: [
      "Diligence support, not legal advice. The licensee remains responsible for decisions and sign-off.",
      // Without the secret there is no signed link to give, so the footer
      // stops at the reply instruction rather than offering a dead link.
      input.unsubscribeUrl
        ? `RealComply Pty Ltd, ABN 61 700 934 792. You registered at realcomply.com.au. To stop these emails, reply "unsubscribe" or [unsubscribe here](${input.unsubscribeUrl}).`
        : `RealComply Pty Ltd, ABN 61 700 934 792. You registered at realcomply.com.au. To stop these emails, reply "unsubscribe".`,
    ],
  };
  return { subject: INVITATION_SUBJECT, text: renderText(email), html: renderHtml(email, INVITATION_SUBJECT) };
}

// ── Email 2: the welcome ──────────────────────────────────────────────────

export type WelcomeInput = {
  firstName: string | null;
  base?: string;
};

export function welcomeSubject(firstName: string | null): string {
  const name = greetingName(firstName);
  return name ? `Welcome to RealComply, ${name}` : "Welcome to RealComply";
}

export function buildWelcomeEmail(input: WelcomeInput): { subject: string; text: string; html: string } {
  const base = input.base ?? emailBaseUrl();
  const name = greetingName(input.firstName);
  const subject = welcomeSubject(input.firstName);
  const email: Email = {
    base,
    preheader: "Welcome aboard. Your office is all set up, and we're really glad to have you with us.",
    blocks: [
      { kind: "p", text: name ? `Hi ${name},` : "Hi there," },
      { kind: "p", text: "Welcome aboard. Your office is all set up, and we're really glad to have you with us." },
      {
        kind: "p",
        text: "To help you find your feet, we've made a short video that walks through RealComply on a made-up listing. Grab a coffee. It takes less than four minutes.",
      },
      {
        kind: "video",
        href: gettingStartedUrl(base),
        src: `${base}/email-video.png`,
        alt: "Watch: RealComply for licensees, a 3 minute 40 video",
        title: "For licensees",
        length: "3 min 40",
      },
      { kind: "p", text: "When you're ready, the easiest way to start is with a listing you're working on now:" },
      {
        kind: "steps",
        items: [
          "Click New listing at the top of any page.",
          "Drop in the agency agreement, contract and comparables, and RealComply will read them for you.",
        ],
      },
      {
        kind: "p",
        text: "If anything's unclear or you get stuck, just reply to this email. We read every one and we're always happy to help.",
      },
      { kind: "signoff", lines: ["Warm regards,", "The RealComply team"] },
    ],
    footer: [
      "Diligence support, not legal advice. The licensee remains responsible for decisions and sign-off.",
      "RealComply Pty Ltd, ABN 61 700 934 792.",
    ],
  };
  return { subject, text: renderText(email), html: renderHtml(email, subject) };
}
