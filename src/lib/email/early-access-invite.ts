import { unsubscribeToken } from "./early-access-ack";
import { appBaseUrl } from "@/lib/site-url";

// The two emails an early access registrant gets (brief, 10 Oct 2026, copy and
// design approved by Adam):
//
//   1. The invitation, sent by hand from the staff page, one person at a time.
//      (A personal invitation, 1b, is the same email for people Adam invites
//      himself.)
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
/**
 * The set-up link for someone who joined on the website, once Adam approves
 * them. Was "Your invitation to RealComply" and "Thank you for registering
 * for early access" (Adam, 29 Oct 2026: no more early access). A personal
 * invite keeps INVITATION_SUBJECT: Adam did invite that person.
 */
export const SETUP_LINK_SUBJECT = "Your RealComply set-up link";

/**
 * The private Facebook group for RealComply members, offered in the welcome
 * email only (Adam, 12 Oct 2026; spec claude/RealComply-community-group-12-Oct.md
 * in the project). The invitation does not mention it.
 */
export const COMMUNITY_GROUP_URL = "https://www.facebook.com/groups/realcomplymembers/";

/** Where links and pictures in these emails point. See lib/site-url.ts. */
export function emailBaseUrl(): string {
  return appBaseUrl();
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
  boxFill: "#eaf6f0",
  boxLine: "#cfe7db",
};

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type Block =
  | { kind: "p"; text: string; small?: boolean }
  | { kind: "button"; label: string; href: string }
  | { kind: "video"; href: string; src: string; alt: string; title: string; length: string }
  | { kind: "steps"; items: string[] }
  | { kind: "box"; heading: string; text: string; button: { label: string; href: string } }
  | { kind: "annexure"; box: AnnexureBox }
  | { kind: "signoff"; lines: string[] };

export type Email = {
  preheader: string;
  blocks: Block[];
  /** Footer lines. A link inside one is given as [text](href). */
  footer: string[];
  base: string;
};

const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;

// ── The annexure box (brief, 14 Oct 2026) ────────────────────────────────
//
// Under the video in the welcome email, and the body of the short email that
// asks a licensee to adopt the annexure. A green border, white inside, so it
// reads as the one thing still to do; the community group box below it stays
// the quieter light green. Wording is the brief's, word for word.

export const ANNEXURE_BOX_HEADING = "One last step: adopt the annexure to your Supervision Guidelines";
export const ANNEXURE_BOX_TEXT =
  "It records how your agency uses RealComply within your existing supervision system. You stay in charge of your agency's compliance.";
export const ANNEXURE_BOX_BUTTON = "Review and sign";
export const ANNEXURE_BOX_SMALL = "Opens a secure page. Takes about two minutes.";
/** Shown in the box when no licence number is on file. The signing page asks for it. */
export const ANNEXURE_NO_LICENCE = "Add it when you sign";

// An agent on their own plan (CORRECTION, Adam, 14 Oct 2026, restoring the
// 22 Sep 2026 rule): RealComply never contacts their licensee, so the box
// gives the agent the annexure to hand over themselves. No heading and no
// signing: a link to the PDF and one line, word for word.
export const ANNEXURE_DOWNLOAD_LINK = "Download the annexure for your licensee";
export const ANNEXURE_DOWNLOAD_LINE =
  "Please give this to your licensee in charge. It explains how RealComply fits within your agency's supervision system.";

// An agent invited by their office (agent welcome, brief 14 Oct 2026): the
// office's Supervision Guidelines and, once the licensee has adopted it, the
// annexure, both to read in the app. Wording is the brief's, word for word.
// Before the office has adopted the annexure the first sentence and the
// annexure link are left out, and the box just asks them to read the
// Guidelines: there is only one link, and nothing to confirm until the
// licensee adopts (Adam, 14 Oct 2026).
export const OFFICE_SG_HEADING = "Your office's Supervision Guidelines";
export const OFFICE_SG_ADOPTED =
  "Your licensee in charge has adopted RealComply's annexure to your agency's Supervision Guidelines.";
export const OFFICE_SG_READ = "Please read both, then confirm in RealComply that you have.";
export const OFFICE_SG_READ_NOT_ADOPTED = "Please read them.";
export const OFFICE_SG_ANNEXURE_LINK = "Read the annexure";
export const OFFICE_SG_LINK = "Read your Supervision Guidelines";

export type AnnexureBox =
  /** Office plan, the reader is the licensee in charge: the details and the button. */
  | { kind: "sign"; agencyName: string; licenceNumber: string | null; date: string; url: string }
  /** Office plan, the reader signed up but is not the licensee: the link went to the licensee. */
  | { kind: "sent"; licenseeName: string }
  /** Agent on their own plan: the PDF to give their licensee. Nothing goes to the licensee. */
  | { kind: "download"; url: string }
  /** Agent invited by their office: read the annexure (once adopted) and the office's Supervision Guidelines. */
  | { kind: "office_sg"; annexureUrl: string | null; sgUrl: string };

/** The office box's words: the annexure and the confirm only once it is adopted. */
export function officeSgText(adopted: boolean): string {
  return adopted ? `${OFFICE_SG_ADOPTED} ${OFFICE_SG_READ}` : OFFICE_SG_READ_NOT_ADOPTED;
}

export function annexureSentLine(licenseeName: string): string {
  return `We've sent the annexure to ${licenseeName.trim() || "your licensee in charge"} to sign.`;
}

function annexureBoxHtml(box: AnnexureBox): string {
  const frame = `<tr><td style="padding:0 28px 22px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;border:2px solid ${C.green};border-radius:12px">
<tr><td style="padding:18px 20px;font-family:${FONT};font-size:16px;line-height:1.6;color:${C.body}">`;
  const top = `${frame}
<p style="margin:0 0 10px;font-weight:700;color:${C.ink}">${esc(ANNEXURE_BOX_HEADING)}</p>
<p style="margin:0 0 14px">${esc(ANNEXURE_BOX_TEXT)}</p>`;
  const bottom = `</td></tr></table></td></tr>`;
  if (box.kind === "download") {
    return `${frame}
<p style="margin:0 0 8px"><a href="${esc(box.url)}" style="font-weight:700;color:${C.green};text-decoration:underline">${esc(
      ANNEXURE_DOWNLOAD_LINK,
    )}</a> <span style="font-size:14px;color:${C.muted}">(PDF)</span></p>
<p style="margin:0">${esc(ANNEXURE_DOWNLOAD_LINE)}</p>
${bottom}`;
  }
  if (box.kind === "office_sg") {
    const links: Array<[string, string]> = [
      ...(box.annexureUrl ? ([[OFFICE_SG_ANNEXURE_LINK, box.annexureUrl]] as Array<[string, string]>) : []),
      [OFFICE_SG_LINK, box.sgUrl],
    ];
    // Outlined pill buttons, one per link, wrapping onto a second line on a
    // narrow screen. Table-wrapped: Outlook ignores padding on a bare link.
    const buttons = links
      .map(
        ([label, href]) =>
          `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:0 8px 8px 0"><tr>
<td style="background:#ffffff;border:2px solid ${C.green};border-radius:999px"><a href="${esc(href)}" style="display:inline-block;padding:9px 22px;font-family:${FONT};font-size:15px;font-weight:700;color:${C.green};text-decoration:none">${esc(
            label,
          )}</a></td></tr></table>`,
      )
      .join("");
    return `${frame}
<p style="margin:0 0 10px;font-weight:700;color:${C.ink}">${esc(OFFICE_SG_HEADING)}</p>
<p style="margin:0 0 14px">${esc(officeSgText(Boolean(box.annexureUrl)))}</p>
<div style="margin:0 0 -8px">${buttons}</div>
${bottom}`;
  }
  if (box.kind === "sent") {
    return `${top}
<p style="margin:0;font-weight:700;color:${C.ink}">${esc(annexureSentLine(box.licenseeName))}</p>
${bottom}`;
  }
  const rows: Array<[string, string]> = [
    ["Agency", box.agencyName],
    ["Licence number", box.licenceNumber?.trim() || ANNEXURE_NO_LICENCE],
    ["Date", box.date],
  ];
  return `${top}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">${rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:2px 14px 2px 0;font-family:${FONT};font-size:14px;color:${C.muted};white-space:nowrap;vertical-align:top">${esc(
          label,
        )}</td><td style="padding:2px 0;font-family:${FONT};font-size:14px;font-weight:700;color:${C.ink}">${esc(value)}</td></tr>`,
    )
    .join("")}</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background:${C.green};border-radius:999px"><a href="${esc(box.url)}" style="display:inline-block;padding:12px 26px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none">${esc(
    ANNEXURE_BOX_BUTTON,
  )}</a></td></tr></table>
<p style="margin:10px 0 0;font-size:13px;color:${C.muted}">${esc(ANNEXURE_BOX_SMALL)}</p>
${bottom}`;
}

function annexureBoxText(box: AnnexureBox): string[] {
  if (box.kind === "download") return [`${ANNEXURE_DOWNLOAD_LINK} (PDF): ${box.url}`, ANNEXURE_DOWNLOAD_LINE];
  if (box.kind === "office_sg") {
    return [
      OFFICE_SG_HEADING,
      officeSgText(Boolean(box.annexureUrl)),
      "",
      ...(box.annexureUrl ? [`${OFFICE_SG_ANNEXURE_LINK}: ${box.annexureUrl}`] : []),
      `${OFFICE_SG_LINK}: ${box.sgUrl}`,
    ];
  }
  if (box.kind === "sent") return [ANNEXURE_BOX_HEADING, ANNEXURE_BOX_TEXT, annexureSentLine(box.licenseeName)];
  return [
    ANNEXURE_BOX_HEADING,
    ANNEXURE_BOX_TEXT,
    "",
    `Agency: ${box.agencyName}`,
    `Licence number: ${box.licenceNumber?.trim() || ANNEXURE_NO_LICENCE}`,
    `Date: ${box.date}`,
    "",
    `${ANNEXURE_BOX_BUTTON}: ${box.url}`,
    ANNEXURE_BOX_SMALL,
  ];
}

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
    case "box":
      // A light green box with an outlined pill button, so it doesn't compete
      // with the main green button (the community group, Adam, 12 Oct 2026).
      // Table-wrapped like the main button: Outlook ignores padding on a link.
      return `<tr><td style="padding:0 28px 20px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.boxFill};border:1px solid ${C.boxLine};border-radius:12px">
<tr><td style="padding:18px 20px;font-family:${FONT};font-size:16px;line-height:1.6;color:${C.body}">
<p style="margin:0 0 12px;font-weight:700;color:${C.ink}">${esc(b.heading)}</p>
<p style="margin:0 0 12px">${esc(b.text)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background:#ffffff;border:2px solid ${C.green};border-radius:999px"><a href="${esc(b.button.href)}" style="display:inline-block;padding:9px 22px;font-family:${FONT};font-size:15px;font-weight:700;color:${C.green};text-decoration:none">${esc(
        b.button.label,
      )}</a></td></tr></table>
</td></tr></table></td></tr>`;
    case "annexure":
      return annexureBoxHtml(b.box);
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
      case "box":
        out.push(b.heading, b.text, "", `${b.button.label}: ${b.button.href}`, "");
        break;
      case "annexure":
        out.push(...annexureBoxText(b.box), "");
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

/** For the other emails with this look (lib/email/sg-annexure.ts). */
export function renderBrandedEmail(e: Email, title: string): { text: string; html: string } {
  return { text: renderText(e), html: renderHtml(e, title) };
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
    preheader: "Here's your set-up link. Your 14-day free trial starts when you set up your office.",
    blocks: [
      { kind: "p", text: name ? `Hi ${name},` : "Hi there," },
      { kind: "p", text: "Here's your set-up link. Your 14-day free trial starts when you set up your office." },
      { kind: "button", label: "Set up your office", href: input.inviteUrl },
      { kind: "p", small: true, text: "This link is just for you and works once. It expires in 60 days." },
      { kind: "p", text: "Any questions, just reply here." },
      { kind: "p", text: "The RealComply team" },
    ],
    footer: [
      "Diligence support, not legal advice. The licensee remains responsible for decisions and sign-off.",
      // Without the secret there is no signed link to give, so the footer
      // stops at the reply instruction rather than offering a dead link.
      input.unsubscribeUrl
        ? `RealComply Pty Ltd, ABN 61 700 934 792. You joined RealComply at realcomply.com.au. To stop these emails, reply "unsubscribe" or [unsubscribe here](${input.unsubscribeUrl}).`
        : `RealComply Pty Ltd, ABN 61 700 934 792. You joined RealComply at realcomply.com.au. To stop these emails, reply "unsubscribe".`,
    ],
  };
  return { subject: SETUP_LINK_SUBJECT, text: renderText(email), html: renderHtml(email, SETUP_LINK_SUBJECT) };
}

// ── Email 1b: a personal invitation ───────────────────────────────────────
//
// The same email for somebody Adam invites himself from Personal invites on
// the staff page (12 Oct 2026). They never registered, so the two lines that
// say they did are changed. Wording approved by Adam on the preview, 12 Oct
// 2026, signed "The RealComply team" at his request, not with his name.
// Unsubscribe is by reply only: there is no early access row for the
// one-click link to remove.

export function buildPersonalInvitationEmail(input: Omit<InvitationInput, "unsubscribeUrl">): {
  subject: string;
  text: string;
  html: string;
} {
  const name = greetingName(input.firstName);
  const email: Email = {
    base: input.base ?? emailBaseUrl(),
    preheader: "We'd like to invite you to try RealComply. Your invitation is ready.",
    blocks: [
      { kind: "p", text: name ? `Hi ${name},` : "Hi there," },
      { kind: "p", text: "We'd like to invite you to try RealComply. Your invitation is ready." },
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
      `RealComply Pty Ltd, ABN 61 700 934 792. You were invited personally by the RealComply team. To stop these emails, reply "unsubscribe".`,
    ],
  };
  return { subject: INVITATION_SUBJECT, text: renderText(email), html: renderHtml(email, INVITATION_SUBJECT) };
}

// ── Email 2: the welcome ──────────────────────────────────────────────────

export type WelcomeInput = {
  firstName: string | null;
  base?: string;
  /**
   * The annexure box under the video (brief, 14 Oct 2026). Office plans: the
   * button for the licensee in charge, or "We've sent the annexure to ..." for
   * anyone else. Agent plans: the PDF to give their licensee (14 Oct 2026).
   * Left out, the email is exactly as it was before the annexure.
   */
  annexure?: AnnexureBox | null;
};

/**
 * The subject of both welcomes (licensee and agent). Was "Welcome to
 * RealComply, [name]". Adam, 29 Oct 2026: someone who joins on the website
 * already gets "Welcome to RealComply", so this one is "Getting started with
 * RealComply, [name]", to match the video and first-listing steps inside.
 */
export function welcomeSubject(firstName: string | null): string {
  const name = greetingName(firstName);
  return name ? `Getting started with RealComply, ${name}` : "Getting started with RealComply";
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
      {
        kind: "p",
        text: "Welcome aboard. Your office is all set up, and we're really glad to have you with us. We look forward to helping you keep on top of your compliance obligations.",
      },
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
      ...(input.annexure ? [{ kind: "annexure" as const, box: input.annexure }] : []),
      ...WELCOME_TAIL,
    ],
    footer: WELCOME_FOOTER,
  };
  return { subject, text: renderText(email), html: renderHtml(email, subject) };
}

// Everything after the video box, the same in both welcomes: the first
// listing, the community group, the help line and the sign-off.
const WELCOME_TAIL: Block[] = [
  { kind: "p", text: "When you're ready, the easiest way to start is with a listing you're working on now:" },
  {
    kind: "steps",
    items: [
      "Click New listing at the top of any page.",
      "Drop in the agency agreement, contract and comparables, and RealComply will read them for you.",
    ],
  },
  {
    kind: "box",
    heading: "Join other agents in the RealComply group",
    text: "We've started a private Facebook group for agents and licensees who use RealComply in NSW. Ask how others handle a tricky file, share what's working, and hear about new features first. Only members can see what's posted.",
    button: { label: "Join the group", href: COMMUNITY_GROUP_URL },
  },
  { kind: "p", text: "If anything's unclear or you get stuck, just reply to this email. We're always happy to help." },
  { kind: "signoff", lines: ["Warm regards,", "The RealComply team"] },
];

const WELCOME_FOOTER = [
  "Diligence support, not legal advice. The licensee remains responsible for decisions and sign-off.",
  "RealComply Pty Ltd, ABN 61 700 934 792.",
];

// ── Email 2b: the agent welcome (brief, 14 Oct 2026) ─────────────────────
//
// For agents: early access single agents and single agents invited personally
// (their own plan), and agents invited by their office. An agent on their own
// plan gets this INSTEAD of the welcome above and is never treated as the
// licensee. The same look and sending rules as the licensee welcome; only the
// wording of the first two paragraphs and the video differ (mockup approved by
// Adam, 14 Oct 2026). The picture links to Getting started, not YouTube.

export type AgentWelcomeInput = {
  firstName: string | null;
  base?: string;
  /**
   * The box under the video: "download" for an agent on their own plan (the
   * #42 box, unchanged), "office_sg" for an agent invited by their office.
   */
  box: Extract<AnnexureBox, { kind: "download" } | { kind: "office_sg" }> | null;
};

export const AGENT_VIDEO_ALT = "Still from the agent video showing the red and amber dots on Listings";

export function buildAgentWelcomeEmail(input: AgentWelcomeInput): { subject: string; text: string; html: string } {
  const base = input.base ?? emailBaseUrl();
  const name = greetingName(input.firstName);
  const subject = welcomeSubject(input.firstName);
  const email: Email = {
    base,
    preheader: "Welcome aboard. Your account is all set up, and we're really glad to have you with us.",
    blocks: [
      { kind: "p", text: name ? `Hi ${name},` : "Hi there," },
      {
        kind: "p",
        text: "Welcome aboard. Your account is all set up, and we're really glad to have you with us. We look forward to helping you keep on top of your compliance obligations.",
      },
      {
        kind: "p",
        text: "To help you find your feet, we've made a short video that walks through RealComply from an agent's side, on a made-up listing. It takes less than two minutes.",
      },
      {
        kind: "video",
        href: gettingStartedUrl(base),
        src: `${base}/email-agent-video.png`,
        alt: AGENT_VIDEO_ALT,
        title: "For agents",
        length: "1 min 46",
      },
      ...(input.box ? [{ kind: "annexure" as const, box: input.box }] : []),
      ...WELCOME_TAIL,
    ],
    footer: WELCOME_FOOTER,
  };
  return { subject, text: renderText(email), html: renderHtml(email, subject) };
}
