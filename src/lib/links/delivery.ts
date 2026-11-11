import { addNswBusinessDays } from "@/lib/licensee-history";
import { sydneyDate } from "@/lib/subscription-end/dates";
import { formatAuDate, formatAuTime } from "@/lib/format-date";

// EMAIL THAT GETS THROUGH (Adam, 2 Nov 2026, queue item 2; 0107).
//
// Vic Srbinovski (Raine & Horne Queanbeyan) didn't get a price statement
// approval email on 21 Oct: most likely his office's email security held it.
// Offices must never need IT to let RealComply through, and never rely on
// email alone. So every emailed approval or signing link shows:
//   "Sent [date]", then "Opened [date, time]" only when a real person opened
//   it in a browser (a scanner fetching the link doesn't count; 0107), and,
//   after 2 NSW business days unopened, a nudge on Home and on the card.
//
// Copy link, option 2 (Adam, 3 Nov 2026): the file sign-off only, with a
// trail. Not the office manager approval or the annexure, where the person
// who would copy it is the person being approved, or the office adopting in
// the licensee's name. Who can sign is unchanged.
//
// Pure: every state is tested (delivery.test.ts).

/** What the link is for, as the nudge names it. */
export type LinkKind = "signoff" | "office_manager" | "annexure";

/** How many NSW business days a link may sit unopened before the nudge. */
export const UNOPENED_BUSINESS_DAYS = 2;

export type LinkDelivery = {
  /** When the email reached the provider. Null: not sent (yet), or before this was recorded. */
  emailSentAt: string | null;
  /** When the link was made, for links from before delivery was recorded. */
  createdAt: string;
  /** When a person first opened it in a browser (0107). */
  openedAt: string | null;
  /** When it was signed, approved or adopted: that is an open too. */
  doneAt: string | null;
};

/** "3 November 2026, 9:14am", in Sydney. */
export function formatAuDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = formatAuTime(d).replace(/\s/g, "");
  return `${formatAuDate(sydneyDate(d))}, ${time}`;
}

/** When a person first opened it: the recorded open, or the signature if that came first. */
export function openedAt(link: LinkDelivery): string | null {
  const times = [link.openedAt, link.doneAt].filter((t): t is string => Boolean(t)).sort();
  return times[0] ?? null;
}

/** "Sent 3 November 2026", or null when it hasn't gone. */
export function sentLine(link: LinkDelivery): string | null {
  return link.emailSentAt ? `Sent ${formatAuDate(sydneyDate(new Date(link.emailSentAt)))}` : null;
}

/** "Opened 3 November 2026, 9:14am", or "Not opened yet" once it has been sent. */
export function openedLine(link: LinkDelivery): string | null {
  const opened = openedAt(link);
  if (opened) return `Opened ${formatAuDateTime(opened)}`;
  return link.emailSentAt ? "Not opened yet" : null;
}

/**
 * True once the link has sat unopened for 2 full NSW business days after the
 * day it was sent: sent on a Monday, the nudge shows from Thursday.
 */
export function unopenedNudgeDue(link: LinkDelivery, now: Date = new Date()): boolean {
  if (openedAt(link) || !link.emailSentAt) return false;
  const sentOn = sydneyDate(new Date(link.emailSentAt));
  return sydneyDate(now) > addNswBusinessDays(sentOn, UNOPENED_BUSINESS_DAYS);
}

/**
 * The nudge, in Adam's words (2 Nov 2026), for the link it is about. Only the
 * file sign-off offers Copy link (option 2, 3 Nov 2026).
 *
 * CHANGE (Adam, 3 Nov 2026): was "ask them to check their quarantine". "No one
 * uses that word": now "ask them to check their spam or junk folder".
 */
export function nudgeText(kind: LinkKind, name: string): string {
  const who = name.trim() || "Your licensee";
  if (kind === "signoff") {
    return `${who} hasn't opened the sign-off link yet. Copy it and send it yourself, or ask them to check their spam or junk folder.`;
  }
  if (kind === "office_manager") {
    return `${who} hasn't opened the approval link yet. Ask them to check their spam or junk folder.`;
  }
  return `${who} hasn't opened the link to adopt the annexure yet. Ask them to check their spam or junk folder.`;
}

/** Under the Copy link button (Adam, 2 Nov 2026). */
export function copyLinkHint(name: string): string {
  return `If ${name.trim() || "your licensee"} hasn't received it, copy the link and send it yourself.`;
}

/** On the record and the card, when a link was signed after someone copied it (option 2's trail). */
export function copiedLinkLine(copy: { by: string; at: string }): string {
  return `Signed through a link ${copy.by} copied on ${formatAuDate(sydneyDate(new Date(copy.at)))} and sent outside RealComply's email.`;
}

/**
 * On the record, for any signature made through a link RealComply emailed
 * (Master, 4 Nov 2026): the address it went to. The office is responsible for
 * that address being its licensee's (0112).
 */
export function emailedLinkLine(address: string): string {
  return `Signed through a link emailed to ${address.trim().toLowerCase()}.`;
}

/** The copies that came before the signature: the trail is about those. */
export function copiesBeforeSigning<T extends { at: string }>(copies: T[], signedAt: string | null): T[] {
  const signed = signedAt ? Date.parse(signedAt) : NaN;
  if (Number.isNaN(signed)) return [];
  return copies.filter((c) => Date.parse(c.at) <= signed).sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
}

/** A file sign-off link, as Home reads it for the nudge (0107). */
export type SignoffLinkRow = {
  id: string;
  property_id: string;
  created_at: string;
  email_sent_at: string | null;
  opened_at: string | null;
  signed_at: string | null;
  expires_at: string;
};

/**
 * The sign-off links on Home: the newest live link on each listing, sent,
 * still unopened 2 NSW business days on. Signed, expired or never-sent links
 * aren't nudged (the card says when the email didn't go).
 */
export function signoffLinksToNudge(rows: SignoffLinkRow[], now: Date = new Date()): SignoffLinkRow[] {
  const newest = new Map<string, SignoffLinkRow>();
  for (const r of rows) {
    const had = newest.get(r.property_id);
    if (!had || Date.parse(r.created_at) > Date.parse(had.created_at)) newest.set(r.property_id, r);
  }
  return [...newest.values()]
    .filter((r) => !r.signed_at && Date.parse(r.expires_at) > now.getTime())
    .filter((r) =>
      unopenedNudgeDue({ emailSentAt: r.email_sent_at, createdAt: r.created_at, openedAt: r.opened_at, doneAt: r.signed_at }, now),
    )
    .sort((x, y) => Date.parse(x.email_sent_at ?? x.created_at) - Date.parse(y.email_sent_at ?? y.created_at));
}

/** The office's annexure link, as office_annexure_link_status() returns it (0107). */
export type AnnexureLinkRow = {
  sent_to: string;
  created_at: string;
  email_sent_at: string | null;
  opened_at: string | null;
  used_at: string | null;
  expires_at: string;
};

export type AnnexureLinkStatus = {
  licenseeName: string;
  sentTo: string;
  sentLine: string | null;
  openedLine: string | null;
  nudge: string | null;
};

/**
 * Whether the annexure link is still waiting, and where it is up to. Null once
 * it has been used (the office adopted) or has expired. A link from before
 * 0107 has no sent time; it was made only when its email went (new-office.ts
 * gives the claim back when the email fails), so its creation stands in.
 */
export function annexureLinkStatus(
  row: AnnexureLinkRow | null,
  licenseeName: string,
  now: Date = new Date(),
): AnnexureLinkStatus | null {
  if (!row || row.used_at || Date.parse(row.expires_at) <= now.getTime()) return null;
  const link: LinkDelivery = {
    emailSentAt: row.email_sent_at ?? row.created_at,
    createdAt: row.created_at,
    openedAt: row.opened_at,
    doneAt: null,
  };
  const name = licenseeName.trim() || row.sent_to;
  return {
    licenseeName: name,
    sentTo: row.sent_to,
    sentLine: sentLine(link),
    openedLine: openedLine(link),
    nudge: unopenedNudgeDue(link, now) ? nudgeText("annexure", name) : null,
  };
}
