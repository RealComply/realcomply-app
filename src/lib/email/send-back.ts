import { renderEmailHtml, renderEmailText, DILIGENCE_LINE, type EmailDocument } from "./layout";
import { sentBackPriceStatementLine } from "@/lib/rules/price-statement";

// The email an agent gets when their licensee sends a file back for changes
// (Adam, 12 Oct 2026). Every name, address and note in it is typed by a
// person, and layout.ts escapes all of it: it goes in as plain text only.

export type SendBackEmail = {
  agentName: string | null;
  licenseeName: string | null;
  propertyAddress: string;
  url: string;
  cards: Array<{ itemKey: string; label: string; stageLabel: string; note: string; mayBeBreach: boolean }>;
  /**
   * b4 goes to the licensee by email: nobody in the office is an active
   * licensee in charge on RealComply (priceStatementByEmail, 0065).
   */
  priceStatementByEmail: boolean;
};

export function sendBackSubject(input: SendBackEmail): string {
  return `Changes needed before sign-off: ${input.propertyAddress}`;
}

export function buildSendBackEmail(input: SendBackEmail): { subject: string; text: string; html: string } {
  const who = input.licenseeName?.trim() || "Your licensee in charge";
  const n = input.cards.length;
  const anyBreach = input.cards.some((c) => c.mayBeBreach);
  // b4 when it goes by email (review, 11 Oct 2026). Nobody signed in can mark
  // it done, so its row says what to do instead, in the same words as the
  // note on the card and the to-do list, and the last paragraph doesn't tell
  // the agent to mark it done.
  const resendLine = (key: string) => sentBackPriceStatementLine(key, input.priceStatementByEmail);
  const resend = input.cards.filter((c) => resendLine(c.itemKey)).length;
  const rowDetail = (c: SendBackEmail["cards"][number]) => {
    const detail = c.mayBeBreach ? `${c.note} (Flagged as a possible breach.)` : c.note;
    const line = resendLine(c.itemKey);
    if (!line) return detail;
    // The note is the licensee's own words and often has no full stop. One
    // goes on before the line after it, so the two don't run together.
    return `${/[.!?]["'”’)]*$/.test(detail) ? detail : `${detail}.`} ${line}`;
  };
  const closing =
    resend === 0
      ? "Each card is back to not done. Fix it and mark it done as usual. When every card is done, sign the file again and send it back to your licensee for sign-off."
      : resend === n
        ? "The price statement is back to not done. Send it to your licensee again from its card, and their approval marks it done. Once they have approved it, sign the file again and send it back to your licensee for sign-off."
        : "Each card is back to not done. Fix it and mark it done as usual, except the price statement: send that to your licensee again from its card, and their approval marks it done. When every card is done, sign the file again and send it back to your licensee for sign-off.";

  const doc: EmailDocument = {
    preheader: `${who} reviewed the file for ${input.propertyAddress} and sent it back with ${n} card${n === 1 ? "" : "s"} to change.`,
    title: "Your licensee sent a file back for changes",
    meta: input.propertyAddress,
    sections: [
      { kind: "paragraph", lead: true, text: input.agentName ? `Hi ${input.agentName},` : "Hi," },
      {
        kind: "paragraph",
        text: `${who} reviewed the file for ${input.propertyAddress} and sent it back before signing. ${
          n === 1 ? "One card needs" : `${n} cards need`
        } changing.`,
      },
      { kind: "label", text: "What needs changing" },
      {
        kind: "rows",
        rows: input.cards.map((c) => ({
          title: c.label,
          sub: c.stageLabel,
          detail: rowDetail(c),
          tone: c.mayBeBreach ? ("risk" as const) : ("attention" as const),
        })),
      },
      { kind: "paragraph", text: closing },
      ...(anyBreach
        ? [
            {
              kind: "note" as const,
              text: "Your licensee thinks something here may be a breach. If it is, log it in the breach register as well as fixing the card.",
            },
          ]
        : []),
      { kind: "button", label: "Open the file", href: input.url },
    ],
    footer: [DILIGENCE_LINE],
  };

  return { subject: sendBackSubject(input), text: renderEmailText(doc), html: renderEmailHtml(doc) };
}
