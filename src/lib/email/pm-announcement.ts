import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail, type SendEmailInput } from "@/lib/email/send";
import { renderEmailHtml, renderEmailText, type EmailDocument } from "./layout";
import { ADMIN_COPY_ADDRESS, SENDER_NAME } from "./early-access-invite";
import type { AnnouncementSend } from "@/lib/types";

// Property management is now in your account: a one-off email (Adam, 22 Oct
// 2026). PM went on for every office plan in 0086. Five offices had it
// switched on that day without asking for it, so they're told once.
//
// WHO. The current licensee in charge (not archived) of each of the five
// offices below, looked up when it sends. Nobody else: not Raine & Horne
// Queanbeyan, Cass Property, Comply Real Estate, Sam RE, Adam's test agency
// or any made-up office. The names are matched exactly (ignoring spaces at
// either end); an office that can't be found, or has no single current
// licensee in charge, is listed as a problem and not sent.
//
// HOW. RealComply's own email (Amazon SES, the same as every account email),
// replies to admin@realcomply.com.au. Sent from the staff page, in two
// steps: one test to Adam's test address, filled in as if for Foster, then,
// on Adam's "send", the five.
//
// ONCE EACH, the CPD reminders' pattern: the row in announcement_sends (0090)
// is written BEFORE the email goes, and a unique index on (announcement,
// office) refuses a second one. A second run finds every office recorded and
// sends nothing.

export const PM_ANNOUNCEMENT = "pm-launch-2026-10";

export const PM_ANNOUNCEMENT_OFFICES = [
  "Foster Property Consultants PTY LTD",
  "Lloyd Property Agents",
  "Yes Property Agents",
  "One Agency Deborah Low Property",
  "NindraRealty",
] as const;

/** The test goes here, and only here. */
export const PM_ANNOUNCEMENT_TEST_ADDRESS = "getadamc3+pmannounce@gmail.com";

/** The office the test is filled in for. */
export const PM_ANNOUNCEMENT_TEST_OFFICE = "Foster Property Consultants PTY LTD";

export const PM_ANNOUNCEMENT_SUBJECT = "Property management is now in your RealComply account";

const PM_URL = "https://www.realcomply.com.au/dashboard/pm";

const FOOTER = ["Diligence support, not legal advice. The licensee remains responsible for decisions and sign-off."];

/**
 * The first word of their name. A name typed all in lower case gets a
 * capital ("tom" reads as "Hi Tom,"); anything else is left as they wrote it.
 */
export function announcementFirstName(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  if (!first) return null;
  return first === first.toLowerCase() ? first.charAt(0).toUpperCase() + first.slice(1) : first;
}

export function pmAnnouncementDocument(firstName: string | null, officeName: string): EmailDocument {
  return {
    preheader: `Property management is now switched on for ${officeName}.`,
    title: firstName ? `Hi ${firstName},` : "Hi,",
    sections: [
      {
        kind: "paragraph",
        text:
          `Property management is now switched on for ${officeName}. ` +
          `You'll see "Property management" in the menu next time you open RealComply. ` +
          "It's included in your office plan at no extra cost.",
      },
      {
        kind: "paragraph",
        text:
          "It takes each managed property through five stages, from management onboarding to the end of a tenancy, " +
          "with each obligation, its legal reference and a record of who ticked it and when. " +
          "RealComply doesn't hold your PM documents. Those stay in your own system.",
      },
      {
        kind: "paragraph",
        text:
          "A good first step: at the top of the Property management page, note where your PM records are kept (for example PropertyMe). " +
          "Then add a property to see its checklist.",
      },
      { kind: "paragraph", text: "It's new, so we'd welcome your feedback. Just reply to this email." },
      { kind: "button", label: "Go to Property management", href: PM_URL },
    ],
    footer: FOOTER,
  };
}

/** The email as it goes: SES (the default provider), replies to admin@. */
export function pmAnnouncementEmail(to: string, firstName: string | null, officeName: string): SendEmailInput {
  const doc = pmAnnouncementDocument(firstName, officeName);
  return {
    to,
    subject: PM_ANNOUNCEMENT_SUBJECT,
    text: renderEmailText(doc),
    html: renderEmailHtml(doc),
    replyTo: ADMIN_COPY_ADDRESS,
    fromName: SENDER_NAME,
  };
}

// ── Who it goes to, as it stands right now ──────────────────────────────────

export type PmAnnouncementRow = {
  /** The name it was asked to go to. */
  office: string;
  agencyId: string | null;
  /** The office's name in RealComply. */
  officeName: string | null;
  profileId: string | null;
  licenseeName: string | null;
  firstName: string | null;
  email: string | null;
  /** Why it can't go. Null when it can. */
  problem: string | null;
  /** What's recorded for this office, if anything. */
  record: Pick<AnnouncementSend, "status" | "recipient" | "recipient_name" | "created_at" | "sent_at"> | null;
};

type AgencyLookup = { id: string; name: string; pm_enabled: boolean | null; ended_at: string | null };
type LicenseeLookup = {
  id: string;
  agency_id: string;
  full_name: string | null;
  email: string | null;
  is_licensee_in_charge: boolean | null;
  archived_at: string | null;
};

type Client = ReturnType<typeof createServiceClient>;

export async function pmAnnouncementList(supabase: Client): Promise<PmAnnouncementRow[]> {
  const [{ data: agencyRows }, { data: sendRows, error: sendsError }] = await Promise.all([
    supabase.from("agencies").select("id, name, pm_enabled, ended_at"),
    supabase.from("announcement_sends").select("*").eq("announcement", PM_ANNOUNCEMENT),
  ]);
  const agencies = (agencyRows ?? []) as AgencyLookup[];
  const sends = (sendRows ?? []) as AnnouncementSend[];
  // No record to check against, no send: without it a second run would send
  // again. (Before 0090 is run, the table isn't there.)
  const noRecord = sendsError ? "The send record can't be read (has 0090 been run?)." : null;

  const rows: PmAnnouncementRow[] = [];
  for (const office of PM_ANNOUNCEMENT_OFFICES) {
    const row: PmAnnouncementRow = {
      office,
      agencyId: null,
      officeName: null,
      profileId: null,
      licenseeName: null,
      firstName: null,
      email: null,
      problem: null,
      record: null,
    };
    rows.push(row);

    const matches = agencies.filter((a) => a.name.trim() === office);
    if (matches.length !== 1) {
      row.problem = matches.length === 0 ? "No office with this name." : "More than one office with this name.";
      continue;
    }
    const agency = matches[0];
    row.agencyId = agency.id;
    row.officeName = agency.name.trim();
    const sent = sends.find((s) => s.agency_id === agency.id);
    if (sent) row.record = sent;

    const { data: people } = await supabase
      .from("profiles")
      .select("id, agency_id, full_name, email, is_licensee_in_charge, archived_at")
      .eq("agency_id", agency.id)
      .eq("is_licensee_in_charge", true)
      .is("archived_at", null);
    const licensees = ((people ?? []) as LicenseeLookup[]).filter(
      (p) => p.agency_id === agency.id && p.is_licensee_in_charge === true && !p.archived_at,
    );
    if (licensees.length === 1) {
      const lic = licensees[0];
      row.profileId = lic.id;
      row.licenseeName = lic.full_name?.trim() || null;
      row.firstName = announcementFirstName(lic.full_name);
      row.email = lic.email?.trim() || null;
    }

    if (noRecord) row.problem = noRecord;
    else if (agency.ended_at) row.problem = "Its subscription has ended.";
    else if (agency.pm_enabled !== true) row.problem = "Property management isn't on for this office.";
    else if (licensees.length === 0) row.problem = "No current licensee in charge.";
    else if (licensees.length > 1) row.problem = "More than one current licensee in charge.";
    else if (!row.email) row.problem = "The licensee in charge has no email address.";
  }
  return rows;
}

// ── Sending ──────────────────────────────────────────────────────────────────

export type PmAnnouncementDeps = {
  supabase?: Client;
  send?: typeof sendEmail;
  now?: () => Date;
};

export type PmAnnouncementResult = {
  sent: number;
  /** Already recorded: not sent again. */
  alreadySent: number;
  /** Listed with a problem: not sent. */
  notSent: number;
  failed: number;
  lines: string[];
};

/** The five, each once. Safe to run again: anything recorded is skipped. */
export async function sendPmAnnouncement(deps: PmAnnouncementDeps = {}): Promise<PmAnnouncementResult> {
  const supabase = deps.supabase ?? createServiceClient();
  const send = deps.send ?? sendEmail;
  const now = deps.now ?? (() => new Date());
  const result: PmAnnouncementResult = { sent: 0, alreadySent: 0, notSent: 0, failed: 0, lines: [] };

  for (const row of await pmAnnouncementList(supabase)) {
    if (row.record) {
      result.alreadySent += 1;
      result.lines.push(`${row.office}: already ${row.record.status === "failed" ? "tried (failed)" : "sent"}, not sent again.`);
      continue;
    }
    if (row.problem || !row.agencyId || !row.email || !row.officeName) {
      result.notSent += 1;
      result.lines.push(`${row.office}: not sent. ${row.problem ?? "Nothing to send to."}`);
      continue;
    }

    // Record first, send second (see the top of this file).
    const id = crypto.randomUUID();
    const { error } = await supabase.from("announcement_sends").insert({
      id,
      announcement: PM_ANNOUNCEMENT,
      agency_id: row.agencyId,
      profile_id: row.profileId,
      office_name: row.officeName,
      recipient_name: row.licenseeName,
      recipient: row.email,
      status: "sending",
    });
    if (error) {
      // Another run got there first (the unique index doing its job), or the
      // write failed. Either way, don't send.
      result.notSent += 1;
      result.lines.push(`${row.office}: not sent. It couldn't be recorded (already recorded, or the write failed).`);
      continue;
    }

    const ok = await send(pmAnnouncementEmail(row.email, row.firstName, row.officeName));
    await supabase
      .from("announcement_sends")
      .update({ status: ok ? "sent" : "failed", sent_at: ok ? now().toISOString() : null })
      .eq("id", id);
    if (ok) {
      result.sent += 1;
      result.lines.push(`${row.office}: sent to ${row.licenseeName ?? "the licensee"} <${row.email}>.`);
    } else {
      result.failed += 1;
      result.lines.push(`${row.office}: didn't send to ${row.email}. The email provider refused it.`);
    }
  }
  return result;
}

/** The test: the email exactly as the office gets it, to Adam's test address. Not recorded. */
export async function pmAnnouncementTest(
  supabase: Client,
): Promise<{ email: SendEmailInput; row: PmAnnouncementRow } | { error: string }> {
  const row = (await pmAnnouncementList(supabase)).find((r) => r.office === PM_ANNOUNCEMENT_TEST_OFFICE);
  if (!row?.officeName) return { error: `Couldn't find ${PM_ANNOUNCEMENT_TEST_OFFICE} to fill the test in.` };
  return { email: pmAnnouncementEmail(PM_ANNOUNCEMENT_TEST_ADDRESS, row.firstName, row.officeName), row };
}
