"use client";

import { StaffRegisterCard } from "@/components/registers/StaffRegisterCard";
import { CorporationLicenceCard } from "@/components/registers/CorporationLicenceCard";
import { expiryStatus } from "@/lib/expiry-status";
import { CPD_HOURS_REQUIRED_AGENT, CPD_UNITS_REQUIRED_ASSISTANT } from "@/lib/cpd-year";
import type { ReminderInfo } from "@/components/registers/ReminderLine";
import type { Agency, CpdRecord, Profile } from "@/lib/types";

// Insurance (PI/cyber/iCare) lives in its own Insurance register tab now
// (InsurancePanel) — this used to also render a PI insurance card, but
// bundling insurance into "Licence register" left no room for anything else
// (Adam, 13 Aug 2026).
export function LicencePanel({
  staff,
  cpdByProfile,
  viewerProfile,
  cpdYearLabel,
  agency,
  reminderInfoByProfile = {},
  corporationReminderInfo = { next: null, last: null },
}: {
  staff: Profile[];
  cpdByProfile: Record<string, CpdRecord[]>;
  viewerProfile: Profile;
  cpdYearLabel: string;
  agency: Agency | null;
  reminderInfoByProfile?: Record<string, ReminderInfo>;
  corporationReminderInfo?: ReminderInfo;
}) {
  const statuses = staff.map((s) => expiryStatus(s.licence_expiry));
  const current = statuses.filter((s) => s === "ok" || s === "soon").length;
  const expiringSoon = statuses.filter((s) => s === "urgent").length;
  const expired = statuses.filter((s) => s === "expired").length;
  const cpdOutstanding = staff.filter((s) => {
    const isAssistant = s.licence_type === "certificate_of_registration";
    const target = isAssistant ? CPD_UNITS_REQUIRED_ASSISTANT : CPD_HOURS_REQUIRED_AGENT;
    const total = (cpdByProfile[s.id] ?? []).reduce((sum, r) => sum + Number(r.hours), 0);
    return total < target;
  }).length;

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile n={staff.length} l="Licences & certificates" />
        <Tile n={current} l="Current" ok />
        <Tile n={expiringSoon} l="Expiring ≤ 30 days" warn={expiringSoon > 0} />
        <Tile n={expired} l="Expired" bad={expired > 0} ok={expired === 0} />
        <Tile n={cpdOutstanding} l="CPD outstanding" warn={cpdOutstanding > 0} ok={cpdOutstanding === 0} />
      </div>

      {/* Says out loud what the daily reminder job does. Without this the
          reminders are invisible until one lands in someone's inbox, and an
          office that doesn't know they exist keeps its own spreadsheet of
          expiry dates anyway — which is the thing this register replaces. */}
      <div className="mt-3 rounded-card border border-rc-border bg-rc-green-soft px-4 py-3 text-xs text-rc-ink">
        <span className="font-semibold">Expiry reminders are on.</span> Everyone with a date on file is
        emailed 90, 30 and 7 days before it, and on the day. The licensee in charge is copied on every
        one. Renewals are made with NSW Fair Trading — update the date here once yours comes through and
        the reminders stop.
      </div>

      {/* The entity's own licence, above the people. The individuals' licences
          hang off the corporation licence, not the other way around. */}
      {agency && (
        <div className="mt-4">
          <CorporationLicenceCard
            holder={agency.corporation_licence_holder ?? null}
            licenceNumber={agency.corporation_licence_number ?? null}
            expiry={agency.corporation_licence_expiry ?? null}
            agencyName={agency.name}
            canEdit={Boolean(viewerProfile.is_licensee_in_charge)}
            reminderInfo={corporationReminderInfo}
          />
        </div>
      )}

      <div className="mt-4 space-y-4">
        {staff.map((s) => (
          <StaffRegisterCard
            key={s.id}
            profile={s}
            cpdRecords={cpdByProfile[s.id] ?? []}
            viewerProfile={viewerProfile}
            cpdYearLabel={cpdYearLabel}
            reminderInfo={reminderInfoByProfile[s.id] ?? { next: null, last: null }}
          />
        ))}
      </div>
    </div>
  );
}

function Tile({ n, l, ok, warn, bad }: { n: number; l: string; ok?: boolean; warn?: boolean; bad?: boolean }) {
  const color = bad ? "text-red-700" : warn ? "text-rc-amber-deep" : ok ? "text-rc-green-deep" : "text-rc-ink";
  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className={`text-xl font-bold tracking-tight ${color}`}>{n}</div>
      <div className="mt-0.5 text-[11px] font-medium text-rc-muted">{l}</div>
    </div>
  );
}
