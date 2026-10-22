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
import { accessFrom } from "@/lib/access";
import { POLICIES, otherInsuranceTitle } from "@/lib/insurance-read";
import type { Agency, InsurancePolicy, InsurancePolicyType, LicenceReminder, Profile } from "@/lib/types";

// Expiry reminders: the daily job. Every item in RealComply with an expiry
// date (a person's licence, the corporation licence, and since 23 Oct 2026
// the office's insurance) runs through here, on the one schedule in
// lib/licence-reminders.ts. Still named for licences because it started
// there, and the cron path, the monitor and the table are named the same.
//
// Runs every morning, works out which items have crossed a reminder
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

const REGISTERS_URL = "https://www.realcomply.com.au/dashboard/registers";
// Where the holder uploads the renewed licence: their own card on the
// Licences tab, which an agent or assistant has again since 10 Oct 2026.
// While the tab was hidden from them this button landed them on the Gift
// register. Named outright rather than left to the page's default tab.
export const HOLDER_LICENCE_URL = `${REGISTERS_URL}?tab=licence`;
// Where the licensee uploads a renewed certificate of currency.
export const INSURANCE_REGISTER_URL = `${REGISTERS_URL}?tab=insurance`;

const LICENCE_FOOTER = [
  "RealComply sends reminders. Renewals are made by the holder with NSW Fair Trading. RealComply " +
    "doesn't lodge them for you, and the licensee in charge remains responsible for making sure " +
    "everyone in the office is properly licensed.",
  { text: "See the register any time", href: REGISTERS_URL },
];

const INSURANCE_FOOTER = [
  "RealComply sends reminders. Renewing is between the office and its insurer or broker. RealComply " +
    "doesn't arrange insurance, and the licensee in charge remains responsible for the office's cover.",
  { text: "See the Insurance register any time", href: INSURANCE_REGISTER_URL },
];

// What an expiring item is about. "licence" items go to the holder and the
// licensee (or the licensee alone for the corporation licence, which nobody
// holds personally). "insurance" items are the office's, so they go to the
// licensee only, like the Insurance register itself.
export type ExpiryFamily = "licence" | "insurance";

// The subject_kind written to licence_reminders. 0088 lets any short
// lower-case key in, so a new kind needs no database change.
export type SubjectKind =
  | "profile"
  | "corporation"
  | "insurance_pi"
  | "insurance_cyber"
  | "insurance_icare"
  | "insurance_policy";

export type Subject = {
  kind: SubjectKind;
  family: ExpiryFamily;
  profileId: string | null;
  // Which row, when an office can have more than one of this kind and it is
  // not a person (an added insurance policy). Null otherwise.
  subjectId: string | null;
  // Who the item belongs to, as it should read in an email.
  holderName: string;
  holderEmail: string | null;
  // What it is: "Class 2 licence", "Professional indemnity insurance".
  credential: string;
  // Licence or policy number.
  licenceNumber: string | null;
  // The insurer, for insurance. Null for licences.
  issuer: string | null;
  expiry: string;
};

/**
 * Everything with an expiry date that the job reminds about. To add a new
 * kind of expiring item (a new table, a new column): add one entry here that
 * turns an office into its subjects, and add its kind to SubjectKind. The
 * schedule, the "never twice" record, renewal and recipients all come free.
 * If it is neither a licence nor insurance, give it a family and its own
 * email wording below.
 */
export type ExpiryContext = {
  supabase: ReturnType<typeof createServiceClient>;
  agency: Agency;
  /** The people in the office today (archived people already left out). */
  profiles: Profile[];
};
export type ExpirySource = {
  kind: SubjectKind;
  subjects: (ctx: ExpiryContext) => Subject[] | Promise<Subject[]>;
};

const personLicences: ExpirySource = {
  kind: "profile",
  subjects: ({ profiles }) =>
    profiles
      .filter((p) => p.licence_expiry)
      .map((p) => ({
        kind: "profile",
        family: "licence",
        profileId: p.id,
        subjectId: null,
        holderName: p.full_name ?? p.email,
        holderEmail: p.email,
        credential: credentialLabel(p.licence_type),
        licenceNumber: p.licence_number,
        issuer: null,
        expiry: p.licence_expiry as string,
      })),
};

// The agency's own corporation licence. Nobody "holds" it personally, so
// there is no holder to mail: it goes to the licensee in charge only.
const corporationLicence: ExpirySource = {
  kind: "corporation",
  subjects: ({ agency }) =>
    agency.corporation_licence_expiry
      ? [
          {
            kind: "corporation",
            family: "licence",
            profileId: null,
            subjectId: null,
            holderName: agency.corporation_licence_holder ?? agency.name,
            holderEmail: null,
            credential: "corporation licence",
            licenceNumber: agency.corporation_licence_number,
            issuer: null,
            expiry: agency.corporation_licence_expiry,
          },
        ]
      : [],
};

// The three policies on the office row (0004, 0010, 0076). Their expiry is
// whatever the Insurance register holds, read off the uploaded certificate
// (lib/actions/insurance.ts) or typed, so a read needs nothing else to
// switch reminders on.
function fixedPolicy(policy: InsurancePolicyType): ExpirySource {
  const kind = `insurance_${policy}` as SubjectKind;
  return {
    kind,
    subjects: ({ agency }) => {
      const expiry = agency[`${policy}_expiry`];
      if (!expiry) return [];
      return [
        {
          kind,
          family: "insurance",
          profileId: null,
          subjectId: null,
          holderName: agency.name,
          holderEmail: null,
          credential: POLICIES[policy].title,
          licenceNumber: agency[`${policy}_policy_number`],
          issuer: agency[`${policy}_insurer`],
          expiry,
        },
      ];
    },
  };
}

// Every other policy the office added (insurance_policies, 0078), while it
// is on the register. A removed policy is no longer the office's to renew.
const addedPolicies: ExpirySource = {
  kind: "insurance_policy",
  subjects: async ({ supabase, agency }) => {
    const { data, error } = await supabase
      .from("insurance_policies")
      .select("*")
      .eq("agency_id", agency.id)
      .is("removed_at", null);
    if (error) console.error("insurance_policies not read for reminders:", error.message);
    return ((data ?? []) as InsurancePolicy[])
      .filter((p) => p.expiry && !p.removed_at)
      .map((p) => ({
        kind: "insurance_policy",
        family: "insurance",
        profileId: null,
        subjectId: p.id,
        holderName: agency.name,
        holderEmail: null,
        credential: otherInsuranceTitle(p.kind, p.name),
        licenceNumber: p.policy_number,
        issuer: p.insurer,
        expiry: p.expiry as string,
      }));
  },
};

export const EXPIRY_SOURCES: ExpirySource[] = [
  personLicences,
  corporationLicence,
  fixedPolicy("pi"),
  fixedPolicy("cyber"),
  fixedPolicy("icare"),
  addedPolicies,
];

/** The "never twice" key, the same shape as the unique index in 0088. */
function reminderKey(kind: string, subject: string | null, expiry: string, threshold: number): string {
  return `${kind}:${subject ?? "-"}:${expiry}:${threshold}`;
}

/**
 * `licenseeCopied` is whether someone other than the holder gets this one.
 * The note saying so is left out when nobody does (the holder IS the
 * licensee), rather than telling them a copy went to a licensee who never
 * got one (review of 10 Oct 2026).
 */
export function holderDocument(subject: Subject, days: number, licenseeCopied = true): EmailDocument {
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
      ...(licenseeCopied ? [{ kind: "note" as const, text: "Your licensee in charge has been sent a copy of this." }] : []),
      { kind: "button", label: "Open the register", href: HOLDER_LICENCE_URL },
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

export function insuranceDocument(subject: Subject, days: number, agency: Agency): EmailDocument {
  const expired = days < 0;
  const advice = expired
    ? "Check with your insurer or broker that the office is still covered. Once the renewed certificate of currency is uploaded to the Insurance register, RealComply reads the new date and these reminders stop."
    : days <= 14
      ? "This one's close. If it's already renewed, upload the new certificate of currency to the Insurance register. RealComply reads the new date and these reminders stop."
      : "Worth starting the renewal with your insurer or broker. When the new certificate of currency comes through, upload it to the Insurance register. RealComply reads the new date and these reminders stop.";
  const sub = [subject.issuer, subject.licenceNumber ? `No. ${subject.licenceNumber}` : null, subject.expiry]
    .filter(Boolean)
    .join(" · ");

  return {
    preheader: expired
      ? `${subject.credential} expired on ${subject.expiry}.`
      : `${subject.credential} expires on ${subject.expiry}.`,
    title: expired ? "An insurance policy has expired" : "An insurance policy is expiring",
    meta: agency.name,
    sections: [
      {
        kind: "rows",
        rows: [
          {
            title: subject.credential,
            sub,
            detail: expired ? `Expired ${expiryPhrase(days)}.` : `Expires ${expiryPhrase(days)}.`,
            tone: expired ? "risk" : "attention",
          },
        ],
      },
      { kind: "paragraph", text: advice },
      { kind: "button", label: "Open the Insurance register", href: INSURANCE_REGISTER_URL },
    ],
    footer: INSURANCE_FOOTER,
  };
}

function subjectLine(subject: Subject, days: number, forHolder: boolean): string {
  const what =
    subject.family === "insurance"
      ? subject.credential
      : forHolder
        ? `Your ${subject.credential}`
        : subject.kind === "corporation"
          ? "Corporation licence"
          : `${subject.holderName}'s ${subject.credential}`;
  if (days < 0) return `${what} has expired`;
  if (days === 0) return `${what} expires today`;
  return `${what} expires ${expiryPhrase(days)}`;
}

/** Swappable for tests. Production passes nothing and gets the real thing. */
export type LicenceReminderDeps = {
  supabase?: ReturnType<typeof createServiceClient>;
  send?: typeof sendEmail;
};

// Every run reads the CURRENT expiry date off the profile, agency or
// insurance policy row. A renewal (a new licence or certificate uploaded and
// read, or a date typed) that saves a later date therefore stops the old schedule the next
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
  // be deleted at day 14. Nothing more about its licences or insurance.
  for (const agency of ((agencies ?? []) as Agency[]).filter((a) => !a.ended_at)) {
    const { data: profileRows } = await supabase.from("profiles").select("*").eq("agency_id", agency.id);
    // Only the people in the office today. Someone archived (0035) has left:
    // their licence is no longer the agency's to watch, and a former licensee
    // in charge is no longer the person to tell.
    const profiles = ((profileRows ?? []) as Profile[]).filter((p) => !p.archived_at);
    // "The licensee" the way the app works it out (lib/access.ts): the
    // licensee in charge, or the agent on their own plan (review of 10 Oct
    // 2026). The agent on an agent plan who said at signup they are not the
    // licensee in charge keeps the corporation licence and gets the test
    // reminder, but the job looked only at the flag: nobody was told about
    // the corporation licence, and nobody about their assistant's certificate.
    const licensees = profiles.filter((p) => accessFrom(p, agency.plan).actsAsLicensee);

    const subjects: Subject[] = [];
    for (const source of EXPIRY_SOURCES) {
      subjects.push(...(await source.subjects({ supabase, agency, profiles })));
    }
    if (subjects.length === 0) continue;

    const { data: reminderRows } = await supabase
      .from("licence_reminders")
      .select("*")
      .eq("agency_id", agency.id);
    const alreadyKeys = new Set(
      ((reminderRows ?? []) as LicenceReminder[]).map(
        (r) => reminderKey(r.subject_kind, r.subject_id ?? r.profile_id, r.expiry_date, r.threshold_days),
      ),
    );

    for (const subject of subjects) {
      checked += 1;
      const threshold = dueThreshold(subject.expiry, today);
      if (threshold === null) continue;

      const key = reminderKey(subject.kind, subject.subjectId ?? subject.profileId, subject.expiry, threshold);
      if (alreadyKeys.has(key)) {
        alreadySent += 1;
        continue;
      }

      const days = daysUntil(subject.expiry, today);

      // Who gets told. The holder (licences only; insurance and the
      // corporation licence have none), plus every licensee (above), except
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
        // Only sent when there is one, so a person's licence reminder still
        // writes exactly what it did before 0088 (and still works if the
        // code goes live before 0088 is run).
        ...(subject.subjectId ? { subject_id: subject.subjectId } : {}),
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
      const licenseeCopied = recipients.some((to) => to !== subject.holderEmail);
      for (const to of recipients) {
        const isHolder = to === subject.holderEmail;
        const doc =
          subject.family === "insurance"
            ? insuranceDocument(subject, days, agency)
            : isHolder
              ? holderDocument(subject, days, licenseeCopied)
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
    family: "licence",
    profileId: member.id,
    subjectId: null,
    issuer: null,
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
  const licenseeCopied = Boolean(licensee.email && licensee.email !== member.email);
  if (member.email) {
    messages.push({
      to: member.email,
      subject: `[Test] ${subjectLine(subject, days, true)}`,
      doc: label(holderDocument(subject, days, licenseeCopied)),
    });
  }
  if (licenseeCopied) {
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
