import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import {
  renderEmailHtml,
  renderEmailText,
  type EmailDocument,
} from "./layout";
import {
  credentialLabel,
  daysUntil,
  dueThreshold,
  expiryPhrase,
  type ReminderThreshold,
} from "@/lib/licence-reminders";
import type { Agency, LicenceReminder, Profile } from "@/lib/types";

// Licence / certificate expiry reminders — the daily job.
//
// Runs every morning, works out which credentials have crossed a reminder
// threshold overnight, mails the holder and the licensee in charge, and
// records what it sent so it never sends the same reminder twice. The
// "never twice" guarantee lives in the database, not here: a unique index on
// (agency, subject, expiry_date, threshold) in 0019_licence_reminders.sql
// means a duplicate insert fails rather than duplicating the email. This code
// checks first and inserts second, so the index is a backstop against two
// overlapping runs, not the primary path.
//
// Order matters: the row is written BEFORE the emails go out. A reminder that
// silently sends twice because the insert failed after a successful send is
// worse than one that occasionally fails to send — the second is visible in
// the register ("last reminded" stays blank) and picked up by a human, the
// first just trains people to ignore the emails.

export type Subject = {
  kind: "profile" | "corporation";
  profileId: string | null;
  // Who the credential belongs to, as it should read in an email.
  holderName: string;
  holderEmail: string | null;
  credential: string;
  licenceNumber: string | null;
  expiry: string;
};

const REGISTERS_URL = "https://www.realcomply.com.au/dashboard/registers";

const LICENCE_FOOTER = [
  "RealComply sends reminders. Renewals are made by the holder with NSW Fair Trading. RealComply " +
    "doesn't lodge them for you, and the licensee in charge remains responsible for making sure " +
    "everyone in the office is properly licensed.",
  `<a href="${REGISTERS_URL}" style="color:#8a9a93">See the register any time</a>`,
];

function subjectsForAgency(agency: Agency, profiles: Profile[]): Subject[] {
  const subjects: Subject[] = [];

  for (const p of profiles) {
    if (!p.licence_expiry) continue;
    subjects.push({
      kind: "profile",
      profileId: p.id,
      holderName: p.full_name ?? p.email,
      holderEmail: p.email,
      credential: credentialLabel(p.licence_type),
      licenceNumber: p.licence_number,
      expiry: p.licence_expiry,
    });
  }

  // The agency's own corporation licence. Nobody "holds" it personally, so
  // there is no holder to mail — it goes to the licensee in charge only.
  if (agency.corporation_licence_expiry) {
    subjects.push({
      kind: "corporation",
      profileId: null,
      holderName: agency.corporation_licence_holder ?? agency.name,
      holderEmail: null,
      credential: "corporation licence",
      licenceNumber: agency.corporation_licence_number,
      expiry: agency.corporation_licence_expiry,
    });
  }

  return subjects;
}

export function holderDocument(subject: Subject, days: number): EmailDocument {
  const expired = days < 0;

  // Fourteen days joined the schedule in Oct 2026, and "no rush today" is not
  // true a fortnight out, so the closer wording now starts at 14.
  const advice = expired
    ? "Trading on an expired credential isn't something to leave sitting. Renew with NSW Fair Trading, then upload the renewed licence to the register."
    : days <= 14
      ? "This one's close. If the renewal is already in with NSW Fair Trading, upload the renewed licence to the register once it comes through. RealComply reads the new date and these reminders stop."
      : "No rush today, but it's worth starting. Renewals can take a few weeks, and a certificate of registration can't simply be renewed a second time, so if you're due to move up to a Class 2 licence you'll want the lead time.";

  return {
    preheader: expired
      ? `Your ${subject.credential} expired on ${subject.expiry}.`
      : `Expires ${expiryPhrase(days)}, on ${subject.expiry}.`,
    title: `Hi ${subject.holderName.split(" ")[0]},`,
    sections: [
      {
        kind: "rows",
        rows: [
          {
            title: subject.credential,
            sub: subject.licenceNumber ? `No. ${subject.licenceNumber} · ${subject.expiry}` : subject.expiry,
            detail: expired
              ? `Expired ${expiryPhrase(days)}.`
              : `Expires ${expiryPhrase(days)}.`,
            tone: expired ? "risk" : "attention",
          },
        ],
      },
      { kind: "paragraph", text: advice },
      { kind: "note", text: "Your licensee in charge has been sent a copy of this." },
      { kind: "button", label: "Open the register", href: REGISTERS_URL },
    ],
    footer: LICENCE_FOOTER,
  };
}

export function licenseeDocument(subject: Subject, days: number, agency: Agency): EmailDocument {
  const expired = days < 0;
  const who =
    subject.kind === "corporation"
      ? `${agency.name}'s corporation licence`
      : `${subject.holderName}'s ${subject.credential}`;

  const advice =
    subject.kind === "corporation"
      ? expired
        ? "The agency can't trade on an expired corporation licence. This one is yours to deal with directly with NSW Fair Trading."
        : "The corporation licence is the agency's own, separate from anyone's personal licence. Worth putting the renewal in early."
      : expired
        ? "Supervising someone whose credential has lapsed is your exposure, not just theirs. They've had the same notice."
        : "They've had the same notice. Nothing needed from you unless the date passes without a renewed licence being uploaded.";

  return {
    preheader: expired ? `${who} has expired.` : `${who} expires on ${subject.expiry}.`,
    title: expired ? "A credential has expired" : "A credential is expiring",
    meta: agency.name,
    sections: [
      {
        kind: "rows",
        rows: [
          {
            title: who,
            sub: subject.licenceNumber ? `No. ${subject.licenceNumber} · ${subject.expiry}` : subject.expiry,
            detail: expired ? `Expired ${expiryPhrase(days)}.` : `Expires ${expiryPhrase(days)}.`,
            tone: expired ? "risk" : "attention",
          },
        ],
      },
      { kind: "paragraph", text: advice },
      { kind: "button", label: "Open the register", href: REGISTERS_URL },
    ],
    footer: LICENCE_FOOTER,
  };
}

function subjectLine(subject: Subject, days: number, forHolder: boolean): string {
  const what = forHolder ? `Your ${subject.credential}` : subject.kind === "corporation" ? "Corporation licence" : `${subject.holderName}'s ${subject.credential}`;
  if (days < 0) return `${what} has expired`;
  if (days === 0) return `${what} expires today`;
  return `${what} expires ${expiryPhrase(days)}`;
}

/** Swappable for tests. Production passes nothing and gets the real thing. */
export type LicenceReminderDeps = {
  supabase?: ReturnType<typeof createServiceClient>;
  send?: typeof sendEmail;
};

// Every run reads the CURRENT expiry date off the profile or agency row. A
// renewal that saves a later date therefore stops the old schedule the next
// morning with nothing else to do: the old date is never looked at again, and
// the dedupe key (which includes the expiry date) has no rows for the new one,
// so its 90-day reminder fires when the time comes.
export async function runLicenceReminders(
  today: Date = new Date(),
  deps: LicenceReminderDeps = {},
): Promise<{ checked: number; sent: number; alreadySent: number; failed: number }> {
  const supabase = deps.supabase ?? createServiceClient();
  const send = deps.send ?? sendEmail;
  let checked = 0;
  let sent = 0;
  let alreadySent = 0;
  let failed = 0;

  const { data: agencies } = await supabase.from("agencies").select("*");

  // An agency whose subscription has ended is on its records page and will
  // be deleted at day 14. Nothing more about its licences.
  for (const agency of ((agencies ?? []) as Agency[]).filter((a) => !a.ended_at)) {
    const { data: profileRows } = await supabase.from("profiles").select("*").eq("agency_id", agency.id);
    // Only the people in the office today. Someone archived (0035) has left:
    // their licence is no longer the agency's to watch, and a former licensee
    // in charge is no longer the person to tell.
    const profiles = ((profileRows ?? []) as Profile[]).filter((p) => !p.archived_at);
    const licensees = profiles.filter((p) => p.is_licensee_in_charge);

    const subjects = subjectsForAgency(agency, profiles);
    if (subjects.length === 0) continue;

    const { data: reminderRows } = await supabase
      .from("licence_reminders")
      .select("*")
      .eq("agency_id", agency.id);
    const alreadyKeys = new Set(
      ((reminderRows ?? []) as LicenceReminder[]).map(
        (r) => `${r.subject_kind}:${r.profile_id ?? "-"}:${r.expiry_date}:${r.threshold_days}`,
      ),
    );

    for (const subject of subjects) {
      checked += 1;
      const threshold = dueThreshold(subject.expiry, today);
      if (threshold === null) continue;

      const key = `${subject.kind}:${subject.profileId ?? "-"}:${subject.expiry}:${threshold}`;
      if (alreadyKeys.has(key)) {
        alreadySent += 1;
        continue;
      }

      const days = daysUntil(subject.expiry, today);

      // Who gets told. The holder, plus every licensee in charge — except
      // where the holder IS the licensee, who gets one email in their own
      // voice rather than the same news twice from two angles. Same rule the
      // Monday digest already follows for sole principals.
      const recipients: string[] = [];
      if (subject.holderEmail) recipients.push(subject.holderEmail);
      for (const l of licensees) {
        if (!recipients.includes(l.email)) recipients.push(l.email);
      }
      if (recipients.length === 0) continue;

      // Record first, send second — see the note at the top of this file.
      const { error: insertError } = await supabase.from("licence_reminders").insert({
        agency_id: agency.id,
        subject_kind: subject.kind,
        profile_id: subject.profileId,
        expiry_date: subject.expiry,
        threshold_days: threshold as ReminderThreshold,
        recipients,
      });
      if (insertError) {
        // Either a concurrent run got there first (the unique index doing its
        // job) or the write genuinely failed. Either way, don't send.
        alreadySent += 1;
        continue;
      }

      let anyFailed = false;
      for (const to of recipients) {
        const isHolder = to === subject.holderEmail;
        const doc = isHolder
          ? holderDocument(subject, days)
          : licenseeDocument(subject, days, agency);
        const ok = await send({
          to,
          subject: subjectLine(subject, days, isHolder),
          text: renderEmailText(doc),
          html: renderEmailHtml(doc),
        });
        if (!ok) anyFailed = true;
      }
      if (anyFailed) failed += 1;
      else sent += 1;
    }
  }

  return { checked, sent, alreadySent, failed };
}

// ── A test reminder, sent on request from the register ──────────────────────
//
// The same two emails the daily job sends, each clearly labelled as a test,
// to one chosen team member (the holder's version) and to the licensee who
// asked (the licensee's version). Writes nothing to licence_reminders, so the
// real schedule is exactly as it was. Uses the member's real expiry date when
// there is one, otherwise an example date 30 days out, and says so.
const TEST_NOTE =
  "This is a test from RealComply's licence register, sent because the licensee in charge asked for one. " +
  "Nothing has changed and no action is needed. It shows what a real reminder looks like and that it reaches you.";

export async function sendLicenceReminderTest(
  params: { member: Profile; licensee: Profile; agency: Agency; today?: Date },
  send: typeof sendEmail = sendEmail,
): Promise<{ sentTo: string[]; failedTo: string[] }> {
  const { member, licensee, agency } = params;
  const today = params.today ?? new Date();

  const example = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 30))
    .toISOString()
    .slice(0, 10);
  const expiry = member.licence_expiry ?? example;
  const subject: Subject = {
    kind: "profile",
    profileId: member.id,
    holderName: member.full_name ?? member.email,
    holderEmail: member.email,
    credential: credentialLabel(member.licence_type),
    licenceNumber: member.licence_number,
    expiry,
  };
  const days = daysUntil(expiry, today);
  const exampleNote = member.licence_expiry
    ? null
    : "There's no expiry date on file for this person yet, so this test uses an example date.";

  const label = (doc: EmailDocument): EmailDocument => ({
    ...doc,
    preheader: `Test only. ${doc.preheader ?? ""}`.trim(),
    sections: [
      { kind: "note", text: TEST_NOTE },
      ...(exampleNote ? [{ kind: "note" as const, text: exampleNote }] : []),
      ...doc.sections,
    ],
  });

  const messages: { to: string; subject: string; doc: EmailDocument }[] = [];
  if (member.email) {
    messages.push({ to: member.email, subject: `[Test] ${subjectLine(subject, days, true)}`, doc: label(holderDocument(subject, days)) });
  }
  if (licensee.email && licensee.email !== member.email) {
    messages.push({
      to: licensee.email,
      subject: `[Test] ${subjectLine(subject, days, false)}`,
      doc: label(licenseeDocument(subject, days, agency)),
    });
  }

  const sentTo: string[] = [];
  const failedTo: string[] = [];
  for (const m of messages) {
    const ok = await send({ to: m.to, subject: m.subject, text: renderEmailText(m.doc), html: renderEmailHtml(m.doc) });
    (ok ? sentTo : failedTo).push(m.to);
  }
  return { sentTo, failedTo };
}
