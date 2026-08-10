import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { TopNav } from "@/components/TopNav";
import { RegistersTabs } from "@/components/registers/RegistersTabs";
import { LicencePanel } from "@/components/registers/LicencePanel";
import { GiftsPanel } from "@/components/registers/GiftsPanel";
import { ComplaintsPanel } from "@/components/registers/ComplaintsPanel";
import { currentCpdYear } from "@/lib/cpd-year";
import type { Agency, Complaint, CpdRecord, Gift, Profile, Property } from "@/lib/types";

// Registers — RealComply-website-IA.md's "Registers" screen, all three tabs
// from the mockup: licence register (+ PI insurance + CPD), gift register
// (threshold-flagged), complaints register (cross-linked to files).
export default async function RegistersPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const cpdYear = currentCpdYear();

  const [
    { data: staffRows },
    { data: agencyRow },
    { data: cpdRows },
    { data: giftRows },
    { data: complaintRows },
    { data: propertyRows },
  ] = await Promise.all([
    supabase.from("profiles").select("*").order("full_name", { ascending: true }),
    supabase.from("agencies").select("*").eq("id", profile.agency_id).maybeSingle(),
    supabase.from("cpd_records").select("*").gte("completed_date", cpdYear.start).lte("completed_date", cpdYear.end),
    supabase.from("gifts").select("*").order("gift_date", { ascending: false }),
    supabase.from("complaints").select("*").order("received_date", { ascending: false }),
    supabase.from("properties").select("*").order("address", { ascending: true }),
  ]);

  const staff = (staffRows ?? []) as Profile[];
  const agency = agencyRow as Agency | null;
  const gifts = (giftRows ?? []) as Gift[];
  const complaints = (complaintRows ?? []) as Complaint[];
  const properties = (propertyRows ?? []) as Property[];

  const cpdByProfile: Record<string, CpdRecord[]> = {};
  for (const row of (cpdRows ?? []) as CpdRecord[]) {
    (cpdByProfile[row.profile_id] ??= []).push(row);
  }

  const giftsBadge = gifts.filter((g) => g.status === "flagged").length;
  const complaintsBadge = complaints.filter((c) => c.status !== "resolved").length;

  return (
    <>
      <TopNav profile={profile} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Registers</h1>
            <p className="mt-1 text-sm text-rc-muted">
              Agency-level records the licensee must keep — {cpdYear.label} CPD year.
            </p>
          </div>
          <div className="flex gap-4 text-sm font-medium">
            <Link href="/dashboard/registers/export" className="text-rc-muted transition hover:text-rc-green-deep">
              Export register
            </Link>
            <Link href="/dashboard/training" className="text-rc-muted transition hover:text-rc-green-deep">
              Training log →
            </Link>
            <Link href="/dashboard/document-signoffs" className="text-rc-muted transition hover:text-rc-green-deep">
              Document sign-offs →
            </Link>
          </div>
        </div>

        {agency && (
          <div className="mt-6">
            <RegistersTabs
              giftsBadge={giftsBadge}
              complaintsBadge={complaintsBadge}
              licence={
                <LicencePanel staff={staff} cpdByProfile={cpdByProfile} agency={agency} viewerProfile={profile} cpdYearLabel={cpdYear.label} />
              }
              gifts={<GiftsPanel gifts={gifts} staff={staff} threshold={agency.gift_threshold} viewerProfile={profile} />}
              complaints={
                <ComplaintsPanel
                  complaints={complaints}
                  staff={staff}
                  properties={properties}
                  viewerProfile={profile}
                  resolutionTargetDays={agency.complaint_resolution_target_days}
                />
              }
            />
          </div>
        )}
      </main>
    </>
  );
}
