import { renderEmailHtml, renderEmailText, DILIGENCE_LINE, type EmailDocument } from "./layout";
import { formatAuDate } from "@/lib/format-date";
import { SG_2_1_2 } from "@/lib/sg-document/fair-trading";
import { REVIEW_SCHEDULE_WORDS, reviewWhenSaid } from "@/lib/sg-document/annual-review";

// The annual review reminder (Adam's mockup, signed off 6 Nov 2026, screen 7;
// Master, 10 Nov 2026; 0126). To the licensee in charge and every office
// manager, at 90, 60, 30, 14 and 7 days before the review is due, quoting
// Fair Trading's Supervision Guidelines 2.1.2 word for word. Sent by the
// daily job (lib/sg-document/review-reminders.ts).

export type SgReviewEmail = {
  recipientName: string;
  officeName: string;
  /** YYYY-MM-DD */
  dueOn: string;
  /** Days until it's due, Sydney's: negative once it has passed. */
  days: number;
  /** The app's address, e.g. https://www.realcomply.com.au */
  appUrl: string;
};

const officeOf = (name: string) => (name.trim() ? `${name.trim()}'s` : "your office's");
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function sgReviewSubject(input: Pick<SgReviewEmail, "dueOn" | "days">): string {
  return input.days >= 0
    ? `Annual review of your supervision guidelines: due ${formatAuDate(input.dueOn)}`
    : `Annual review of your supervision guidelines: due ${formatAuDate(input.dueOn)}, now overdue`;
}

export function sgReviewDocument(input: SgReviewEmail): EmailDocument {
  const due = formatAuDate(input.dueOn);
  const first = input.recipientName.trim().split(/\s+/)[0];
  const lead =
    input.days >= 0
      ? `${officeOf(input.officeName)} supervision guidelines and operational procedures are due for review by ${due}, ${reviewWhenSaid(input.days)}.`
      : `${officeOf(input.officeName)} supervision guidelines and operational procedures were due for review on ${due}, ${reviewWhenSaid(input.days)}.`;
  return {
    preheader: capital(lead),
    title: "Annual review of your supervision guidelines",
    meta: input.officeName.trim() || undefined,
    sections: [
      { kind: "paragraph", lead: true, text: first ? `Hi ${first}, ${lead}` : capital(lead) },
      { kind: "label", text: "Fair Trading's Supervision Guidelines, 2.1.2" },
      { kind: "quote", paragraphs: SG_2_1_2.paragraphs, bullets: SG_2_1_2.areas, source: SG_2_1_2.source },
      {
        kind: "paragraph",
        text:
          "In RealComply you can make a quick amendment, upload a new version, or mark them reviewed with no changes needed. " +
          "Any of these moves the next review to 12 months from that day and stops these reminders.",
      },
      { kind: "button", label: "Review in RealComply", href: `${input.appUrl}/dashboard/sg-manual` },
    ],
    footer: [
      `Sent to the licensee in charge and office managers of ${input.officeName.trim() || "your office"}, ${REVIEW_SCHEDULE_WORDS} before the review is due.`,
      DILIGENCE_LINE,
    ],
  };
}

export function buildSgReviewEmail(input: SgReviewEmail): { subject: string; text: string; html: string } {
  const doc = sgReviewDocument(input);
  return { subject: sgReviewSubject(input), text: renderEmailText(doc), html: renderEmailHtml(doc) };
}
