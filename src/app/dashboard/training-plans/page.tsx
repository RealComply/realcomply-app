import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { TrainingPlanCard } from "@/components/training/TrainingPlanCard";
import { currentCpdYear } from "@/lib/cpd-year";
import { CPD_RULESET, CPD_DELIVERY_NOTE, cpdRequirementFor } from "@/lib/rules/nsw-cpd";
import type { CpdRecord, Profile, TrainingPlan, TrainingPlanItem } from "@/lib/types";

// Annual training plans — Requirement 2.4 of the NSW Supervision Guidelines.
//
// Deliberately a separate screen from the Training log. They are different
// obligations and conflating them is what left the gap in the first place:
// the log records sessions that already happened, which is evidence; this is
// the forward plan the licensee in charge must prepare, consult on, sign and
// review each year, which is the requirement. An inspector asking to see the
// training plan is asking for this screen, and a list of past sessions is not
// an answer.
export default async function TrainingPlansPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const year = currentCpdYear();

  const [{ data: staffRows }, { data: planRows }, { data: itemRows }, { data: cpdRows }] = await Promise.all([
    supabase.from("profiles").select("*").order("full_name", { ascending: true }),
    supabase.from("training_plans").select("*").eq("cpd_year_start", year.start),
    supabase.from("training_plan_items").select("*").order("sort_order", { ascending: true }),
    supabase.from("cpd_records").select("*").gte("completed_date", year.start).lte("completed_date", year.end),
  ]);

  const staff = (staffRows ?? []) as Profile[];
  const plans = (planRows ?? []) as TrainingPlan[];
  const items = (itemRows ?? []) as TrainingPlanItem[];
  const cpd = (cpdRows ?? []) as CpdRecord[];

  const planByProfile = new Map(plans.map((p) => [p.profile_id, p]));
  const itemsByPlan = new Map<string, TrainingPlanItem[]>();
  for (const item of items) {
    if (!itemsByPlan.has(item.plan_id)) itemsByPlan.set(item.plan_id, []);
    itemsByPlan.get(item.plan_id)!.push(item);
  }
  const cpdByProfile = new Map<string, CpdRecord[]>();
  for (const row of cpd) {
    if (!cpdByProfile.has(row.profile_id)) cpdByProfile.set(row.profile_id, []);
    cpdByProfile.get(row.profile_id)!.push(row);
  }

  const withoutPlan = staff.filter((s) => !planByProfile.has(s.id)).length;
  const unapproved = staff.filter((s) => {
    const plan = planByProfile.get(s.id);
    return plan && !plan.principal_signed_at;
  }).length;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Annual training plans</h1>
          <p className="mt-1 text-sm text-rc-muted">
            One plan per person for the {year.label} CPD year — Requirement 2.4 of the Supervision Guidelines.
          </p>
        </div>
        <Link href="/dashboard/training" className="shrink-0 text-sm font-medium text-rc-muted transition hover:text-rc-green-deep">
          Training log →
        </Link>
      </div>

      {/* What this screen is for, in one paragraph, because "we already log
          training" is the exact reason an agency thinks it's covered. */}
      <div className="mt-5 rounded-card border border-rc-border bg-rc-green-soft px-4 py-3 text-xs leading-relaxed text-rc-ink">
        <p>
          <span className="font-semibold">A log isn&rsquo;t a plan.</span> The licensee in charge prepares a plan for each
          staff member, developed in consultation with them, identifying their gaps and the training that addresses
          them. Both parties sign it, and it&rsquo;s reviewed and updated each CPD year.
        </p>
        <p className="mt-2 text-rc-muted">{CPD_DELIVERY_NOTE}</p>
      </div>

      {(withoutPlan > 0 || unapproved > 0) && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Tile n={withoutPlan} l="No plan this year" warn={withoutPlan > 0} />
          <Tile n={unapproved} l="Not yet approved" warn={unapproved > 0} />
        </div>
      )}

      <div className="mt-6 space-y-4">
        {staff.length === 0 ? (
          <p className="text-sm text-rc-muted">No team members on file yet.</p>
        ) : (
          staff.map((s) => {
            const plan = planByProfile.get(s.id) ?? null;
            return (
              <TrainingPlanCard
                key={s.id}
                subject={s}
                viewerProfile={profile}
                plan={plan}
                items={plan ? (itemsByPlan.get(plan.id) ?? []) : []}
                cpdRecords={cpdByProfile.get(s.id) ?? []}
                requirement={cpdRequirementFor(s.licence_type, s.cpd_practice_category)}
                cpdYearLabel={year.label}
              />
            );
          })
        )}
      </div>

      {/* Where the numbers came from and when they were checked. Fair Trading
          republishes this ruleset annually on an unversioned page, so an
          undated figure is a liability. */}
      <p className="mt-8 text-[11px] leading-relaxed text-rc-faint">
        CPD requirements shown are for the {CPD_RULESET.cpdYear} year, checked against{" "}
        <a href={CPD_RULESET.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-rc-muted">
          {CPD_RULESET.source}
        </a>{" "}
        on {CPD_RULESET.checkedOn}. RealComply provides diligence support — confirm anything you rely on with Fair
        Trading or your adviser.
      </p>
    </main>
  );
}

function Tile({ n, l, warn }: { n: number; l: string; warn?: boolean }) {
  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className={`text-xl font-bold tracking-tight ${warn ? "text-rc-amber-deep" : "text-rc-ink"}`}>{n}</div>
      <div className="mt-0.5 text-[11px] font-medium text-rc-muted">{l}</div>
    </div>
  );
}
