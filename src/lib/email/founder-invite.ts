import { renderEmailHtml, renderEmailText, DILIGENCE_LINE, type EmailDocument } from "./layout";

// The email that carries a founder invite to someone who registered for early
// access and has been accepted.
//
// WHO IS READING IT. Someone who put their name on a landing page, possibly
// weeks ago, after clicking a Facebook ad. They are warm but not waiting — they
// may not remember registering, and they certainly have not been thinking about
// RealComply since. So the first line reminds them what this is before it asks
// them to do anything.
//
// WHY IT IS NOT A MARKETING EMAIL. They already said yes once. The job here is
// to get them into the product, not to sell them again. One link, one action,
// no feature list. Everything that would ordinarily pad this out — the
// benefits, the social proof, the "here's why compliance matters" — costs
// attention that should go on the button.
//
// THE LINK IS A CREDENTIAL. A founder invite creates one agency and is spent on
// first use, so this email is worth exactly one signup to whoever holds it.
// Hence the line telling them not to forward it, and hence the deliberate
// absence of "share this with a colleague" — the one-link-one-agency property
// is what keeps the door closed while signups are shut.

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.realcomply.com.au";

export type FounderInviteEmail = {
  firstName: string | null;
  agencyName: string | null;
  token: string;
  /** Formatted for a human, e.g. "17 Nov 2026". */
  expiresAt: string;
};

export function founderInviteUrl(token: string): string {
  return `${SITE_URL}/signup?founder=${token}`;
}

export function buildFounderInviteEmail(input: FounderInviteEmail): {
  subject: string;
  text: string;
  html: string;
} {
  const greeting = input.firstName ? `Hi ${input.firstName},` : "Hi,";
  const url = founderInviteUrl(input.token);

  const doc: EmailDocument = {
    preheader: "Your early-access invitation to RealComply is ready — one link, and it sets up your agency.",
    title: "Your RealComply invitation",
    meta: input.agencyName ?? undefined,
    sections: [
      { kind: "paragraph", lead: true, text: greeting },
      {
        kind: "paragraph",
        text: "You registered for early access to RealComply, the compliance system for NSW real estate agencies. We're letting people in a few at a time, and it's your turn.",
      },
      {
        kind: "paragraph",
        text: "The link below sets up your agency and signs you in. There's nothing to pay and no card required.",
      },
      { kind: "button", label: "Set up your agency", href: url },
      {
        kind: "note",
        text: `This link works once and is yours alone — please don't forward it. It expires on ${input.expiresAt}. If it's gone stale by the time you get to it, just reply and I'll send another.`,
      },
      {
        kind: "paragraph",
        text: "Reply to this email if you get stuck or want a hand setting it up. It comes straight to me.",
      },
      { kind: "paragraph", text: "Adam Castelnuovo" },
    ],
    footer: [
      "You're receiving this because you registered for early access at realcomply.com.au.",
      DILIGENCE_LINE,
    ],
  };

  return {
    subject: "Your RealComply invitation is ready",
    text: renderEmailText(doc),
    html: renderEmailHtml(doc),
  };
}
