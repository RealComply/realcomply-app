import { renderEmailHtml, renderEmailText, DILIGENCE_LINE, type EmailDocument } from "./layout";

// The office manager emails (0093; Adam, 26 Oct 2026; mockup approved 26 Oct).
//
//   1. The request: to a licensee in charge with no login, asking them to
//      approve someone as office manager. The same reader as the price
//      statement email, so the same rules (see email/price-statement-request.ts):
//      the person's name first, "RealComply" nowhere in the subject, the words
//      being approved in full before they click, and reply-to the person asking.
//   2. The confirmation: to the licensee, once they have approved by link. It
//      is their record, and it carries the withdraw link.
//   3. The withdrawal: to the office manager, whichever way it was withdrawn.
//
// What an office manager can do, and what stays with the licensee, is listed
// once below and used by the emails and the approval page alike.

export const OFFICE_MANAGER_CAN = [
  "Invite and remove staff (Team)",
  "Keep the office details up to date (Office profile)",
  "Keep the registers, CPD and training records",
  "Upload trust account reconciliations for you to sign",
  "Upload SG Manual versions for you to sign",
  "Look after billing",
] as const;

export const LICENSEE_KEEPS = [
  "Price statement approvals",
  "File sign-offs",
  "Adopting the SG annexure",
  "Changing the licensee in charge",
  "Deleting compliance records",
] as const;

export type OfficeManagerRequestEmail = {
  personName: string;
  officeName: string;
  /** The exact words, as fixed on the request. */
  wording: string;
  url: string;
  /** Formatted for a human, e.g. "26 November 2026". */
  expiresAt: string;
};

/** The person, then the office: both checkable in an inbox list without opening anything. */
export function officeManagerRequestSubject(input: Pick<OfficeManagerRequestEmail, "personName" | "officeName">): string {
  return `${input.personName} has asked you to approve them as office manager for ${input.officeName}`;
}

const list = (items: readonly string[]) => ({
  kind: "rows" as const,
  rows: items.map((title) => ({ title, tone: "routine" as const })),
});

export function officeManagerRequestDocument(input: OfficeManagerRequestEmail): EmailDocument {
  return {
    preheader: `${input.personName} of ${input.officeName} has asked you to approve them as office manager on RealComply.`,
    title: "An office manager needs your approval",
    meta: `${input.officeName} · Office manager`,
    sections: [
      {
        kind: "paragraph",
        lead: true,
        text: `${input.personName} has asked you, as licensee in charge of ${input.officeName}, to approve them as office manager on RealComply.`,
      },
      { kind: "label", text: "What you are approving" },
      { kind: "rows", rows: [{ title: input.wording, tone: "routine" }] },
      { kind: "label", text: "An office manager can" },
      list(OFFICE_MANAGER_CAN),
      { kind: "label", text: "These stay with you" },
      list(LICENSEE_KEEPS),
      {
        kind: "paragraph",
        text: "The link opens this wording. You approve by typing your name. You don't need an account or a password.",
      },
      { kind: "button", label: "Check and approve", href: input.url },
      {
        kind: "note",
        text: `If you don't want ${input.personName} to be office manager, don't approve it. If you do approve, you can withdraw it at any time from the confirmation email we send you. This link is for you only and expires on ${input.expiresAt}. If you weren't expecting it, email admin@realcomply.com.au and let us know.`,
      },
    ],
    footer: [`Sent by ${input.officeName} through RealComply.`, DILIGENCE_LINE],
  };
}

export function buildOfficeManagerRequestEmail(input: OfficeManagerRequestEmail): { subject: string; text: string; html: string } {
  const doc = officeManagerRequestDocument(input);
  return { subject: officeManagerRequestSubject(input), text: renderEmailText(doc), html: renderEmailHtml(doc) };
}

export type OfficeManagerApprovedEmail = {
  personName: string;
  officeName: string;
  approvedByName: string;
  /** Formatted for a human, e.g. "27 October 2026, 9:14 am". */
  approvedAt: string;
  wording: string;
  withdrawUrl: string;
};

export function officeManagerApprovedDocument(input: OfficeManagerApprovedEmail): EmailDocument {
  return {
    preheader: `Your approval of ${input.personName} as office manager for ${input.officeName} is recorded. Keep this email.`,
    title: "Your approval is recorded",
    meta: `${input.officeName} · Office manager`,
    sections: [
      {
        kind: "rows",
        rows: [
          {
            title: input.wording,
            sub: `Approved by ${input.approvedByName}, licensee in charge`,
            detail: input.approvedAt,
            tone: "routine",
          },
        ],
      },
      {
        kind: "paragraph",
        text: `You can withdraw this at any time. ${input.personName} loses the office side as soon as you do.`,
      },
      { kind: "button", label: "Withdraw my approval", href: input.withdrawUrl },
      {
        kind: "note",
        text: `Keep this email. The withdraw link works for as long as ${input.personName} is office manager.`,
      },
    ],
    footer: [`Sent by ${input.officeName} through RealComply.`, DILIGENCE_LINE],
  };
}

export function buildOfficeManagerApprovedEmail(input: OfficeManagerApprovedEmail): { subject: string; text: string; html: string } {
  const doc = officeManagerApprovedDocument(input);
  return {
    subject: `You approved ${input.personName} as office manager for ${input.officeName}`,
    text: renderEmailText(doc),
    html: renderEmailHtml(doc),
  };
}

export type OfficeManagerWithdrawnEmail = {
  personName: string;
  officeName: string;
  withdrawnByName: string;
  /** Formatted for a human, e.g. "3 November 2026 at 4:40 pm". */
  withdrawnAt: string;
};

export function officeManagerWithdrawnDocument(input: OfficeManagerWithdrawnEmail): EmailDocument {
  return {
    preheader: `${input.withdrawnByName} has withdrawn your office manager approval for ${input.officeName}.`,
    title: "Your office manager approval was withdrawn",
    meta: input.officeName,
    sections: [
      {
        kind: "paragraph",
        text: `${input.withdrawnByName}, licensee in charge of ${input.officeName}, withdrew your office manager approval on ${input.withdrawnAt}. Your own listings and records are as they were. Team, Office profile, registers, training, trust accounts and the SG Manual are no longer in your menu.`,
      },
    ],
    footer: [DILIGENCE_LINE],
  };
}

export function buildOfficeManagerWithdrawnEmail(input: OfficeManagerWithdrawnEmail): { subject: string; text: string; html: string } {
  const doc = officeManagerWithdrawnDocument(input);
  return {
    subject: `${input.withdrawnByName} has withdrawn your office manager approval`,
    text: renderEmailText(doc),
    html: renderEmailHtml(doc),
  };
}
