import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { CpdPersonCard } from "@/components/training/CpdPersonCard";
import { currentCpdYear } from "@/lib/cpd-year";
import type { CpdRecord, CpdYearSignoff, Profile } from "@/lib/types";

// CPD — a certificate and a tick.
//
// Rebuilt 18 Aug 2026, twice in one day, which is worth recording. The first
// version asked for a category of practice so it could compute the required
// hours, showed a progress bar against them, and explained in four paragraphs
// why only approved providers count. Adam's verdict on all of it: "we all know
// this... we also don't need to fill in all the details... once we complete the
// CPD a certificate is issued, and then all we need to do is upload that
// certificate and tick that the CPD's been done for that year. Less friction,
// less manual data entry."
//
// He was applying the product's own rule. The evidence model says a form is an
// index to evidence rather than a re-tick, and that anything printed on a
// document being uploaded anyway should be read rather than retyped. A record
// of completion states the provider, the topic, the hours, the date and the
// assessment result — so asking for those was asking someone to transcribe a
// document into a form beside the document.
//
// THE TRADE, MADE KNOWINGLY: without the category of practice there is no
// required-hours figure, so this screen cannot warn someone they are short in
// June. It records what was done and who confirmed it. That is the same
// posture the rest of the product takes — surface and record; the licensee
// decides.
export default async function CpdPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const year = currentCpdYear();

  const [{ data: staffRows }, { data: cpdRows }, { data: signoffRows }] = await Promise.all([
    supabase.from("profiles").select("*").order("full_name", { ascending: true }),
    supabase
      .from("cpd_records")
      .select("*")
      .gte("completed_date", year.start)
      .lte("completed_date", year.end)
      .order("completed_date", { ascending: false }),
    supabase.from("cpd_year_signoffs").select("*").eq("cpd_year_start", year.start),
  ]);

  const staff = (staffRows ?? []) as Profile[];
  const records = (cpdRows ?? []) as CpdRecord[];
  const signoffs = (signoffRows ?? []) as CpdYearSignoff[];

  const byProfile = new Map<string, CpdRecord[]>();
  for (const row of records) {
    if (!byProfile.has(row.profile_id)) byProfile.set(row.profile_id, []);
    byProfile.get(row.profile_id)!.push(row);
  }
  const signoffByProfile = new Map(signoffs.map((s) => [s.profile_id, s]));

  const outstanding = staff.filter((s) => !signoffByProfile.has(s.id)).length;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-rc-ink">CPD</h1>
          <p className="mt-1 text-sm text-rc-muted">
            {year.label} — 1 July to 30 June. Upload each certificate; RealComply reads the rest.
          </p>
        </div>
        <Link
          href="/dashboard/training"
          className="shrink-0 text-sm font-medium text-rc-muted transition hover:text-rc-green-deep"
        >
          ← Training
        </Link>
      </div>

      {/* One line, only when there's something to say. A banner that appears
          on every visit stops being read by the third one. */}
      {staff.length > 0 && outstanding > 0 && (
        <p className="mt-4 text-sm text-rc-muted">
          <span className="font-semibold text-rc-amber-deep">
            {outstanding} of {staff.length}
          </span>{" "}
          not confirmed for {year.label} yet.
        </p>
      )}

      <div className="mt-5 space-y-4">
        {staff.length === 0 ? (
          <p className="text-sm text-rc-muted">No team members on file yet.</p>
        ) : (
          staff.map((s) => (
            <CpdPersonCard
              key={s.id}
              subject={s}
              viewerProfile={profile}
              records={byProfile.get(s.id) ?? []}
              signoff={signoffByProfile.get(s.id) ?? null}
              cpdYearStart={year.start}
              cpdYearLabel={year.label}
            />
          ))
        )}
      </div>

      <p className="mt-8 text-[11px] leading-relaxed text-rc-faint">
        Keep certificates 3 years — 4 for a certificate of registration holder&rsquo;s statement of attainment.
        RealComply provides diligence support; the licensee decides.
      </p>
    </main>
  );
}
