import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { AddSessionForm } from "@/components/training/AddSessionForm";
import { SessionCard } from "@/components/training/SessionCard";
import { TrainingTabs } from "@/components/training/TrainingTabs";
import { TrainingPlanCard } from "@/components/training/TrainingPlanCard";
import { WhyDisclosure } from "@/components/WhyDisclosure";
import { currentCpdYear } from "@/lib/cpd-year";
import { cpdRequirementFor } from "@/lib/rules/nsw-cpd";
import type {
  CpdRecord,
  Profile,
  TrainingAttendance,
  TrainingPlan,
  TrainingPlanItem,
  TrainingSession,
} from "@/lib/types";

// Training — one section, two tabs (Adam, 18 Aug 2026).
//
// The plan is what Requirement 2.4 of the Supervision Guidelines asks for:
// per staff member, per CPD year, developed in consultation, signed by both.
// The log is the evidence of sessions that actually happened. They were two
// separate nav entries, which made the app look like it had two unrelated
// training features and hid the relationship between them.
//
// CPD is deliberately NOT here — it has its own section now. Office training
// and CPD are different ledgers (see 0021_cpd_provider_gate.sql), and putting
// them on one screen is what let internal sessions accrue CPD hours in the
// first place.
export default async function TrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { tab } = await searchParams;
  const year = currentCpdYear();

  const [
    { data: sessionRows },
    { data: staffRows },
    { data: attendanceRows },
    { data: planRows },
    { data: itemRows },
    { data: cpdRows },
  ] = await Promise.all([
    supabase.from("training_sessions").select("*").order("session_date", { ascending: false }),
    supabase.from("profiles").select("*").order("full_name", { ascending: true }),
    supabase.from("training_attendance").select("*"),
    supabase.from("training_plans").select("*").eq("cpd_year_start", year.start),
    supabase.from("training_plan_items").select("*").order("sort_order", { ascending: true }),
    supabase.from("cpd_records").select("*").gte("completed_date", year.start).lte("completed_date", year.end),
  ]);

  const sessions = (sessionRows ?? []) as TrainingSession[];
  const staff = (staffRows ?? []) as Profile[];
  const plans = (planRows ?? []) as TrainingPlan[];
  const items = (itemRows ?? []) as TrainingPlanItem[];
  const cpd = (cpdRows ?? []) as CpdRecord[];

  const attendeesBySession = new Map<string, string[]>();
  for (const row of (attendanceRows ?? []) as TrainingAttendance[]) {
    if (!attendeesBySession.has(row.session_id)) attendeesBySession.set(row.session_id, []);
    attendeesBySession.get(row.session_id)!.push(row.profile_id);
  }

  const sessionsById = new Map(sessions.map((s) => [s.id, s]));
  const sessionsByAgent = new Map<string, TrainingSession[]>();
  for (const row of (attendanceRows ?? []) as TrainingAttendance[]) {
    const session = sessionsById.get(row.session_id);
    if (!session) continue;
    if (!sessionsByAgent.has(row.profile_id)) sessionsByAgent.set(row.profile_id, []);
    sessionsByAgent.get(row.profile_id)!.push(session);
  }

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

  const needsPlan = staff.filter((s) => !planByProfile.has(s.id) || !planByProfile.get(s.id)!.principal_signed_at).length;

  // Adam, 18 Aug 2026: "having these sections so text heavy is just gonna put
  // people off... most agents don't need to know this stuff. The licensee
  // themselves will know what registers they need to keep and why."
  //
  // Right. The explanation moved into a disclosure the curious can open and
  // everyone else never sees. The rules didn't change — the shouting did.
  const plansPanel = (
    <div>
      <WhyDisclosure summary="What goes on a training plan?">
        One plan per person per CPD year, agreed with them and signed by both. It can include internal coaching —
        only tick &ldquo;counts toward CPD&rdquo; where an approved provider delivered it. Requirement 2.4 of the
        Supervision Guidelines.
      </WhyDisclosure>

      <div className="mt-4 space-y-4">
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
    </div>
  );

  const logPanel = (
    <div>
      <WhyDisclosure summary="Does a session count toward CPD?">
        Only if a Fair Trading approved provider delivered it. Your own internal sessions don&rsquo;t — though an
        approved provider running a session at your office does, so the venue isn&rsquo;t the test.
      </WhyDisclosure>

      <div className="mt-4">
        <AddSessionForm />
      </div>

      <div className="mt-6 space-y-4">
        {sessions.length === 0 ? (
          <p className="text-sm text-rc-muted">No training sessions logged yet.</p>
        ) : (
          sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              staff={staff}
              attendeeIds={attendeesBySession.get(session.id) ?? []}
              canDelete={profile.is_licensee_in_charge}
            />
          ))
        )}
      </div>

      {sessions.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-rc-ink">Per-agent training record</h2>
          <p className="mt-1 text-xs text-rc-muted">
            Who&rsquo;s attended what — mark attendance on a session above (&ldquo;Edit attendance&rdquo;) to populate
            this.
          </p>
          <ul className="mt-2 divide-y divide-rc-border rounded-card border border-rc-border bg-white shadow-card">
            {staff.map((s) => {
              const attended = sessionsByAgent.get(s.id) ?? [];
              return (
                <li key={s.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-rc-ink">{s.full_name ?? s.email}</span>
                    <span className="text-xs text-rc-faint">
                      {attended.length} session{attended.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {attended.length > 0 ? (
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                      {attended.map((sess) => (
                        <li key={sess.id} className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600">
                          {sess.title} ({sess.session_date})
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-rc-faint">No sessions recorded yet.</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Training</h1>
          <p className="mt-1 text-sm text-rc-muted">
            The plan for the {year.label} CPD year, and the record of what actually happened.
          </p>
        </div>
        <Link href="/dashboard/cpd" className="shrink-0 text-sm font-medium text-rc-muted transition hover:text-rc-green-deep">
          CPD →
        </Link>
      </div>

      <div className="mt-6">
        <TrainingTabs
          plans={plansPanel}
          log={logPanel}
          defaultTab={tab === "log" ? "log" : "plans"}
          plansBadge={needsPlan}
        />
      </div>
    </main>
  );
}
