import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import { renderEmailHtml, renderEmailText, type EmailDocument } from "./layout";
import { sydneyDate } from "@/lib/subscription-end/dates";
import {
  cpdReminderDue,
  cpdYearEndYear,
  cpdYearShortLabel,
  namesInWords,
  planCpdReminders,
} from "@/lib/cpd-reminders";
import type { Agency, CpdReminder, CpdYearSignoff, Profile } from "@/lib/types";

// CPD deadline reminders, the daily job (rules in lib/cpd-reminders.ts).
//
// Runs every morning and does nothing except on 1 April, 1 May, 1 June and
// 23 June (and up to three days after, if that day's run failed). On those
// dates it reads each office's CPD ticks as they stand right now, reminds
// everyone whose year isn't ticked, and sends the licensee in charge one
// summary of who is still outstanding.
//
// NEVER TWICE, the licence and trust reminders' pattern: the row in
// cpd_reminders is written BEFORE the email goes, and a unique index on
// (person, kind, CPD year, send date) in 0084 refuses a second one. A
// reminder that silently sends twice trains people to ignore the sender; one
// that occasionally fails to send is visible (no row, the job alerts) and is
// put right by a person.

const CPD_URL = "https://www.realcomply.com.au/dashboard/cpd";

const CPD_FOOTER = ["Diligence support, not legal advice. The licensee remains responsible for decisions and sign-off."];

type Named = Pick<Profile, "full_name" | "email">;

const firstName = (p: Named): string | null => p.full_name?.trim().split(/\s+/)[0] || null;
const displayName = (p: Named): string => p.full_name?.trim() || p.email;

export function personSubject(cpdYearStart: string): string {
  return `Your CPD for ${cpdYearShortLabel(cpdYearStart)} is due by 30 June`;
}

export function summarySubject(officeName: string, cpdYearStart: string): string {
  return `CPD still outstanding in ${officeName} for ${cpdYearShortLabel(cpdYearStart)}`;
}

/** The reminder to someone whose CPD year isn't ticked as done. */
export function personDocument(person: Named, cpdYearStart: string): EmailDocument {
  const ending = `30 June ${cpdYearEndYear(cpdYearStart)}`;
  const first = firstName(person);
  return {
    preheader: `Your CPD for the year ending ${ending} isn't marked as done yet.`,
    title: first ? `Hi ${first},` : "Hi,",
    sections: [
      {
        kind: "paragraph",
        text:
          `Your CPD for the year ending ${ending} isn't marked as done in RealComply yet. ` +
          "Once you've completed it, upload your certificates and tick the year off on your CPD page so these reminders stop.",
      },
      { kind: "button", label: "Go to my CPD", href: CPD_URL },
    ],
    footer: CPD_FOOTER,
  };
}

/** The licensee in charge's list of who is still outstanding. */
export function summaryDocument(officeName: string, outstanding: Named[], cpdYearStart: string): EmailDocument {
  const ending = `30 June ${cpdYearEndYear(cpdYearStart)}`;
  const names = namesInWords(outstanding.map(displayName));
  return {
    preheader: `${outstanding.length} still to tick off for the year ending ${ending}.`,
    title: "CPD still outstanding",
    meta: officeName,
    sections: [
      {
        kind: "paragraph",
        text: `These people's CPD for the year ending ${ending} isn't marked as done yet: ${names}.`,
      },
      { kind: "button", label: "Go to CPD", href: CPD_URL },
    ],
    footer: CPD_FOOTER,
  };
}

export type CpdReminderResult = {
  /** The send date acted on, or null when today isn't one. */
  sendDate: string | null;
  checked: number;
  /** Reminders to people, and summaries to licensees, that went out. */
  sentPeople: number;
  sentSummaries: number;
  /** Already recorded for this date: not sent again. */
  alreadySent: number;
  /** People whose year is ticked: nothing sent, nothing written. */
  done: number;
  failed: number;
};

/** Swappable for tests and the staff page's run for a made-up office. */
export type CpdReminderDeps = {
  supabase?: ReturnType<typeof createServiceClient>;
  send?: typeof sendEmail;
  /** Only these offices. The staff page uses it for a made-up office. */
  agencyIds?: string[];
};

export async function runCpdReminders(now: Date = new Date(), deps: CpdReminderDeps = {}): Promise<CpdReminderResult> {
  const supabase = deps.supabase ?? createServiceClient();
  const send = deps.send ?? sendEmail;
  const result: CpdReminderResult = {
    sendDate: null,
    checked: 0,
    sentPeople: 0,
    sentSummaries: 0,
    alreadySent: 0,
    done: 0,
    failed: 0,
  };

  // Sydney's date: the job runs at 21:45 UTC, which is already the next
  // morning in Sydney.
  const due = cpdReminderDue(sydneyDate(now));
  if (!due) return result;
  result.sendDate = due.sendDate;

  const { data: agencyRows } = await supabase.from("agencies").select("*");
  const agencies = ((agencyRows ?? []) as Agency[])
    // An office whose subscription has ended is on its records page and is
    // deleted at day 14. Nothing more to it.
    .filter((a) => !a.ended_at)
    .filter((a) => !deps.agencyIds || deps.agencyIds.includes(a.id));

  for (const agency of agencies) {
    const { data: profileRows } = await supabase.from("profiles").select("*").eq("agency_id", agency.id);
    const profiles = (profileRows ?? []) as Profile[];
    if (profiles.length === 0) continue;

    // The ticks as they stand now. Done means quiet.
    const { data: signoffRows } = await supabase
      .from("cpd_year_signoffs")
      .select("*")
      .eq("agency_id", agency.id)
      .eq("cpd_year_start", due.cpdYearStart);
    const doneIds = new Set(((signoffRows ?? []) as CpdYearSignoff[]).map((s) => s.profile_id));

    const { data: sentRows } = await supabase
      .from("cpd_reminders")
      .select("*")
      .eq("agency_id", agency.id)
      .eq("cpd_year_start", due.cpdYearStart)
      .eq("send_date", due.sendDate);
    const already = new Set(((sentRows ?? []) as CpdReminder[]).map((r) => `${r.kind}:${r.profile_id}`));

    const plan = planCpdReminders({ plan: agency.plan, profiles, doneIds });
    result.checked += profiles.filter((p) => !p.archived_at).length;
    result.done += profiles.filter((p) => !p.archived_at && doneIds.has(p.id)).length;

    for (const person of plan.people) {
      if (already.has(`person:${person.id}`)) {
        result.alreadySent += 1;
        continue;
      }
      // Record first, send second (see the top of this file).
      const { error } = await supabase.from("cpd_reminders").insert({
        agency_id: agency.id,
        profile_id: person.id,
        kind: "person",
        cpd_year_start: due.cpdYearStart,
        send_date: due.sendDate,
        outstanding: [],
        recipients: [person.email],
      });
      if (error) {
        // A concurrent run got there first (the unique index doing its job),
        // or the write failed. Either way, don't send.
        result.alreadySent += 1;
        continue;
      }
      const doc = personDocument(person, due.cpdYearStart);
      const ok = await send({
        to: person.email,
        subject: personSubject(due.cpdYearStart),
        text: renderEmailText(doc),
        html: renderEmailHtml(doc),
      });
      if (ok) result.sentPeople += 1;
      else result.failed += 1;
    }

    for (const { licensee, outstanding } of plan.summaries) {
      if (already.has(`summary:${licensee.id}`)) {
        result.alreadySent += 1;
        continue;
      }
      const { error } = await supabase.from("cpd_reminders").insert({
        agency_id: agency.id,
        profile_id: licensee.id,
        kind: "summary",
        cpd_year_start: due.cpdYearStart,
        send_date: due.sendDate,
        outstanding: outstanding.map((p) => p.id),
        recipients: [licensee.email],
      });
      if (error) {
        result.alreadySent += 1;
        continue;
      }
      const doc = summaryDocument(agency.name, outstanding, due.cpdYearStart);
      const ok = await send({
        to: licensee.email,
        subject: summarySubject(agency.name, due.cpdYearStart),
        text: renderEmailText(doc),
        html: renderEmailHtml(doc),
      });
      if (ok) result.sentSummaries += 1;
      else result.failed += 1;
    }
  }

  return result;
}

// ── Test emails, from the staff page ─────────────────────────────────────────
//
// Both versions, marked [Test], to one of Adam's test addresses only. Example
// names and office; nothing is recorded, so no real schedule is touched.

const TEST_NOTE =
  "This is a test from RealComply's staff page. Nothing has changed and no action is needed. " +
  "It shows what a real CPD reminder looks like and that it reaches you. The names and office are examples.";

export type CpdTestVersion = "person" | "summary";

export function cpdTestMessage(
  version: CpdTestVersion,
  cpdYearStart: string,
): { subject: string; doc: EmailDocument } {
  const office = "Made Up Realty (example)";
  const base =
    version === "person"
      ? { subject: personSubject(cpdYearStart), doc: personDocument({ full_name: "Jo Bennett", email: "" }, cpdYearStart) }
      : {
          subject: summarySubject(office, cpdYearStart),
          doc: summaryDocument(
            office,
            [
              { full_name: "Jo Bennett", email: "" },
              { full_name: "Sam Lee", email: "" },
            ],
            cpdYearStart,
          ),
        };
  return {
    subject: `[Test] ${base.subject}`,
    doc: {
      ...base.doc,
      preheader: `Test only. ${base.doc.preheader}`,
      sections: [{ kind: "note", text: TEST_NOTE }, ...base.doc.sections],
    },
  };
}
