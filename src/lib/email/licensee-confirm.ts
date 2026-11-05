import { renderEmailHtml, renderEmailText, type EmailDocument } from "./layout";

// The first email to a licensee address (Master, 4 Nov 2026; Adam's
// decision: the office is responsible for the licensee email it enters).
//
// Before any approval, invite or sign-off link goes to the licensee email on
// the Office profile, the address confirms it belongs to the licensee in
// charge. This email only asks that: "Confirm you're the licensee in charge
// at [office]", one button, and nothing from the office's records, so an
// address typed wrongly learns nothing but the office's name. Changing the
// licensee email starts it again.

export type LicenseeConfirmEmail = {
  officeName: string;
  url: string;
};

export function licenseeConfirmSubject(officeName: string): string {
  return `Confirm you're the licensee in charge at ${officeName.trim()}`;
}

export function licenseeConfirmDocument(input: LicenseeConfirmEmail): EmailDocument {
  return {
    title: licenseeConfirmSubject(input.officeName),
    sections: [
      { kind: "button", label: "Confirm", href: input.url },
      {
        kind: "note",
        text: `If you're not the licensee in charge at ${input.officeName.trim()}, ignore this email and nothing will be sent to you.`,
      },
    ],
    footer: [`Sent by ${input.officeName.trim()} through RealComply.`],
  };
}

export function buildLicenseeConfirmEmail(input: LicenseeConfirmEmail): { subject: string; text: string; html: string } {
  const doc = licenseeConfirmDocument(input);
  return { subject: licenseeConfirmSubject(input.officeName), text: renderEmailText(doc), html: renderEmailHtml(doc) };
}
