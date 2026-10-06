import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import { renderEmailHtml, renderEmailText, type EmailDocument } from "./layout";
import { formatAuDate } from "@/lib/format-date";
import { PM_COPY, pmManagementEndedLabel, pmRetentionUntil } from "@/lib/rules/nsw-pm";

// Property management: the 3-year file reminder (brief B4). The daily job.
//
// REVERSAL 2, 6 Oct 2026: "File kept 3 years" is a note and this one email,
// never a tick. PSA Act s104(2) asks for records to be kept at least 3 years.
// On the date, one email goes to the licensee in charge and the property
// manager:
//
//   "The 3-year period for this file has passed. Whether to keep or destroy
//    it is your decision."
//
// It must never say the file can or should be deleted. The words live in the
// rules file (PM_COPY.retentionEmail) with a test that holds them.
//
// "Done means quiet": every run reads the LIVE record. A move-out date
// corrected after the fact moves the reminder with it (the dedupe key holds
// the due date, so the new date gets its own reminder and the old one is
// never looked at again). Archived people are never mailed. An agency with PM
// switched off gets nothing, because nobody there can open the property.
//
// Record first, send second, the same as licence reminders: a unique index on
// (subject_kind, subject_id, due_date) in 0053 means a reminder is never sent
// twice, even by two overlapping runs. A failed send is visible (the row is
// there, the email is not) rather than silently repeated.

const PM_URL = "https://www.realcomply.com.au/dashboard/pm";

type Agency = { id: string; name: string; pm_enabled?: boolean };
type Person = { id: string; agency_id: string; email: string; full_name: string | null; is_licensee_in_charge: boolean; archived_at: string | null };
type Property = {
  id: string;
  agency_id: string;
  address: string;
  manager_id: string;
  management_ended_on: string | null;
  management_ended_reason: string | null;
};
type Tenancy = { id: string; agency_id: string; property_id: string; seq: number; move_out_date: string | null };

export type PmRetentionSubject = {
  kind: "tenancy" | "management";
  id: string;
  agencyId: string;
  property: Property;
  /** The date the 3 years ran from: the move-out date or the date the management ended. */
  from: string;
  due: string;
  seq?: number;
};

/** Today's date in Sydney, as YYYY-MM-DD. The job runs before the working day starts there. */
export function sydneyDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(now);
}

export function retentionDocument(subject: PmRetentionSubject, agencyName: string): EmailDocument {
  const what =
    subject.kind === "tenancy"
      ? `Tenant moved out ${formatAuDate(subject.from)}`
      : `Management ended ${formatAuDate(subject.from)}${
          subject.property.management_ended_reason
            ? `: ${pmManagementEndedLabel(subject.property.management_ended_reason)}`
            : ""
        }`;
  return {
    preheader: PM_COPY.retentionEmail,
    title: "A file has reached 3 years",
    meta: agencyName,
    sections: [
      {
        kind: "rows",
        rows: [{ title: subject.property.address, sub: what, detail: `3 years on ${formatAuDate(subject.due)}.`, tone: "routine" }],
      },
      { kind: "paragraph", text: PM_COPY.retentionEmail, lead: true },
      { kind: "button", label: "Open property management", href: `${PM_URL}/${subject.property.id}` },
    ],
    footer: [
      "RealComply sends this reminder once, on the date. The licensee in charge and the property manager each get a copy.",
      `<a href="${PM_URL}" style="color:#8a9a93">Property management</a>`,
    ],
  };
}

export function retentionSubjectLine(subject: PmRetentionSubject): string {
  return `3 years have passed: ${subject.property.address}`;
}

/** Swappable for tests. Production passes nothing and gets the real thing. */
export type PmRetentionDeps = {
  supabase?: ReturnType<typeof createServiceClient>;
  send?: typeof sendEmail;
};

export async function runPmRetentionReminders(
  now: Date = new Date(),
  deps: PmRetentionDeps = {},
): Promise<{ checked: number; sent: number; alreadySent: number; failed: number }> {
  const supabase = deps.supabase ?? createServiceClient();
  const send = deps.send ?? sendEmail;
  const today = sydneyDate(now);
  let checked = 0;
  let sent = 0;
  let alreadySent = 0;
  let failed = 0;

  const { data: agencyRows } = await supabase.from("agencies").select("id, name, pm_enabled");
  for (const agency of (agencyRows ?? []) as Agency[]) {
    if (agency.pm_enabled !== true) continue;

    const [{ data: propertyRows }, { data: tenancyRows }, { data: peopleRows }, { data: sentRows }] = await Promise.all([
      supabase.from("pm_properties").select("*").eq("agency_id", agency.id),
      supabase.from("pm_tenancies").select("*").eq("agency_id", agency.id),
      supabase.from("profiles").select("*").eq("agency_id", agency.id),
      supabase.from("pm_retention_reminders").select("*").eq("agency_id", agency.id),
    ]);
    const properties = new Map(((propertyRows ?? []) as Property[]).map((p) => [p.id, p]));
    // Only the people in the office today (0035).
    const people = ((peopleRows ?? []) as Person[]).filter((p) => !p.archived_at);
    const licensees = people.filter((p) => p.is_licensee_in_charge);
    const already = new Set(
      ((sentRows ?? []) as { subject_kind: string; subject_id: string; due_date: string }[]).map(
        (r) => `${r.subject_kind}:${r.subject_id}:${r.due_date}`,
      ),
    );

    const subjects: PmRetentionSubject[] = [];
    for (const t of (tenancyRows ?? []) as Tenancy[]) {
      const property = properties.get(t.property_id);
      if (!property || !t.move_out_date) continue;
      subjects.push({ kind: "tenancy", id: t.id, agencyId: agency.id, property, from: t.move_out_date, due: pmRetentionUntil(t.move_out_date), seq: t.seq });
    }
    for (const p of properties.values()) {
      if (!p.management_ended_on) continue;
      subjects.push({ kind: "management", id: p.id, agencyId: agency.id, property: p, from: p.management_ended_on, due: pmRetentionUntil(p.management_ended_on) });
    }

    for (const subject of subjects) {
      checked += 1;
      if (subject.due > today) continue;
      const key = `${subject.kind}:${subject.id}:${subject.due}`;
      if (already.has(key)) {
        alreadySent += 1;
        continue;
      }

      const recipients: string[] = [];
      for (const l of licensees) if (!recipients.includes(l.email)) recipients.push(l.email);
      const manager = people.find((p) => p.id === subject.property.manager_id);
      if (manager && !recipients.includes(manager.email)) recipients.push(manager.email);
      if (recipients.length === 0) continue;

      // Record first, send second (see the note at the top).
      const { error: insertError } = await supabase.from("pm_retention_reminders").insert({
        agency_id: agency.id,
        subject_kind: subject.kind,
        subject_id: subject.id,
        due_date: subject.due,
        recipients,
      });
      if (insertError) {
        alreadySent += 1;
        continue;
      }

      const doc = retentionDocument(subject, agency.name);
      let anyFailed = false;
      for (const to of recipients) {
        const ok = await send({ to, subject: retentionSubjectLine(subject), text: renderEmailText(doc), html: renderEmailHtml(doc) });
        if (!ok) anyFailed = true;
      }
      if (anyFailed) failed += 1;
      else sent += 1;
    }
  }

  return { checked, sent, alreadySent, failed };
}
