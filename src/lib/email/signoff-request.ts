import { renderEmailHtml, renderEmailText, DILIGENCE_LINE, type EmailDocument } from "./layout";

// The email that carries a licensee sign-off link.
//
// WHY THIS ONE IS DIFFERENT FROM EVERY OTHER EMAIL THE APP SENDS.
//
// Every other RealComply email goes to a logged-in user who signed up. This
// one goes to a licensee in charge who has **never heard of RealComply**,
// from a domain they do not recognise, containing a link, asking them to type
// their name and sign something with legal weight.
//
// That is phishing-shaped. Not slightly — exactly. A careful licensee, which
// is the kind you want, should hesitate. If this email is written the way SaaS
// emails are usually written, the good ones will delete it and the feature
// quietly does not work.
//
// So three things are load-bearing, and none of them is decoration:
//
//   1. THE AGENT'S NAME AND THE PROPERTY ADDRESS COME FIRST. Not the product
//      name, not a greeting. The subject line and the first line both have to
//      contain something the licensee already knows to be true before they
//      decide whether this is real. "Jane Smith — 12 Werombi Rd" is
//      recognisable; "Action required: signature request" is not.
//
//   2. REPLY-TO IS THE AGENT. Set by the caller, not here, but the copy leans
//      on it: the licensee is told, in terms, that replying reaches the agent.
//      A noreply address on a message like this confirms the reader's worst
//      guess.
//
//   3. IT SAYS WHAT THEY ARE SIGNING BEFORE THEY CLICK. The statement itself
//      is on the page behind the link, but a reader deciding whether to trust
//      the link needs to know what is on the other side first. The summary
//      here is deliberately specific — property, agreement date, price range —
//      because specificity is what a phishing email cannot fake.
//
// Adam, 17 Sep 2026, on the old copy-and-paste flow: "it should get
// automatically sent to the licensee so that the agent doesn't have to create
// a link, copy it, open their email, paste it in, send it with an explanation.
// We should do all that for them."

export type SignoffRequestEmail = {
  agentName: string;
  agencyName: string;
  propertyAddress: string;
  url: string;
  expiresAt: string;
  /** Formatted for a human, e.g. "17 Sep 2026". Null when not on file. */
  agreementDate: string | null;
  espLow: number | null;
  espHigh: number | null;
};

const money = (n: number): string => `$${n.toLocaleString("en-AU")}`;

/**
 * The subject line.
 *
 * Agent name first, then the address. Both are things the licensee can verify
 * against their own knowledge in an inbox list, without opening anything.
 * "RealComply" appears nowhere in it — a name they do not recognise, in the
 * subject of a message asking for a signature, is a reason to delete.
 */
export function signoffRequestSubject(input: SignoffRequestEmail): string {
  return `${input.agentName} has asked you to sign off ${input.propertyAddress}`;
}

export function buildSignoffRequestEmail(input: SignoffRequestEmail): { subject: string; text: string; html: string } {
  const priceLine =
    input.espLow !== null && input.espHigh !== null
      ? `${money(input.espLow)} to ${money(input.espHigh)}`
      : null;

  const doc: EmailDocument = {
    // The grey line next to the subject. Says who and what, again, because in
    // Gmail this is the second thing read and often the deciding one.
    preheader: `${input.agentName} of ${input.agencyName} is asking for your licensee sign-off on the sales file for ${input.propertyAddress}.`,
    title: "A file is ready for your sign-off",
    meta: `${input.agencyName} · ${input.propertyAddress}`,
    sections: [
      {
        kind: "paragraph",
        lead: true,
        text: `${input.agentName} has completed the compliance file for ${input.propertyAddress} and needs your sign-off as licensee in charge.`,
      },
      {
        kind: "paragraph",
        text: "You don't need an account or a password. The link below opens a page with the full statement, and you sign by typing your name.",
      },
      { kind: "label", text: "What you'll be signing against" },
      {
        kind: "rows",
        rows: [
          {
            title: input.propertyAddress,
            sub: input.agreementDate
              ? `Selling agency agreement dated ${input.agreementDate}`
              : "Selling agency agreement on file",
            detail: priceLine
              ? `Estimated selling price currently on foot: ${priceLine}`
              : undefined,
            tone: "routine",
          },
        ],
      },
      { kind: "button", label: "Read the statement and sign", href: input.url },
      {
        kind: "note",
        text: `This link is for you only and expires on ${input.expiresAt}. If you weren't expecting it, reply to this email — it goes straight to ${input.agentName}, not to an unattended mailbox.`,
      },
    ],
    footer: [
      `Sent by ${input.agencyName} through RealComply, the compliance system ${input.agentName} uses to prepare sales files.`,
      DILIGENCE_LINE,
    ],
  };

  return {
    subject: signoffRequestSubject(input),
    text: renderEmailText(doc),
    html: renderEmailHtml(doc),
  };
}
