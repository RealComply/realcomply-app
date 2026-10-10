"use client";

import { StaffRegisterCard } from "@/components/registers/StaffRegisterCard";
import { CorporationLicenceCard } from "@/components/registers/CorporationLicenceCard";
import { expiryStatus } from "@/lib/expiry-status";
import { cpdRequirementFor } from "@/lib/rules/nsw-cpd";
import { countableCpdHours } from "@/lib/cpd-hours";
import { REMINDER_SCHEDULE_WORDS } from "@/lib/licence-reminders";
import { TestReminderControl } from "@/components/registers/TestReminderControl";
import { useViewerAccess } from "@/components/ViewerAccess";
import type { ReminderInfo } from "@/components/registers/ReminderLine";
import type { Agency, CpdRecord, Profile } from "@/lib/types";

// Insurance (PI/cyber/iCare) lives in its own Insurance register tab now
// (InsurancePanel) — this used to also render a PI insurance card, but
// bundling insurance into "Licence register" left no room for anything else
// (Adam, 13 Aug 2026).
//
// An agent or assistant gets this tab with their own card only (10 Oct 2026):
// staff is just them, and the corporation licence and the test reminder are
// the licensee's. See the note in app/dashboard/registers/page.tsx.
export function LicencePanel({
  staff,
  formerStaff = [],
  cpdByProfile,
  viewerProfile,
  cpdYearLabel,
  agency,
  reminderInfoByProfile = {},
  corporationReminderInfo = { next: null, last: null },
  nameOf: names = {},
}: {
  staff: Profile[];
  /** People who have left (archived), shown read-only below the rest, the licensee's view only. */
  formerStaff?: Profile[];
  cpdByProfile: Record<string, CpdRecord[]>;
  viewerProfile: Profile;
  cpdYearLabel: string;
  agency: Agency | null;
  reminderInfoByProfile?: Record<string, ReminderInfo>;
  corporationReminderInfo?: ReminderInfo;
  /** Everyone's display name (agencyPeople), for "typed by" lines. */
  nameOf?: Record<string, string>;
}) {
  // The licensee's controls go to the agent on their own plan too
  // (lib/access.ts), not only to whoever has the licensee-in-charge flag.
  const { actsAsLicensee } = useViewerAccess();
  const nameOf: Record<string, string> = {
    ...names,
    ...Object.fromEntries([...staff, ...formerStaff].map((s) => [s.id, s.full_name ?? s.email])),
  };
  const statuses = staff.map((s) => expiryStatus(s.licence_expiry));
  const current = statuses.filter((s) => s === "ok" || s === "soon").length;
  const expiringSoon = statuses.filter((s) => s === "urgent").length;
  const expired = statuses.filter((s) => s === "expired").length;
  // Only counts people whose requirement we can actually state. Someone with
  // no category of practice recorded, or in a category Fair Trading hasn't
  // published for this year, isn't "outstanding" — we simply don't know, and
  // the card itself says so rather than this tile guessing.
  const cpdOutstanding = staff.filter((s) => {
    const requirement = cpdRequirementFor(s.licence_type, s.cpd_practice_category);
    const target = requirement.units ?? requirement.coreHours;
    if (target === null) return false;
    const total = countableCpdHours(cpdByProfile[s.id] ?? []);
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
        emailed {REMINDER_SCHEDULE_WORDS}. The licensee in charge is copied on every one. RealComply
        reminds; the holder renews with NSW Fair Trading. Upload the renewed licence here once it comes
        through: RealComply reads the new date and the reminders for the old one stop.
        {actsAsLicensee && (
          <TestReminderControl
            members={staff.filter((s) => !s.archived_at).map((s) => ({ id: s.id, name: s.full_name ?? s.email }))}
          />
        )}
      </div>

      {/* The entity's own licence, above the people. The individuals' licences
          hang off the corporation licence, not the other way around. */}
      {agency && actsAsLicensee && (
        <div className="mt-4">
          <CorporationLicenceCard
            agency={agency}
            canEdit={actsAsLicensee}
            reminderInfo={corporationReminderInfo}
            nameOf={nameOf}
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
            nameOf={nameOf}
          />
        ))}
      </div>

      {/* Former staff (review of 10 Oct 2026): read-only, collapsed, and
          outside every count above. The licence the agency held on file for
          someone who has left can still be opened here, with where its
          details came from and the last reminder sent. */}
      {formerStaff.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-xs font-medium text-rc-muted hover:text-rc-ink">
            Former staff ({formerStaff.length})
          </summary>
          <div className="mt-3 space-y-4">
            {formerStaff.map((s) => (
              <StaffRegisterCard
                key={s.id}
                profile={s}
                cpdRecords={cpdByProfile[s.id] ?? []}
                viewerProfile={viewerProfile}
                cpdYearLabel={cpdYearLabel}
                reminderInfo={reminderInfoByProfile[s.id] ?? { next: null, last: null }}
                nameOf={nameOf}
                former
              />
            ))}
          </div>
        </details>
      )}
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
