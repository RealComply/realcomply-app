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

type Subject = {
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
  "RealComply provides diligence support to help you stay on top of compliance. Renewals are made " +
    "with NSW Fair Trading. RealComply doesn't lodge them for you, and the licensee in charge " +
    "remains responsible for making sure everyone in the office is properly licensed.",
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

function holderDocument(subject: Subject, days: number): EmailDocument {
  const expired = days < 0;

  const advice = expired
    ? "Trading on an expired credential isn't something to leave sitting. Renew with NSW Fair Trading, then update the date in the register so your office can see it's sorted."
    : days <= 7
      ? "This one's close. If the renewal is already in with NSW Fair Trading, update the date in the register once it comes through and these reminders stop."
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

function licenseeDocument(subject: Subject, days: number, agency: Agency): EmailDocument {
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
        : "They've had the same notice. Nothing needed from you unless the date passes without the register being updated.";

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

export async function runLicenceReminders(
  today: Date = new Date(),
): Promise<{ checked: number; sent: number; alreadySent: number; failed: number }> {
  const supabase = createServiceClient();
  let checked = 0;
  let sent = 0;
  let alreadySent = 0;
  let failed = 0;

  const { data: agencies } = await supabase.from("agencies").select("*");

  for (const agency of (agencies ?? []) as Agency[]) {
    const { data: profileRows } = await supabase.from("profiles").select("*").eq("agency_id", agency.id);
    const profiles = (profileRows ?? []) as Profile[];
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
        const ok = await sendEmail({
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
