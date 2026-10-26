import { redirect } from "next/navigation";
import { AssistantChat } from "@/components/chat/AssistantChat";
import { StrayDropGuard } from "@/components/StrayDropGuard";
import { Sidebar } from "@/components/Sidebar";
import { ViewerAccessProvider } from "@/components/ViewerAccess";
import { UserBar } from "@/components/UserBar";
import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/data/current-profile";
import { hasAcceptedCurrentLegal } from "@/lib/legal/acceptance";
import { navCountsFor } from "@/lib/data/nav-counts";
import { pmAgencySettings } from "@/lib/data/pm";
import { endedStateFor } from "@/lib/subscription-end/access";
import { listingsFor } from "@/lib/subscription-end/records";
import { createServiceClient } from "@/lib/supabase/service";
import { RecordsView } from "@/components/records/RecordsView";
import { TrialStartView } from "@/components/billing/TrialStartView";
import { BeforeYouStartView } from "@/components/onboarding/BeforeYouStartView";
import { formalAgencyName } from "@/lib/agency-names";
import { formatAuTimestamp } from "@/lib/format-date";
import { needsTrialStart, PLANS, type Plan } from "@/lib/billing/entitlement";
import { isAccountHolder } from "@/lib/subscription-end/access";
import { agencyLogoUrl } from "@/lib/storage/evidence";

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
  const { profile, access } = await requireAccess();
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

  // Nobody uses the app on terms they have not accepted. When the terms or
  // privacy policy get a new version, existing users land on /accept-terms
  // the next time they open any dashboard page. See lib/legal/acceptance.ts.
  // After the records page on purpose: an agency whose subscription has ended
  // must be able to take its records away without accepting new terms first.
  if (!(await hasAcceptedCurrentLegal(supabase, profile.id))) {
    redirect("/accept-terms");
  }

  // A new office whose card is not in yet sees one page: start your 14-day
  // trial (Adam, 9 Oct 2026). See TrialStartView.
  // Every column, so annexure_gate comes through once 0071 has added it and
  // nothing breaks before then. One row by primary key.
  const { data: billingRow } = await supabase
    .from("agencies")
    .select("*")
    .eq("id", profile.agency_id)
    .maybeSingle();
  const billing = billingRow as {
    name: string;
    plan: string | null;
    status: string | null;
    stripe_subscription_id: string | null;
    logo_path: string | null;
    licensee_name?: string | null;
    licensed_entity_name?: string | null;
    annexure_gate?: boolean | null;
  } | null;
  if (billing && needsTrialStart(billing)) {
    const mayStart =
      profile.is_licensee_in_charge === true || (await isAccountHolder(supabase));
    // The master switch comes too (10 Oct 2026). "Put on a 14-day trial" on a
    // free account lands here with no subscription, and this page replaces
    // Billing, where the switch lives, so nothing could put it back.
    const masterPlan: Plan | null =
      profile.is_platform_admin !== true
        ? null
        : billing.plan && billing.plan in PLANS
          ? (billing.plan as Plan)
          : "office_1";
    return (
      <TrialStartView profile={profile} agencyName={billing.name} mayStart={mayStart} masterPlan={masterPlan} />
    );
  }
  // "Before you start" (job 7 brief, Part 1; 0071): the agent on their own
  // plan confirms the five statements once, before using the app. After the
  // trial start above, because the plan is only known to be theirs once the
  // card is in. Only where the office's annexure lock is on, so the offices
  // that existed before it never see it unless RealComply switches theirs on.
  // Only on a clean read: if their confirmation can't be read, no screen.
  if (billing?.annexure_gate === true && access.isAgentPlan && access.actsAsLicensee) {
    const { data: ackRow, error: ackError } = await supabase
      .from("agent_acknowledgements")
      .select("id")
      .eq("profile_id", profile.id)
      .maybeSingle();
    if (!ackError && !ackRow) {
      return (
        <BeforeYouStartView
          profile={profile}
          agencyName={formalAgencyName({
            tradingName: billing.name ?? "",
            licensedEntityName: billing.licensed_entity_name ?? null,
          })}
          licenseeName={billing.licensee_name?.trim() ?? ""}
          // No licensee licence number is kept for an agent's own plan yet, so it is typed.
          licenseeLicenceNumber=""
          date={formatAuTimestamp(new Date().toISOString())}
        />
      );
    }
  }

  // The sidebar badges. Computed here rather than fetched from the browser so
  // the number is correct in the first paint — a count that appears a second
  // late reads as the page changing its mind.
  const [counts, pm, accountHolder, logoUrl] = await Promise.all([
    navCountsFor(supabase, profile),
    // Whether this agency has property management (on for office plans,
    // 0086), for the "Property management" entry beside sales.
    pmAgencySettings(supabase, profile.agency_id),
    // The Billing link for an office founder who is not the licensee: the
    // Billing page lets them in, so the menu and search show it (10 Oct
    // 2026). Only asked when it could change anything.
    access.actsAsLicensee ? Promise.resolve(false) : isAccountHolder(supabase),
    // The agency's logo, under RealComply's at the top of the sidebar (12 Oct
    // 2026). Signed here, once, for the sidebar to show.
    agencyLogoUrl(supabase, billing?.logo_path),
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
        actsAsLicensee={access.actsAsLicensee}
        isAccountHolder={accountHolder}
        isPlatformAdmin={profile.is_platform_admin === true}
        pmEnabled={pm.enabled}
        counts={counts}
        agencyName={billing?.name ?? null}
        agencyLogoUrl={logoUrl}
      />
      {/* min-w-0: a grid column's 1fr track will not shrink below its
          content's widest line, so without this anything wide inside a page
          (the progress bar's six ovals, 3 Oct 2026) pushes the whole page
          sideways just above the md breakpoint instead of scrolling in its
          own box. */}
      <div className="flex min-h-screen min-w-0 flex-col">
        <UserBar
          profile={profile}
          agencyName={billing?.name ?? null}
          pmEnabled={pm.enabled}
          actsAsLicensee={access.actsAsLicensee}
          isAccountHolder={accountHolder}
        />
        <ViewerAccessProvider
          value={{ actsAsLicensee: access.actsAsLicensee, officeLicensee: access.officeLicensee }}
        >
          {children}
        </ViewerAccessProvider>
        <AssistantChat />
      </div>
    </div>
  );
}
