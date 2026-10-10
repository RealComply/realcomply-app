import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/data/current-profile";
import { RecordsView } from "@/components/records/RecordsView";

// Staff-only sample of the records page, with a made-up office, so its look
// at phone width and in dark mode can be checked without ending a
// subscription. Outside /dashboard on purpose: the dashboard layout would wrap
// it in the menu, and the real records page has none. Reads nothing from the
// database beyond the caller's own profile.
//
// The buttons are the real ones. Clicking Download or Reactivate here does
// nothing useful, because the caller's own agency has not ended.
//
//   /staff-preview/records
//   /staff-preview/records?view=agent     (what other users of the agency see)
export const dynamic = "force-dynamic";

export default async function RecordsSample({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const profile = await requireProfile();
  if (profile.is_platform_admin !== true) notFound();
  const { view } = await searchParams;

  // Ended today, so the countdown reads 14 days.
  const endedAt = new Date();

  return (
    <RecordsView
      profile={{ ...profile, full_name: "Dana Whitlock (sample)" }}
      state={{
        agencyId: "sample",
        agencyName: "Harbour & Vale Realty (sample)",
        endedAt,
        mayUseRecords: view !== "agent",
        isAccountHolder: true,
      }}
      listings={[
        { id: "s1", address: "48 Ocean Parade, Dee Why", stageLabel: "Settled", createdAt: "" },
        { id: "s2", address: "123 Smith Street, Manly", stageLabel: "Sold", createdAt: "" },
        { id: "s3", address: "7/15 Orara Street, Waitara", stageLabel: "On the market", createdAt: "" },
        { id: "s4", address: "9 Mirrabooka Road, Asquith", stageLabel: "Pre-market", createdAt: "" },
      ]}
    />
  );
}
