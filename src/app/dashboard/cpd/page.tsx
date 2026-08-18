import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { CpdPersonCard } from "@/components/training/CpdPersonCard";
import { WhyDisclosure } from "@/components/WhyDisclosure";
import { currentCpdYear } from "@/lib/cpd-year";
import {
  CPD_DELIVERY_NOTE,
  CPD_ELECTIVE_NOTE,
  CPD_PROVIDER_NOTE,
  CPD_RECORD_RETENTION_NOTE,
  CPD_RULESET,
  cpdRequirementFor,
} from "@/lib/rules/nsw-cpd";
import type { CpdRecord, Profile } from "@/lib/types";

// CPD — its own section (Adam, 18 Aug 2026).
//
// It used to live inside a staff card in the licence register, as a progress
// bar under someone's licence number. That buried the one thing on the whole
// screen with a hard annual deadline and a licence condition attached to it
// (s 20(2) of the Act), and it put CPD next to office training in a way that
// made them look interchangeable. They are not — see 0021_cpd_provider_gate.
//
// This page answers one question per person: what do they owe this year, what
// have they done, and is there a record of completion behind each entry.
export default async function CpdPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const year = currentCpdYear();

  const [{ data: staffRows }, { data: cpdRows }] = await Promise.all([
    supabase.from("profiles").select("*").order("full_name", { ascending: true }),
    supabase
      .from("cpd_records")
      .select("*")
      .gte("completed_date", year.start)
      .lte("completed_date", year.end)
      .order("completed_date", { ascending: false }),
  ]);

  const staff = (staffRows ?? []) as Profile[];
  const records = (cpdRows ?? []) as CpdRecord[];

  const byProfile = new Map<string, CpdRecord[]>();
  for (const row of records) {
    if (!byProfile.has(row.profile_id)) byProfile.set(row.profile_id, []);
    byProfile.get(row.profile_id)!.push(row);
  }

  // Three counts, and the third is the one people don't expect: entries with
  // nobody named as the provider can't be shown to qualify at all.
  let met = 0;
  let unknown = 0;
  for (const s of staff) {
    const requirement = cpdRequirementFor(s.licence_type, s.cpd_practice_category);
    const target = requirement.units ?? requirement.coreHours;
    if (target === null) {
      unknown += 1;
      continue;
    }
    const logged = (byProfile.get(s.id) ?? []).reduce((sum, r) => sum + Number(r.hours), 0);
    if (logged >= target) met += 1;
  }
  const unattributed = records.filter((r) => !r.provider).length;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-rc-ink">CPD</h1>
          <p className="mt-1 text-sm text-rc-muted">
            Continuing professional development for the {year.label} year — 1 July to 30 June.
          </p>
        </div>
        <Link href="/dashboard/training" className="shrink-0 text-sm font-medium text-rc-muted transition hover:text-rc-green-deep">
          ← Training
        </Link>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <Tile n={met} l={`Met for ${year.label}`} ok={met === staff.length && staff.length > 0} />
        <Tile n={staff.length - met - unknown} l="Still outstanding" warn={staff.length - met - unknown > 0} />
        <Tile n={unknown} l="Requirement unknown" warn={unknown > 0} />
      </div>

      {unattributed > 0 && (
        <div className="mt-4 rounded-card border border-rc-amber/40 bg-rc-amber/10 px-4 py-3 text-xs leading-relaxed text-rc-amber-deep">
          <span className="font-semibold">
            {unattributed} {unattributed === 1 ? "entry has" : "entries have"} no provider recorded.
          </span>{" "}
          CPD only counts when a Fair Trading approved provider delivered it, so an entry with nobody named can&rsquo;t
          be shown to qualify. Add the provider, or remove the entry.
        </div>
      )}

      {/* Folded away rather than shouted. The rules still need a home — an
          agent who logs the wrong thing has to be able to find out why — but
          they don't need to greet everyone on every visit (Adam, 18 Aug). */}
      <div className="mt-4">
        <WhyDisclosure summary="What counts as CPD?">
          {CPD_PROVIDER_NOTE} {CPD_DELIVERY_NOTE} {CPD_ELECTIVE_NOTE} {CPD_RECORD_RETENTION_NOTE}
        </WhyDisclosure>
      </div>

      <div className="mt-6 space-y-4">
        {staff.length === 0 ? (
          <p className="text-sm text-rc-muted">No team members on file yet.</p>
        ) : (
          staff.map((s) => (
            <CpdPersonCard
              key={s.id}
              subject={s}
              viewerProfile={profile}
              records={byProfile.get(s.id) ?? []}
              requirement={cpdRequirementFor(s.licence_type, s.cpd_practice_category)}
              cpdYearLabel={year.label}
            />
          ))
        )}
      </div>

      <p className="mt-8 text-[11px] leading-relaxed text-rc-faint">
        Requirements shown are for the {CPD_RULESET.cpdYear} year, checked against{" "}
        <a href={CPD_RULESET.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-rc-muted">
          {CPD_RULESET.source}
        </a>{" "}
        on {CPD_RULESET.checkedOn}. Fair Trading republishes these annually without any change to the legislation, so
        they are re-checked each May. RealComply provides diligence support — confirm anything you rely on with Fair
        Trading or your adviser.
      </p>
    </main>
  );
}

function Tile({ n, l, ok, warn }: { n: number; l: string; ok?: boolean; warn?: boolean }) {
  const colour = warn ? "text-rc-amber-deep" : ok ? "text-rc-green-deep" : "text-rc-ink";
  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className={`text-xl font-bold tracking-tight ${colour}`}>{n}</div>
      <div className="mt-0.5 text-[11px] font-medium text-rc-muted">{l}</div>
    </div>
  );
}
