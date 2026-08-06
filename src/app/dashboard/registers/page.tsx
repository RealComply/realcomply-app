import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { TopNav } from "@/components/TopNav";
import { PiInsuranceCard } from "@/components/registers/PiInsuranceCard";
import { StaffRegisterCard } from "@/components/registers/StaffRegisterCard";
import { currentCpdYear } from "@/lib/cpd-year";
import type { Agency, CpdRecord, Profile } from "@/lib/types";

// The licence register — RealComply-website-IA.md's "Registers" screen,
// licence-tracking slice (PI insurance + gifts/complaints registers are the
// documented next additions, not built here yet). Pulls together what
// RealComply-NSW-sales-obligation-register.md §A calls for: a current
// licence/certificate per person, current PI insurance for the agency, and
// CPD hours tracked toward the 7hr/yr requirement (1 Jul–30 Jun year).
export default async function RegistersPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const cpdYear = currentCpdYear();

  const [{ data: staffRows }, { data: agencyRow }, { data: cpdRows }] = await Promise.all([
    supabase.from("profiles").select("*").order("full_name", { ascending: true }),
    supabase.from("agencies").select("*").eq("id", profile.agency_id).maybeSingle(),
    supabase
      .from("cpd_records")
      .select("*")
      .gte("completed_date", cpdYear.start)
      .lte("completed_date", cpdYear.end),
  ]);

  const staff = (staffRows ?? []) as Profile[];
  const agency = agencyRow as Agency | null;
  const cpdByProfile = new Map<string, CpdRecord[]>();
  for (const row of (cpdRows ?? []) as CpdRecord[]) {
    if (!cpdByProfile.has(row.profile_id)) cpdByProfile.set(row.profile_id, []);
    cpdByProfile.get(row.profile_id)!.push(row);
  }

  return (
    <>
      <TopNav profile={profile} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-rc-ink">Registers</h1>
            <p className="mt-1 text-sm text-neutral-500">Licences, PI insurance, and CPD — {cpdYear.label} CPD year.</p>
          </div>
          <Link href="/dashboard/training" className="text-sm text-neutral-500 hover:underline">
            Training log →
          </Link>
        </div>

        {agency && (
          <div className="mt-6">
            <PiInsuranceCard agency={agency} viewerProfile={profile} />
          </div>
        )}

        <div className="mt-6 space-y-4">
          <h2 className="text-sm font-semibold text-rc-ink">Staff</h2>
          {staff.map((s) => (
            <StaffRegisterCard
              key={s.id}
              profile={s}
              cpdRecords={cpdByProfile.get(s.id) ?? []}
              viewerProfile={profile}
              cpdYearLabel={cpdYear.label}
            />
          ))}
        </div>
      </main>
    </>
  );
}
