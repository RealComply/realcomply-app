import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { TopNav } from "@/components/TopNav";
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

  return (
    <>
      <TopNav profile={profile} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-rc-ink">Training log</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Session history and attendance — evidence for your s32 training plan.
            </p>
          </div>
          <Link href="/dashboard/registers" className="text-sm text-neutral-500 hover:underline">
            ← Registers
          </Link>
        </div>

        <div className="mt-6">
          <AddSessionForm />
        </div>

        <div className="mt-6 space-y-4">
          {sessions.length === 0 ? (
            <p className="text-sm text-neutral-500">No training sessions logged yet.</p>
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
      </main>
    </>
  );
}
