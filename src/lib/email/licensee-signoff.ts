import { renderEmailHtml, renderEmailText, DILIGENCE_LINE, type EmailDocument } from "./layout";
import {
  monthName,
  packEmailLine,
  packEmailSubject,
  type Group,
} from "@/lib/licensee-signoff/model";

// The licensee's sign-off emails (Adam, 3 Nov 2026; 0109): the month's pack,
// one item's link for a licensee with no login, and the monthly reminders.
// Plain, with a plain-text part and every link on www.realcomply.com.au, like
// every approval email since the email job (2 Nov 2026).

export const COMPANY_LINE = "RealComply Pty Ltd, ABN 61 700 934 792.";
const LINK_FOR_YOU = "The link works without logging in and is for you only.";

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

export type PackEmail = {
  licenseeName: string;
  senderName: string;
  officeName: string;
  month: string;
  counts: Record<Group, number>;
  total: number;
  flagged: number;
  /** The trust group is reconciliations only: "2 trust reconciliations". */
  trustAllReconciliations?: boolean;
  url: string;
};

export function packEmailDocument(e: PackEmail): EmailDocument {
  return {
    preheader: `${monthName(e.month)}'s sign-off pack for ${e.officeName}.`,
    sections: [
      { kind: "paragraph", text: `Hi ${firstName(e.licenseeName)},` },
      {
        kind: "paragraph",
        text: packEmailLine({
          senderName: e.senderName,
          month: e.month,
          officeName: e.officeName,
          counts: e.counts,
          flagged: e.flagged,
          trustAllReconciliations: e.trustAllReconciliations,
        }),
      },
      { kind: "button", label: "Open the pack", href: e.url },
      { kind: "note", text: LINK_FOR_YOU },
    ],
    footer: [`Sent by ${e.officeName} through RealComply.`, COMPANY_LINE, DILIGENCE_LINE],
  };
}

export function buildPackEmail(e: PackEmail): { subject: string; text: string; html: string } {
  const doc = packEmailDocument(e);
  return { subject: packEmailSubject(e.month, e.total), text: renderEmailText(doc), html: renderEmailHtml(doc) };
}

/** What each item asks of the licensee, in the subject and the email. */
export const ITEM_ASK: Record<string, string> = {
  trust_reconciliation: "a trust account reconciliation to sign",
  trust_audit: "the trust account audit to confirm",
  sg_manual: "a new version of the Supervision Guidelines to sign",
  training_plan: "a training plan to sign",
  complaint: "a resolved complaint to sign off",
  gift: "a gift over the limit to review",
};

export type ItemLinkEmail = {
  licenseeName: string;
  officeName: string;
  itemType: string;
  title: string;
  details: string;
  url: string;
  expiresAt: string;
};

export function itemLinkSubject(e: Pick<ItemLinkEmail, "officeName" | "itemType">): string {
  const ask = ITEM_ASK[e.itemType] ?? "something to sign";
  return `${e.officeName}: ${ask.charAt(0).toUpperCase()}${ask.slice(1)}`;
}

export function buildItemLinkEmail(e: ItemLinkEmail): { subject: string; text: string; html: string } {
  const doc: EmailDocument = {
    preheader: `${e.officeName} has ${ITEM_ASK[e.itemType] ?? "something"} waiting for you.`,
    sections: [
      { kind: "paragraph", text: `Hi ${firstName(e.licenseeName)},` },
      {
        kind: "paragraph",
        text: `${e.officeName} has ${ITEM_ASK[e.itemType] ?? "something to sign"} waiting for you, as licensee in charge.`,
      },
      { kind: "rows", rows: [{ title: e.title, detail: e.details, tone: "routine" }] },
      { kind: "button", label: "Open it", href: e.url },
      { kind: "note", text: `${LINK_FOR_YOU} It expires on ${e.expiresAt}.` },
    ],
    footer: [`Sent by ${e.officeName} through RealComply.`, COMPANY_LINE, DILIGENCE_LINE],
  };
  return { subject: itemLinkSubject(e), text: renderEmailText(doc), html: renderEmailHtml(doc) };
}

/** The 1st of the month, in a "Monthly pack" office: to the office manager (or the licensee). */
export function buildSendPackReminder(e: { name: string; officeName: string; month: string; n: number; url: string }) {
  const subject = `Time to send ${monthName(e.month)}'s sign-off pack`;
  const doc: EmailDocument = {
    preheader: `${e.n} ${e.n === 1 ? "item is" : "items are"} waiting for the licensee's signature.`,
    sections: [
      { kind: "paragraph", text: `Hi ${firstName(e.name)},` },
      {
        kind: "paragraph",
        text: `${monthName(e.month)}'s sign-off pack for ${e.officeName} is ready to send: ${e.n} ${e.n === 1 ? "item is" : "items are"} waiting for the licensee's signature.`,
      },
      { kind: "button", label: "Open the pack", href: e.url },
    ],
    footer: [COMPANY_LINE, DILIGENCE_LINE],
  };
  return { subject, text: renderEmailText(doc), html: renderEmailHtml(doc) };
}

/** 7 days after a pack was sent and not signed: to the licensee, with their link. */
export function buildSignPackReminder(e: { licenseeName: string; officeName: string; month: string; n: number; url: string }) {
  const subject = `Reminder: your ${monthName(e.month)} sign-off pack`;
  const doc: EmailDocument = {
    preheader: `${monthName(e.month)}'s sign-off pack for ${e.officeName} is still waiting for you.`,
    sections: [
      { kind: "paragraph", text: `Hi ${firstName(e.licenseeName)},` },
      {
        kind: "paragraph",
        text: `${monthName(e.month)}'s sign-off pack for ${e.officeName} is still waiting for your signature: ${e.n} ${e.n === 1 ? "item" : "items"}.`,
      },
      { kind: "button", label: "Open the pack", href: e.url },
      { kind: "note", text: LINK_FOR_YOU },
    ],
    footer: [`Sent by ${e.officeName} through RealComply.`, COMPANY_LINE, DILIGENCE_LINE],
  };
  return { subject, text: renderEmailText(doc), html: renderEmailHtml(doc) };
}
