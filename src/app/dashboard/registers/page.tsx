import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { RegistersTabs } from "@/components/registers/RegistersTabs";
import { LicencePanel } from "@/components/registers/LicencePanel";
import { InsurancePanel } from "@/components/registers/InsurancePanel";
import { GiftsPanel } from "@/components/registers/GiftsPanel";
import { ComplaintsPanel } from "@/components/registers/ComplaintsPanel";
import { BreachesPanel } from "@/components/registers/BreachesPanel";
import { TrustAccountPanel } from "@/components/registers/TrustAccountPanel";
import { formatAuDate } from "@/lib/format-date";
import { currentCpdYear } from "@/lib/cpd-year";
import { expiryStatus } from "@/lib/expiry-status";
import { nextReminderDate } from "@/lib/licence-reminders";
import type { ReminderInfo } from "@/components/registers/ReminderLine";
import {
  auditDueOn,
  auditPeriodEndFor,
  buildMonths,
  daysUntil,
  previousAuditPeriodEnd,
  type ReconciliationRecord,
} from "@/lib/trust-account";
import type {
  Agency, Breach, Complaint, CpdRecord, Gift, LicenceReminder, Profile, Property,
  SignoffDocument, SignoffSignature, TrustAudit,
} from "@/lib/types";

const TAB_KEYS = new Set(["licence", "insurance", "gifts", "complaints", "breaches", "trust"]);

// Registers — RealComply-website-IA.md's "Registers" screen, all three tabs
// from the mockup: licence register (+ PI insurance + CPD), gift register
// (threshold-flagged), complaints register (cross-linked to files).
//
// ?tab= and ?add= let a link elsewhere in the app open straight onto a
// specific tab, ready to use — added for the Home page's "+ Log a gift"
// shortcut so an ordinary agent can get from Home to a filled-in gift
// register entry in one click, instead of landing on Licence register (the
// default) and having to find + open the Gift register tab themselves.
export default async function RegistersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; add?: string }>;
}) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { tab, add } = await searchParams;
  const defaultTab = (tab && TAB_KEYS.has(tab) ? tab : "licence") as
    | "licence" | "insurance" | "gifts" | "complaints" | "breaches" | "trust";

  const cpdYear = currentCpdYear();

  const [
    { data: staffRows },
    { data: agencyRow },
    { data: cpdRows },
    { data: giftRows },
    { data: complaintRows },
    { data: propertyRows },
    { data: breachRows },
    { data: reminderRows },
    { data: trustDocRows },
    { data: trustSigRows },
    { data: trustAuditRows },
  ] = await Promise.all([
    supabase.from("profiles").select("*").order("full_name", { ascending: true }),
    supabase.from("agencies").select("*").eq("id", profile.agency_id).maybeSingle(),
    supabase.from("cpd_records").select("*").gte("completed_date", cpdYear.start).lte("completed_date", cpdYear.end),
    supabase.from("gifts").select("*").order("gift_date", { ascending: false }),
    supabase.from("complaints").select("*").order("received_date", { ascending: false }),
    supabase.from("properties").select("*").order("address", { ascending: true }),
    supabase.from("breaches").select("*").order("identified_date", { ascending: false }),
    // Most-recent-first so the register can show each person's last reminder
    // without sorting per card. Read-only (0019_licence_reminders.sql grants
    // select and nothing else) — these are written by the daily cron.
    supabase.from("licence_reminders").select("*").order("sent_at", { ascending: false }),
    // Trust account. The reconciliations are ordinary sign-off documents —
    // 0031 only added the machine-readable month, which is what lets the
    // calendar say which ones are missing.
    supabase
      .from("signoff_documents")
      .select("*")
      .eq("category", "trust_reconciliation")
      .order("created_at", { ascending: false }),
    supabase.from("signoff_signatures").select("*"),
    supabase.from("trust_audits").select("*"),
  ]);

  const staff = (staffRows ?? []) as Profile[];
  const agency = agencyRow as Agency | null;
  const gifts = (giftRows ?? []) as Gift[];
  const complaints = (complaintRows ?? []) as Complaint[];
  const properties = (propertyRows ?? []) as Property[];
  const breaches = (breachRows ?? []) as Breach[];

  // Latest reminder per person (and one for the corporation licence, keyed
  // separately since it has no profile behind it). The query is already
  // sorted newest-first, so the first hit for a key is the latest.
  //
  // The "next reminder" date is computed HERE, in the server component,
  // rather than inside the cards. The cards are client components, and
  // anything derived from today's date that gets rendered on the server and
  // then re-rendered in the browser will mismatch on hydration if the two
  // sides land either side of midnight UTC. Passing a finished string down
  // removes the possibility entirely.
  const lastReminderByProfile: Record<string, LicenceReminder> = {};
  let lastCorporationReminder: LicenceReminder | null = null;
  for (const row of (reminderRows ?? []) as LicenceReminder[]) {
    if (row.subject_kind === "corporation") {
      lastCorporationReminder ??= row;
    } else if (row.profile_id) {
      lastReminderByProfile[row.profile_id] ??= row;
    }
  }

  const reminderInfoByProfile: Record<string, ReminderInfo> = {};
  for (const s of staff) {
    reminderInfoByProfile[s.id] = {
      next: s.licence_expiry ? nextReminderDate(s.licence_expiry) : null,
      last: lastReminderByProfile[s.id]?.sent_at ?? null,
    };
  }
  const corporationReminderInfo: ReminderInfo = {
    next: agency?.corporation_licence_expiry ? nextReminderDate(agency.corporation_licence_expiry) : null,
    last: lastCorporationReminder?.sent_at ?? null,
  };

  const cpdByProfile: Record<string, CpdRecord[]> = {};
  for (const row of (cpdRows ?? []) as CpdRecord[]) {
    (cpdByProfile[row.profile_id] ??= []).push(row);
  }

  // ── Trust account ──────────────────────────────────────────────────────
  // "Today" is read once here, in the server component, and everything derived
  // from it is passed down as a finished value — the same reason the licence
  // reminder dates are computed here. A client component recomputing a
  // deadline would mismatch on hydration either side of midnight UTC.
  const today = new Date();
  const trustDocs = (trustDocRows ?? []) as SignoffDocument[];
  const trustSigs = (trustSigRows ?? []) as SignoffSignature[];
  const audits = (trustAuditRows ?? []) as TrustAudit[];
  const nameOf = (id: string | null) => (id ? staff.find((p) => p.id === id)?.full_name ?? null : null);

  const reconciliationsByMonth = new Map<string, ReconciliationRecord>();
  for (const doc of trustDocs) {
    if (!doc.period_month) continue;
    // Newest first from the query, so the first row for a month wins. Someone
    // re-uploading a corrected reconciliation should not be represented by the
    // superseded one.
    if (reconciliationsByMonth.has(doc.period_month)) continue;
    const signed = trustSigs.find((sig) => sig.document_id === doc.id && sig.signed_at);
    reconciliationsByMonth.set(doc.period_month, {
      documentId: doc.id,
      month: doc.period_month,
      fileName: doc.file_name,
      uploadedByName: nameOf(doc.uploaded_by),
      signedAt: signed?.signed_at ?? null,
    });
  }

  const currentAuditPeriod = auditPeriodEndFor(today);
  const trustMonths = buildMonths(currentAuditPeriod, reconciliationsByMonth, today);
  // The period being audited NOW is the one that has just ended, not the one
  // currently running — you cannot audit a year still in progress.
  const auditPeriod = previousAuditPeriodEnd(today);
  const audit = audits.find((a) => a.period_end === auditPeriod) ?? null;
  const auditDue = auditDueOn(auditPeriod);
  // Overdue is red: the 21 days are gone, or the audit is past 30 September.
  // Waiting on a signature inside the window is amber.
  const trustOverdue =
    trustMonths.filter((m) => m.status === "overdue").length +
    (!audit?.confirmed_at && daysUntil(auditDue, today) < 0 ? 1 : 0);
  const trustPending =
    trustMonths.filter((m) => m.status === "awaiting_signature" || m.status === "awaiting_upload").length +
    (!audit?.confirmed_at && daysUntil(auditDue, today) >= 0 ? 1 : 0);
  const trustBadge = {
    count: trustOverdue + trustPending,
    tone: (trustOverdue > 0 ? "red" : "amber") as "amber" | "red",
  };

  // Each tab badge now carries a severity as well as a count (Adam, 25 Aug
  // 2026). The rule is the same one the sidebar uses: amber means somebody
  // needs to look at this, red means something has actually lapsed, been
  // missed, or is legally overdue. Before this, every badge on the strip was
  // red — an open complaint shouted as loudly as an expired licence, which is
  // the fastest way to teach someone to ignore all of them.
  const giftsBadge = { count: gifts.filter((g) => g.status === "flagged").length, tone: "amber" as const };
  const complaintsBadge = {
    count: complaints.filter((c) => c.status !== "resolved").length,
    tone: "amber" as const,
  };
  // Anything still open, plus any notifiable breach not yet notified — the
  // latter carries a statutory deadline (s89: 5 days), so it earns a badge
  // even once the breach itself has a corrective action recorded.
  // A notifiable breach that has not been notified is the red one: s89 gives
  // 5 days and the clock is running. An open breach with its notification done
  // is work in progress, which is amber.
  const breachesUnnotified = breaches.filter((b) => b.notifiable && !b.notified_date).length;
  const breachesBadge = {
    count: breaches.filter((b) => b.status !== "closed" || (b.notifiable && !b.notified_date)).length,
    tone: (breachesUnnotified > 0 ? "red" : "amber") as "amber" | "red",
  };
  const insuranceStatuses = agency
    ? [agency.pi_expiry, agency.cyber_expiry, agency.icare_expiry].map((d) => expiryStatus(d))
    : [];
  const insuranceBadge = {
    count: insuranceStatuses.filter((st) => st === "expired" || st === "urgent").length,
    tone: (insuranceStatuses.some((st) => st === "expired") ? "red" : "amber") as "amber" | "red",
  };

  // Licences and certificates had no badge at all, which was the odd one out —
  // the register that carries the hardest deadline in the office was the only
  // tab that said nothing.
  const licenceStatuses = staff.map((p) => expiryStatus(p.licence_expiry));
  if (agency?.corporation_licence_expiry) {
    licenceStatuses.push(expiryStatus(agency.corporation_licence_expiry));
  }
  const licenceBadge = {
    count: licenceStatuses.filter((st) => st === "expired" || st === "urgent").length,
    tone: (licenceStatuses.some((st) => st === "expired") ? "red" : "amber") as "amber" | "red",
  };

  return (
    <>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Registers</h1>
            <p className="mt-1 text-sm text-rc-muted">
              Agency-level records the licensee must keep — {cpdYear.label} CPD year.
            </p>
          </div>
          <div className="flex gap-4 text-sm font-medium">
            <Link href="/dashboard/registers/export" className="text-rc-muted transition hover:text-rc-green-deep">
              Export register
            </Link>
            <Link href="/dashboard/training" className="text-rc-muted transition hover:text-rc-green-deep">
              Training log →
            </Link>
            <Link href="/dashboard/document-signoffs" className="text-rc-muted transition hover:text-rc-green-deep">
              Document sign-offs →
            </Link>
          </div>
        </div>

        {agency && (
          <div className="mt-6">
            <RegistersTabs
              licenceBadge={licenceBadge}
              insuranceBadge={insuranceBadge}
              giftsBadge={giftsBadge}
              complaintsBadge={complaintsBadge}
              breachesBadge={breachesBadge}
              trustBadge={trustBadge}
              defaultTab={defaultTab}
              licence={
                <LicencePanel
                  staff={staff}
                  cpdByProfile={cpdByProfile}
                  viewerProfile={profile}
                  cpdYearLabel={cpdYear.label}
                  agency={agency}
                  reminderInfoByProfile={reminderInfoByProfile}
                  corporationReminderInfo={corporationReminderInfo}
                />
              }
              insurance={<InsurancePanel agency={agency} viewerProfile={profile} />}
              gifts={
                <GiftsPanel
                  gifts={gifts}
                  staff={staff}
                  threshold={agency.gift_threshold}
                  viewerProfile={profile}
                  autoOpenAdd={add === "1"}
                />
              }
              complaints={
                <ComplaintsPanel
                  complaints={complaints}
                  staff={staff}
                  properties={properties}
                  viewerProfile={profile}
                  resolutionTargetDays={agency.complaint_resolution_target_days}
                />
              }
              breaches={
                <BreachesPanel
                  breaches={breaches}
                  staff={staff}
                  properties={properties}
                  viewerProfile={profile}
                />
              }
              trust={
                <TrustAccountPanel
                  months={trustMonths}
                  agencyId={profile.agency_id}
                  // Uploading is clerical, so the assistant can do it. Signing
                  // is the licensee's and stays theirs — the server enforces
                  // both, these only decide what is worth rendering.
                  canUpload={Boolean(profile.is_licensee_in_charge || profile.is_assistant)}
                  canSign={Boolean(profile.is_licensee_in_charge)}
                  signerName={profile.full_name ?? ""}
                  auditPeriodEnd={auditPeriod}
                  auditDueOn={auditDue}
                  auditDaysToDue={daysUntil(auditDue, today)}
                  audit={audit}
                  auditConfirmedByName={nameOf(audit?.confirmed_by ?? null)}
                  auditYearLabel={`Year ending ${formatAuDate(currentAuditPeriod)}`}
                />
              }
            />
          </div>
        )}
      </main>
    </>
  );
}
