import { sendEmail } from "@/lib/email/send";
import { renderEmailHtml, renderEmailText, type EmailDocument } from "./layout";

// The email to a listing's agent when the advertised-price check raises a red
// flag on their live ad.
//
// ONLY TWO THINGS ARE RED FLAGS (RealComply, 8 Oct 2026): no price showing on
// the listing page (from 1 November 2026, when the new legislation commences —
// see NO_PRICE_RED_FLAG_FROM in website-scan.ts), or a price below the ESP on
// file. Everything else the check finds (a range over 10%, "offers over"
// wording, no ESP recorded) still flags the item on the card and in the Monday
// digest, but does not email.
//
// ONE EMAIL PER RED FLAG, not one per check. The check runs every morning; an
// ad that stays below the ESP would otherwise mail the agent every day until
// they stopped reading them. The caller keys each alert on what was found
// (see alertKey in website-scan.ts) and only sends when that key is new, so a
// further price drop or a revised ESP does mail again.

export type RedFlag = { kind: "no_price" | "below_esp"; text: string };

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.realcomply.com.au";

export function listingAlertDocument(input: {
  agentName: string | null;
  address: string;
  url: string;
  propertyId: string;
  flags: RedFlag[];
}): EmailDocument {
  const firstName = input.agentName?.split(" ")[0];
  return {
    preheader: `The live ad for ${input.address} needs a look.`,
    title: firstName ? `Hi ${firstName},` : "Hi,",
    sections: [
      {
        kind: "paragraph",
        lead: true,
        text: `This morning's check of your listing page for ${input.address} found something to fix on the live ad.`,
      },
      {
        kind: "rows",
        rows: input.flags.map((f) => ({
          title: f.kind === "no_price" ? "No price showing" : "Advertised below the ESP",
          detail: f.text,
          tone: "risk" as const,
        })),
      },
      { kind: "note", text: `Page checked: ${input.url}` },
      { kind: "button", label: "Open the listing", href: `${SITE_URL}/dashboard/${input.propertyId}` },
    ],
    footer: [
      "RealComply reads your own listing page and compares it with the file. It is a precaution, " +
        "not a compliance decision: the agent and the licensee in charge decide what the ad should say.",
      "You get one email per issue found. If it is still there tomorrow it stays flagged on the listing " +
        "and in the Monday digest rather than being emailed again.",
    ],
  };
}

export async function sendListingAlert(input: {
  to: string;
  agentName: string | null;
  address: string;
  url: string;
  propertyId: string;
  flags: RedFlag[];
}): Promise<boolean> {
  const doc = listingAlertDocument(input);
  const what = input.flags.some((f) => f.kind === "below_esp") ? "below the ESP" : "no price showing";
  return sendEmail({
    to: input.to,
    subject: `Live ad for ${input.address}: ${what}`,
    text: renderEmailText(doc),
    html: renderEmailHtml(doc),
  });
}
