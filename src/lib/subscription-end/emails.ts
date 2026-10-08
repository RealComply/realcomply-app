import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email/send";
import { renderEmailHtml, renderEmailText, type EmailDocument } from "@/lib/email/layout";
import { addDays, daysLeft, deletionDate, longDate } from "./dates";
import { accountHolderId } from "./access";

// The two emails after a subscription ends (brief, item 4).
//
// Day 0: "Your RealComply subscription has ended. Download your records by
// [date]." Day 7: "7 days left to download your RealComply records." Both go
// to the account holder and the licensee in charge, once each if they are the
// same person, and both lead with Reactivate.
//
// DONE MEANS QUIET. Each send reads the live agency row first and sends
// nothing if the subscription has been reactivated (ended_at cleared) or the
// email has already gone. The "sent" stamp is only written after a send
// succeeds, so a failed send is tried again on the next run.
//
// THE LEGAL HOLD LINE (Adam, 8 Oct 2026). RealComply relies on the agency to
// say if it is under an investigation, dispute or legal process. Both emails
// say so in writing, with the date, so the burden sits with the agency.
//
// THE SECTION 104 REMINDER (Data Retention Policy v3, section 5.1, confirmed
// by Adam 8 Oct 2026) is in the day 7 email.

const RECORDS_URL = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.realcomply.com.au"}/dashboard/records`;

export const FOOTER = [
  "RealComply Pty Ltd, ABN 61 700 934 792. Questions: admin@realcomply.com.au",
];

export type EndedEmailKind = "day0" | "day7";

export function legalHoldLine(deleteOn: string): string {
  return (
    "If your agency is subject to an investigation, dispute or legal process that requires these " +
    `records to be kept, tell us at admin@realcomply.com.au before ${longDate(deleteOn)}. If we don't ` +
    "hear from you, your records will be deleted on that date."
  );
}

/** The email itself, apart from who it goes to. Pure, so the wording can be checked. */
export function endedEmail(
  kind: EndedEmailKind,
  input: { agencyName: string; endedAt: Date; now?: Date },
): { subject: string; text: string; html: string } {
  const left = daysLeft(input.endedAt, input.now ?? new Date());
  const deleteOn = deletionDate(input.endedAt);
  const lastDay = addDays(deleteOn, -1);

  const doc: EmailDocument =
    kind === "day0"
      ? {
          preheader: `Your records will be deleted on ${longDate(deleteOn)}. Download them before then.`,
          title: "Your subscription has ended",
          meta: input.agencyName,
          sections: [
            {
              kind: "paragraph",
              lead: true,
              text:
                `${input.agencyName}'s RealComply subscription has ended. Nothing can be added or ` +
                "changed, but you can still download a complete copy of your records.",
            },
            {
              kind: "counter",
              n: left,
              caption: `${left === 1 ? "day" : "days"} left. Your records will be permanently deleted on ${longDate(deleteOn)}.`,
              tone: "warn",
            },
            {
              kind: "paragraph",
              text: "Changed your mind? Reactivate and everything comes back exactly as it was.",
            },
            { kind: "button", label: "Reactivate subscription", href: `${RECORDS_URL}#reactivate` },
            { kind: "button", label: "Download your records", href: RECORDS_URL },
            { kind: "paragraph", text: legalHoldLine(deleteOn) },
            {
              kind: "note",
              text:
                "Only the licensee in charge and the account holder can download records. " +
                "After deletion, RealComply keeps only an activity record that uses internal " +
                "identifiers rather than names or addresses, for 7 years.",
            },
          ],
          footer: FOOTER,
        }
      : {
          preheader: `Your records will be deleted on ${longDate(deleteOn)}.`,
          title: "7 days left to download your records",
          meta: input.agencyName,
          sections: [
            {
              kind: "paragraph",
              lead: true,
              text:
                `${input.agencyName}'s records will be permanently deleted on ${longDate(deleteOn)}. ` +
                `Download them by ${longDate(lastDay)}.`,
            },
            {
              kind: "paragraph",
              text:
                "Under section 104 of the Property and Stock Agents Act 2002 (NSW) your agency must " +
                "keep its records for at least three years. RealComply will not hold them after " +
                `${longDate(deleteOn)}, so make sure you have your own copy.`,
            },
            { kind: "button", label: "Reactivate subscription", href: `${RECORDS_URL}#reactivate` },
            { kind: "button", label: "Download your records", href: RECORDS_URL },
            { kind: "paragraph", text: legalHoldLine(deleteOn) },
          ],
          footer: FOOTER,
        };

  const subject =
    kind === "day0"
      ? `Your RealComply subscription has ended. Download your records by ${longDate(lastDay)}.`
      : "7 days left to download your RealComply records.";

  return { subject, text: renderEmailText(doc), html: renderEmailHtml(doc) };
}

/** The account holder and the licensee in charge, each once. */
export async function endedRecipients(supabase: SupabaseClient, agencyId: string): Promise<string[]> {
  const holderId = await accountHolderId(supabase, agencyId);
  const { data } = await supabase
    .from("profiles")
    .select("id, email, is_licensee_in_charge, archived_at")
    .eq("agency_id", agencyId);

  const people = (data ?? []) as Array<{
    id: string;
    email: string | null;
    is_licensee_in_charge: boolean | null;
    archived_at: string | null;
  }>;

  const emails = people
    .filter((p) => p.id === holderId || (p.is_licensee_in_charge && !p.archived_at))
    .map((p) => p.email?.trim().toLowerCase())
    .filter((e): e is string => Boolean(e));

  return [...new Set(emails)];
}

export type SendResult = "sent" | "skipped" | "send_failed";

/**
 * Sends one of the two emails if, and only if, it is still owed. Reads the
 * live row first. Service client only: there is no signed-in user in a cron
 * run or a webhook.
 */
export async function sendEndedEmail(
  supabase: SupabaseClient,
  agencyId: string,
  kind: EndedEmailKind,
  send: typeof sendEmail = sendEmail,
): Promise<SendResult> {
  const column = kind === "day0" ? "ended_notice_sent_at" : "ended_reminder_sent_at";

  const { data } = await supabase
    .from("agencies")
    .select("id, name, ended_at, ended_notice_sent_at, ended_reminder_sent_at")
    .eq("id", agencyId)
    .maybeSingle();

  const agency = data as {
    id: string;
    name: string;
    ended_at: string | null;
    ended_notice_sent_at: string | null;
    ended_reminder_sent_at: string | null;
  } | null;

  // Reactivated, deleted, or already sent: quiet.
  if (!agency?.ended_at) return "skipped";
  if (agency[column]) return "skipped";

  const to = await endedRecipients(supabase, agencyId);
  if (to.length === 0) {
    console.error("subscription-end: no recipients for agency", agencyId);
    return "skipped";
  }

  const message = endedEmail(kind, { agencyName: agency.name, endedAt: new Date(agency.ended_at) });

  // One message each, not one with everyone on it: the licensee and the
  // account holder may not know each other's addresses.
  let allSent = true;
  for (const address of to) {
    const ok = await send({ to: address, ...message });
    if (!ok) allSent = false;
  }
  if (!allSent) return "send_failed";

  // Only stamped while the same end is still current, so a reactivation that
  // lands mid-send does not leave a stale stamp behind.
  await supabase
    .from("agencies")
    .update({ [column]: new Date().toISOString() })
    .eq("id", agencyId)
    .eq("ended_at", agency.ended_at);

  return "sent";
}
