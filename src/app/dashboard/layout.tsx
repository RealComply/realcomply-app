import { AssistantChat } from "@/components/chat/AssistantChat";
import { StrayDropGuard } from "@/components/StrayDropGuard";
import { Sidebar } from "@/components/Sidebar";
import { UserBar } from "@/components/UserBar";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { navCountsFor } from "@/lib/data/nav-counts";
import { pmAgencySettings } from "@/lib/data/pm";
import { endedStateFor } from "@/lib/subscription-end/access";
import { listingsFor } from "@/lib/subscription-end/records";
import { createServiceClient } from "@/lib/supabase/service";
import { RecordsView } from "@/components/records/RecordsView";
import { TrialStartView } from "@/components/billing/TrialStartView";
import { needsTrialStart } from "@/lib/billing/entitlement";
import { accountHolderId } from "@/lib/subscription-end/access";

// Shared across every /dashboard/* page. Now owns the whole application
// shell — sidebar, user bar, page background — rather than only the "Ask the
// Act" bubble.
//
// Previously each page rendered its own <TopNav profile={profile} />, which
// meant ten copies of the same two lines and ten places to edit whenever
// navigation changed. Moving it here makes navigation defined once. The old
// comment justified per-page rendering on the grounds that pages "need
// different profile data" — they don't; they all call requireProfile(), which
// is now wrapped in React's cache() so the layout and the page share a single
// fetch per request rather than doing two.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const supabase = await createClient();

  // Once the subscription has ended, every signed-in route shows the records
  // page and nothing else: no menu, no assistant (brief of 8 Oct 2026,
  // item 2). Rendered here, in place of the page, so no route is missed. The
  // listings are read with the service client for the reason given in
  // lib/subscription-end/records.ts, and only for the two people who may use
  // the page.
  const ended = await endedStateFor(supabase, profile);
  if (ended) {
    const listings = ended.mayUseRecords ? await listingsFor(createServiceClient(), ended.agencyId) : [];
    return <RecordsView profile={profile} state={ended} listings={listings} />;
  }

  // A new office whose card is not in yet sees one page: start your 14-day
  // trial (Adam, 9 Oct 2026). See TrialStartView.
  const { data: billingRow } = await supabase
    .from("agencies")
    .select("name, status, stripe_subscription_id")
    .eq("id", profile.agency_id)
    .maybeSingle();
  const billing = billingRow as { name: string; status: string | null; stripe_subscription_id: string | null } | null;
  if (billing && needsTrialStart(billing)) {
    const mayStart =
      profile.is_licensee_in_charge === true || (await accountHolderId(supabase, profile.agency_id)) === profile.id;
    return <TrialStartView profile={profile} agencyName={billing.name} mayStart={mayStart} />;
  }
  // The sidebar badges. Computed here rather than fetched from the browser so
  // the number is correct in the first paint — a count that appears a second
  // late reads as the page changing its mind.
  const [counts, pm] = await Promise.all([
    navCountsFor(supabase, profile),
    // Whether this agency has property management switched on (0052), for
    // the "Property management" entry beside sales.
    pmAgencySettings(supabase, profile.agency_id),
  ]);

  return (
    // Column width comes from --rc-sidebar-w, which Sidebar sets on <html>
    // when you collapse or expand it. Declared with a fallback so the first
    // server-rendered paint is correct even before any client code runs.
    <div className="rc-app-shell min-h-screen bg-rc-bg-alt transition-[grid-template-columns] duration-200 md:grid md:grid-cols-[var(--rc-sidebar-w,236px)_1fr]">
      {/* Renders nothing. Stops a file dropped outside an upload control from
          navigating the browser to it and taking the page — and anything
          unsaved on it — with it. See lib/use-file-drop.ts. */}
      <StrayDropGuard />
      <Sidebar
        isAssistant={Boolean(profile.is_assistant)}
        isPlatformAdmin={profile.is_platform_admin === true}
        pmEnabled={pm.enabled}
        counts={counts}
      />
      {/* min-w-0: a grid column's 1fr track will not shrink below its
          content's widest line, so without this anything wide inside a page
          (the progress bar's six ovals, 3 Oct 2026) pushes the whole page
          sideways just above the md breakpoint instead of scrolling in its
          own box. */}
      <div className="flex min-h-screen min-w-0 flex-col">
        <UserBar profile={profile} pmEnabled={pm.enabled} />
        {children}
        <AssistantChat />
      </div>
    </div>
  );
}
