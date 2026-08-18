import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { RegistersTabs } from "@/components/registers/RegistersTabs";
import { LicencePanel } from "@/components/registers/LicencePanel";
import { InsurancePanel } from "@/components/registers/InsurancePanel";
import { GiftsPanel } from "@/components/registers/GiftsPanel";
import { ComplaintsPanel } from "@/components/registers/ComplaintsPanel";
import { BreachesPanel } from "@/components/registers/BreachesPanel";
import { currentCpdYear } from "@/lib/cpd-year";
import { expiryStatus } from "@/lib/expiry-status";
import { nextReminderDate } from "@/lib/licence-reminders";
import type { ReminderInfo } from "@/components/registers/ReminderLine";
import type { Agency, Breach, Complaint, CpdRecord, Gift, LicenceReminder, Profile, Property } from "@/lib/types";

const TAB_KEYS = new Set(["licence", "insurance", "gifts", "complaints", "breaches"]);

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
  const defaultTab = (tab && TAB_KEYS.has(tab) ? tab : "licence") as "licence" | "insurance" | "gifts" | "complaints" | "breaches";

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

  const giftsBadge = gifts.filter((g) => g.status === "flagged").length;
  const complaintsBadge = complaints.filter((c) => c.status !== "resolved").length;
  // Anything still open, plus any notifiable breach not yet notified — the
  // latter carries a statutory deadline (s89: 5 days), so it earns a badge
  // even once the breach itself has a corrective action recorded.
  const breachesBadge =
    breaches.filter((b) => b.status !== "closed" || (b.notifiable && !b.notified_date)).length;
  const insuranceBadge = agency
    ? [agency.pi_expiry, agency.cyber_expiry, agency.icare_expiry].filter((d) => {
        const s = expiryStatus(d);
        return s === "expired" || s === "urgent";
      }).length
    : 0;

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
              insuranceBadge={insuranceBadge}
              giftsBadge={giftsBadge}
              complaintsBadge={complaintsBadge}
              breachesBadge={breachesBadge}
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
            />
          </div>
        )}
      </main>
    </>
  );
}
