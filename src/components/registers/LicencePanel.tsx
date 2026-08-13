"use client";

import { StaffRegisterCard } from "@/components/registers/StaffRegisterCard";
import { expiryStatus } from "@/lib/expiry-status";
import { CPD_HOURS_REQUIRED_AGENT, CPD_UNITS_REQUIRED_ASSISTANT } from "@/lib/cpd-year";
import type { CpdRecord, Profile } from "@/lib/types";

// Insurance (PI/cyber/iCare) lives in its own Insurance register tab now
// (InsurancePanel) — this used to also render a PI insurance card, but
// bundling insurance into "Licence register" left no room for anything else
// (Adam, 13 Aug 2026).
export function LicencePanel({
  staff,
  cpdByProfile,
  viewerProfile,
  cpdYearLabel,
}: {
  staff: Profile[];
  cpdByProfile: Record<string, CpdRecord[]>;
  viewerProfile: Profile;
  cpdYearLabel: string;
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
        <Tile n={staff.length} l="Licence holders" />
        <Tile n={current} l="Current" ok />
        <Tile n={expiringSoon} l="Expiring ≤ 30 days" warn={expiringSoon > 0} />
        <Tile n={expired} l="Expired" bad={expired > 0} ok={expired === 0} />
        <Tile n={cpdOutstanding} l="CPD outstanding" warn={cpdOutstanding > 0} ok={cpdOutstanding === 0} />
      </div>

      <div className="mt-4 space-y-4">
        {staff.map((s) => (
          <StaffRegisterCard
            key={s.id}
            profile={s}
            cpdRecords={cpdByProfile[s.id] ?? []}
            viewerProfile={viewerProfile}
            cpdYearLabel={cpdYearLabel}
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
