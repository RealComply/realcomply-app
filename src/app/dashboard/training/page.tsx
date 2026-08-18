import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { AddSessionForm } from "@/components/training/AddSessionForm";
import { SessionCard } from "@/components/training/SessionCard";
import type { Profile, TrainingAttendance, TrainingSession } from "@/lib/types";

// The office training log — RealComply-website-IA.md's "Training" screen:
// session history with attendance, sessions tagged CPD-eligible vs internal.
// Office training frequency isn't prescribed (s32 is outcome-based; the
// agency sets its own cadence, defaulting quarterly per the NSW obligation
// register) — this just needs a plan and evidence it happened, which is what
// logging sessions + attendance here produces. Marking attendance on a
// CPD-eligible session auto-logs each attendee's CPD hours (see
// recordAttendance in registers.ts) — that's the link back to the Registers
// page's CPD tally.
export default async function TrainingPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ data: sessionRows }, { data: staffRows }, { data: attendanceRows }] = await Promise.all([
    supabase.from("training_sessions").select("*").order("session_date", { ascending: false }),
    supabase.from("profiles").select("*").order("full_name", { ascending: true }),
    supabase.from("training_attendance").select("*"),
  ]);

  const sessions = (sessionRows ?? []) as TrainingSession[];
  const staff = (staffRows ?? []) as Profile[];

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

  return (
    <>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Training log</h1>
            <p className="mt-1 text-sm text-rc-muted">
              Session history and attendance — the record of what actually happened. The forward plan each person
              signs lives in Training plans.
            </p>
          </div>
          <div className="flex gap-4 text-sm font-medium">
            <Link href="/dashboard/registers" className="text-rc-muted transition hover:text-rc-green-deep">
              ← Registers
            </Link>
            <Link href="/dashboard/training-plans" className="text-rc-muted transition hover:text-rc-green-deep">
              Training plans →
            </Link>
          </div>
        </div>

        <div className="mt-6">
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
              Who&rsquo;s completed or attended what — mark attendance on a session above (&ldquo;Edit
              attendance&rdquo;) to populate this.
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
      </main>
    </>
  );
}
