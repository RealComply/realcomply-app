import {
  emailBaseUrl,
  greetingName,
  renderBrandedEmail,
  type AnnexureBox,
  type Email,
} from "./early-access-invite";
import { firstNameOf } from "@/lib/legal/sg-annexure";

// The two emails of the annexure adoption (brief, 14 Oct 2026). Same look as
// the welcome email: the box is the welcome's own annexure box.
//
//   1. The request: to the licensee in charge, with the "Review and sign"
//      button. Every new office gets it when its trial starts, except an
//      early access office whose licensee signed up, who has the box in the
//      welcome email instead (Adam, 14 Oct 2026).
//   2. The signed copy, with the PDF attached, after they adopt.
//
// No em dashes in anything here a customer reads.

const FOOTER = [
  "Diligence support, not legal advice. The licensee remains responsible for decisions and sign-off.",
  "RealComply Pty Ltd, ABN 61 700 934 792.",
];

export function annexureRequestSubject(agencyName: string): string {
  return `Adopt the RealComply annexure for ${agencyName}`;
}

export function buildAnnexureRequestEmail(input: {
  licenseeName: string | null;
  box: Extract<AnnexureBox, { kind: "sign" }>;
  base?: string;
}): { subject: string; text: string; html: string } {
  const name = greetingName(firstNameOf(input.licenseeName));
  const subject = annexureRequestSubject(input.box.agencyName);
  const email: Email = {
    base: input.base ?? emailBaseUrl(),
    preheader: "One last step: adopt the annexure to your Supervision Guidelines.",
    blocks: [
      { kind: "p", text: name ? `Hi ${name},` : "Hi there," },
      {
        kind: "p",
        text: `${input.box.agencyName} has started using RealComply. As licensee in charge, you're asked to adopt the RealComply annexure to the agency's Supervision Guidelines.`,
      },
      { kind: "annexure", box: input.box },
      { kind: "p", text: "Questions? Reply to this email." },
      { kind: "signoff", lines: ["Warm regards,", "The RealComply team"] },
    ],
    footer: FOOTER,
  };
  return { subject, ...renderBrandedEmail(email, subject) };
}

export function annexureSignedSubject(agencyName: string): string {
  return `Signed: annexure to the Supervision Guidelines, ${agencyName}`;
}

export function buildAnnexureSignedEmail(input: {
  signedName: string;
  agencyName: string;
  base?: string;
}): { subject: string; text: string; html: string } {
  const name = greetingName(firstNameOf(input.signedName));
  const subject = annexureSignedSubject(input.agencyName);
  const email: Email = {
    base: input.base ?? emailBaseUrl(),
    preheader: "Your signed copy of the RealComply annexure is attached.",
    blocks: [
      { kind: "p", text: name ? `Hi ${name},` : "Hi there," },
      {
        kind: "p",
        text: `Thank you for adopting the RealComply annexure to ${input.agencyName}'s Supervision Guidelines. Your signed copy is attached. Add it to your Supervision Guidelines.`,
      },
      {
        kind: "p",
        text: "A copy is also kept in RealComply under Registers, Document sign-offs, where only the licensee in charge can see it.",
      },
      { kind: "p", text: "Questions? Reply to this email." },
      { kind: "signoff", lines: ["Warm regards,", "The RealComply team"] },
    ],
    footer: FOOTER,
  };
  return { subject, ...renderBrandedEmail(email, subject) };
}
