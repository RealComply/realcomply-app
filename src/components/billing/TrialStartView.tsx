import { logout } from "@/lib/actions/auth";
import { MasterSwitch } from "@/components/billing/MasterSwitch";
import { PlanPicker } from "@/components/billing/PlanPicker";
import { TrialStartWatcher } from "@/components/billing/TrialStartWatcher";
import { TRIAL_DAYS, type Plan } from "@/lib/billing/entitlement";
import type { Profile } from "@/lib/types";

// What a new office sees until its card is in (Adam, 9 Oct 2026: "A new
// office starts on a 14-day trial with card details taken at sign-up").
//
// Shown by the dashboard layout in place of every page while the agency is
// 'trialing' with no Stripe subscription (needsTrialStart). The plan picker
// sends them to Stripe's own page for the card; Stripe starts the 14 days
// there and its webhook records the subscription, which lifts this page and
// the database's block on new records (0055).
//
// Only the licensee in charge or the account holder can start it. Anyone
// invited before it starts is told who to ask.
//
// A RealComply platform admin also gets the master switch here (10 Oct 2026):
// putting a free account on a trial from Billing brings this page up in place
// of Billing, and without the switch there was no way back to free.
export function TrialStartView({
  profile,
  agencyName,
  mayStart,
  masterPlan = null,
}: {
  profile: Profile;
  agencyName: string;
  mayStart: boolean;
  /** The agency's plan, for a platform admin only; null hides the switch. */
  masterPlan?: Plan | null;
}) {
  return (
    <div className="min-h-screen bg-rc-bg-alt">
      <header className="flex flex-wrap items-center gap-3 bg-rc-ink-bg px-4 py-3 text-white">
        <span className="text-lg font-bold">
          Real<span className="text-rc-green">Comply</span>
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-3 text-xs text-rc-ink-muted">
          {profile.full_name ?? profile.email} · {agencyName}
          <form action={logout}>
            <button type="submit" className="underline">
              Sign out
            </button>
          </form>
        </span>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Start your {TRIAL_DAYS}-day free trial</h1>
        {mayStart ? (
          <>
            <p className="mt-2 max-w-prose text-sm text-rc-muted">
              Choose a plan, then enter card details on Stripe&rsquo;s secure page. Nothing is charged for{" "}
              {TRIAL_DAYS} days, and you&rsquo;ll get a reminder three days before the first payment. Cancel any time
              before then and you won&rsquo;t be charged.
            </p>
            <TrialStartWatcher>
              <PlanPicker suggested="office_1" listingCount={0} />
              <p className="mt-4 text-xs text-rc-faint">
                Just entered your card? This page updates within a minute of Stripe confirming it.
              </p>
            </TrialStartWatcher>
          </>
        ) : (
          <p className="mt-4 rounded-xl border border-rc-border bg-white px-4 py-3 text-sm text-rc-muted">
            {agencyName}&rsquo;s trial hasn&rsquo;t started yet. Your licensee in charge or the person who set up the
            agency starts it by entering card details. Once they have, you&rsquo;ll have full access.
          </p>
        )}
        {masterPlan && <MasterSwitch currentPlan={masterPlan} currentStatus="trialing" />}
      </main>
    </div>
  );
}
