import { renderEmailHtml, renderEmailText, DILIGENCE_LINE, type EmailDocument } from "./layout";
import { espRangeText } from "@/lib/rules/price-statement";

// The email that asks the licensee in charge to approve a price statement
// (b4) before the listing is advertised (Adam, 12 Oct 2026, option (a)).
//
// The same reader as the final sign-off email: a licensee who does not use
// RealComply, reading a message from a domain they do not know, with a link
// that asks them to type their name. So the same three rules hold, for the
// same reasons (see the note at the top of email/signoff-request.ts):
//
//   1. The agent's name and the address come first, in the subject and the
//      first line. "RealComply" is nowhere in the subject.
//   2. Reply-to is the agent (set by the caller). The note leans on it: a
//      price statement that is wrong is answered by replying, not approving.
//   3. It says what they are approving before they click. Here that is the
//      price statement itself, word for word, and the estimated selling price
//      on the file, the two things a licensee checks one against the other.
//
// The figures in it are fixed when the request is made (0065): the price
// statement as typed, and the ESP the database read off the file. A resend
// shows the same words, so the email always matches the page behind it.

export type PriceStatementRequestEmail = {
  agentName: string;
  agencyName: string;
  propertyAddress: string;
  url: string;
  /** Formatted for a human, e.g. "11 November 2026". */
  expiresAt: string;
  /** The exact words, as fixed on the request. */
  priceStatement: string;
  espLow: number | null;
  espHigh: number | null;
};

const noTags = (value: string): string => value.replace(/[<>]/g, "");

/** Agent, then address: both things the licensee can check in an inbox list without opening anything. */
export function priceStatementRequestSubject(input: PriceStatementRequestEmail): string {
  return `${input.agentName} has asked you to approve the price for ${input.propertyAddress}`;
}

export function priceStatementRequestDocument(input: PriceStatementRequestEmail): EmailDocument {
  const esp = espRangeText(input.espLow, input.espHigh);
  // Nothing about where the listing is up to. Most requests go before it is
  // advertised, but the licensee can send b4 back from the final sign-off,
  // and the request that follows goes to a listing already on the market.
  return {
    preheader: `${input.agentName} of ${input.agencyName} needs your approval of the price statement for ${input.propertyAddress}.`,
    title: "A price statement needs your approval",
    meta: `${input.agencyName} · ${input.propertyAddress}`,
    sections: [
      {
        kind: "paragraph",
        lead: true,
        text: `${input.agentName} needs you, as licensee in charge, to approve the price statement for ${input.propertyAddress}.`,
      },
      { kind: "label", text: "The price statement" },
      {
        kind: "rows",
        rows: [
          {
            title: `“${input.priceStatement}”`,
            sub: input.propertyAddress,
            // Left out when the file has no ESP, rather than a line saying so:
            // the page behind the link says "not recorded in the file".
            detail: esp ? `Estimated selling price on the file: ${esp}` : undefined,
            tone: "routine",
          },
        ],
      },
      {
        kind: "paragraph",
        text: "The link opens the full statement. You approve it by typing your name. You don't need an account or a password.",
      },
      { kind: "button", label: "Check and approve", href: input.url },
      {
        kind: "note",
        text: `If the price statement isn't right, don't approve it. Reply to this email and say what needs to change. This link is for you only and expires on ${input.expiresAt}. If you weren't expecting it, reply to this email and let us know.`,
      },
    ],
    // The same footer as the final sign-off email. Footer lines go into the
    // HTML as they are (they may carry links), so the two names typed by the
    // agency lose any angle brackets here rather than becoming markup.
    footer: [
      `Sent by ${noTags(input.agencyName)} through RealComply, the compliance system ${noTags(input.agentName)} uses to prepare sales files.`,
      DILIGENCE_LINE,
    ],
  };
}

export function buildPriceStatementRequestEmail(input: PriceStatementRequestEmail): {
  subject: string;
  text: string;
  html: string;
} {
  const doc = priceStatementRequestDocument(input);
  return {
    subject: priceStatementRequestSubject(input),
    text: renderEmailText(doc),
    html: renderEmailHtml(doc),
  };
}
