import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/data/current-profile";
import { ownWork, readsBeyondOwnWork } from "@/lib/data/listing-access";
import { licenseeNameFor, listingGate } from "@/lib/data/listing-gate";
import { ListingLockCard } from "@/components/annexure/ListingLockCard";
import { licenseeChangeStatus } from "@/lib/data/licensee-change";
import { NewLicenseeListingLock } from "@/components/annexure/NewLicenseeListingLock";
import { navCountsFor } from "@/lib/data/nav-counts";
import { listingTabRowsFor } from "@/lib/data/listing-tabs";
import { readTab } from "@/lib/rules/listing-tabs";
import { ListingTabsView } from "@/components/listings/ListingTabsView";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { profile, access } = await requireAccess();
  const supabase = await createClient();

  // Two locks can hold back a new listing, and the page shows one of them:
  // the annexure lock (job 7 brief, Parts 4 and 5; 0071) while it is on, else
  // the one after a change of licensee in charge until the new one adopts the
  // annexure (0080). "Add listing" gives way to why; existing listings below
  // open and save as normal.
  const gate = await listingGate(supabase);
  const lockLicensee = gate
    ? await licenseeNameFor(supabase, profile.agency_id, { agentPlan: access.isAgentPlan })
    : null;
  const change = gate ? null : await licenseeChangeStatus(supabase);
  const newLicenseeLock = change?.annexurePending === true;
  const locked = Boolean(gate) || newLicenseeLock;

  // Four tabs (Job B; mockup v6, Adam's OK, 5 Nov 2026): On the market (the
  // default), Sold, Settled and Withdrawn from sale. Who sees which listings
  // is the database's rule, as before. Tabs don't change plan counts.
  const params = await searchParams;
  const tab = readTab(params.tab);
  const query = typeof params.q === "string" ? params.q : "";
  const rows = await listingTabRowsFor(supabase);

  // The same numbers the sidebar shows, in the place you would look for them
  // when deciding which file to open. Free: the dashboard layout has already
  // called this in the same request and navCountsFor is cached, so this is a
  // map lookup rather than a second set of queries.
  const { listingRows } = await navCountsFor(supabase, profile, readsBeyondOwnWork(access) ? profile.id : null);
  // An office manager sees every listing in the office (Adam, 3 Nov 2026;
  // 0108), to read: another agent's opens as its read-only record, marked
  // "View only" on the tabs (Job B, 5 Nov 2026).
  const ownIds = new Set(ownWork(rows.map((r) => r.property), access, profile.id).map((p) => p.id));
  const viewOnlyIds = readsBeyondOwnWork(access)
    ? rows.map((r) => r.property.id).filter((id) => !ownIds.has(id))
    : [];

  return (
    <>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        {/* "Listings", not "properties" (Adam, 18 Aug 2026) — it's what
            agents call them, and "property" is already doing a different job
            in this app, where it means the physical thing a listing is about
            (property type, strata, pool). */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Listings</h1>
            <p className="mt-1 text-sm text-rc-muted">
              {rows.length === 0
                ? "Every listing you're running, and where each one is up to."
                : `${rows.length} listing${rows.length === 1 ? "" : "s"}. Open one to work through its checklist.`}
            </p>
          </div>
          {!locked && (
            <Link
              href="/dashboard/new"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-semibold text-white shadow-glow-green transition hover:bg-rc-green-deep-600"
            >
              <Plus size={16} strokeWidth={2.5} /> Add listing
            </Link>
          )}
        </div>

        {gate && (
          <div className="mt-6">
            <ListingLockCard
              gate={gate}
              actsAsLicensee={access.actsAsLicensee}
              licenseeName={lockLicensee}
              agencyId={profile.agency_id}
            />
          </div>
        )}
        {newLicenseeLock && (
          <div className="mt-6">
            <NewLicenseeListingLock isLicensee={access.officeLicensee} licenseeName={change?.licenseeName ?? null} />
          </div>
        )}

        {rows.length === 0 ? (
          locked ? null : (
            <div className="mt-10 rounded-card border border-dashed border-rc-border bg-white px-6 py-16 text-center">
              <p className="text-rc-muted">No listings yet. Add your first one to start its compliance checklist.</p>
              <Link
                href="/dashboard/new"
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-semibold text-white shadow-glow-green transition hover:bg-rc-green-deep-600"
              >
                <Plus size={16} strokeWidth={2.5} /> Add listing
              </Link>
            </div>
          )
        ) : (
          <ListingTabsView
            rows={rows}
            tab={tab}
            query={query}
            status={Object.fromEntries(listingRows.map((l) => [l.id, { flagged: l.flagged, outstanding: l.outstanding }]))}
            viewOnlyIds={viewOnlyIds}
          />
        )}
      </main>
    </>
  );
}
