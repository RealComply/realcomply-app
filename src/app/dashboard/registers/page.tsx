import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/data/current-profile";
import { agencyPeople } from "@/lib/data/people";
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
import type {
  Agency, Breach, Complaint, CpdRecord, Gift, LicenceReminder, Profile, Property,
} from "@/lib/types";

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
  const { profile, access } = await requireAccess();
  const supabase = await createClient();
  const { tab, add } = await searchParams;
  // REVERSAL (Adam, 7 and 9 Oct 2026). Was: every member saw every register.
  // Now an agent or assistant sees the gifts and breaches they logged
  // themselves, and nothing else here; complaints are the licensee in
  // charge's only, even for an agent on their own plan. The database rules
  // (0058) return only those rows; this decides which tabs show.
  //
  // Plus their OWN licence or certificate (10 Oct 2026). Hiding the whole
  // Licences tab took away the only place a person can upload their renewed
  // licence, while the reminder emails kept sending them here to do exactly
  // that, and the reminders never stopped. A person still maintains their own
  // licence (0058: own profile, own licence_history, own _licences folder).
  const licenseeView = access.actsAsLicensee;
  const defaultTab = (tab && TAB_KEYS.has(tab) ? tab : "licence") as
    | "licence" | "insurance" | "gifts" | "complaints" | "breaches";

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
    people,
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
    // Names only, for showing who an entry is about (lib/data/people.ts).
    agencyPeople(supabase),
  ]);

  // An agent logs a gift or breach against themselves, so their pickers show
  // only them, and the Licences tab holds only their own card.
  //
  // People who have left (archived in Team) are not on this register (check
  // of 10 Oct 2026). The reminder job already skips them, so their cards
  // promised a "Next reminder" that never came, and a former employee's
  // lapsed licence kept the tab and the sidebar red for good. Their entries
  // in the other registers still show their name, from the names list below.
  const staff = licenseeView
    ? ((staffRows ?? []) as Profile[]).filter((s) => !s.archived_at)
    : [profile];
  const nameOf: Record<string, string> = {};
  for (const p of people) if (p.full_name) nameOf[p.id] = p.full_name;
  for (const s of (staffRows ?? []) as Profile[]) nameOf[s.id] ??= s.full_name ?? s.email;
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
  // An agent's tab holds only their own card, so only their own date counts.
  const licenceStatuses = staff.map((p) => expiryStatus(p.licence_expiry));
  if (licenseeView && agency?.corporation_licence_expiry) {
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
              {licenseeView
                ? `Agency-level records the licensee must keep — ${cpdYear.label} CPD year.`
                : "Your own licence, and the gifts and breaches you have logged. The licensee sees the whole register."}
            </p>
          </div>
          <div className="flex gap-4 text-sm font-medium">
            {licenseeView && (
              <Link href="/dashboard/registers/export" className="text-rc-muted transition hover:text-rc-green-deep">
                Export register
              </Link>
            )}
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
                  nameOf={nameOf}
                />
              }
              insurance={licenseeView ? <InsurancePanel agency={agency} /> : null}
              gifts={
                <GiftsPanel
                  gifts={gifts}
                  staff={staff}
                  threshold={agency.gift_threshold}
                  viewerProfile={profile}
                  nameOf={nameOf}
                  autoOpenAdd={add === "1"}
                />
              }
              complaints={
                !access.officeLicensee ? null : <ComplaintsPanel
                  complaints={complaints}
                  staff={staff}
                  properties={properties}
                  viewerProfile={profile}
                  nameOf={nameOf}
                  resolutionTargetDays={agency.complaint_resolution_target_days}
                />
              }
              breaches={
                <BreachesPanel
                  breaches={breaches}
                  staff={staff}
                  properties={properties}
                  nameOf={nameOf}
                />
              }
            />
          </div>
        )}
      </main>
    </>
  );
}
