import { renderEmailHtml, renderEmailText, DILIGENCE_LINE, type EmailDocument } from "./layout";

// The email the licensee in charge gets when someone asks them to reopen a
// card on a signed-off file (Adam, 28 Oct 2026). The name, address and reason
// are typed by people, and layout.ts escapes all of it: plain text only.

export type ReopenRequestEmail = {
  licenseeName: string | null;
  requesterName: string;
  propertyAddress: string;
  cardTitle: string;
  stageLabel: string;
  reason: string;
  url: string;
};

export function reopenRequestSubject(input: ReopenRequestEmail): string {
  return `Request to reopen a signed-off file: ${input.propertyAddress}`;
}

export function buildReopenRequestEmail(input: ReopenRequestEmail): { subject: string; text: string; html: string } {
  const doc: EmailDocument = {
    preheader: `${input.requesterName} asked you to reopen a card on the signed-off file for ${input.propertyAddress}.`,
    title: "A request to reopen a signed-off file",
    meta: input.propertyAddress,
    sections: [
      { kind: "paragraph", lead: true, text: input.licenseeName ? `Hi ${input.licenseeName},` : "Hi," },
      {
        kind: "paragraph",
        text: `${input.requesterName} asked you to reopen a card on the file for ${input.propertyAddress}, which you have signed off.`,
      },
      { kind: "label", text: "The card" },
      {
        kind: "rows",
        rows: [{ title: input.cardTitle, sub: input.stageLabel, detail: input.reason, tone: "attention" as const }],
      },
      {
        kind: "paragraph",
        text: "Reopening the card cancels your sign-off, which is kept on record, and the file will need signing off again. You can also decline the request. Both are on the card.",
      },
      { kind: "button", label: "Open the file", href: input.url },
    ],
    footer: [DILIGENCE_LINE],
  };
  return { subject: reopenRequestSubject(input), text: renderEmailText(doc), html: renderEmailHtml(doc) };
}
