import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { TopNav } from "@/components/TopNav";
import { computePropertyDigests, daysSinceActivity } from "@/lib/property-digest";
import { expiryStatus } from "@/lib/expiry-status";
import { STAGE_LABELS, type Agency, type Complaint, type Profile, type Property, type PropertyItem } from "@/lib/types";

// Portfolio dashboard — the fuller command-centre from the website IA
// mockup (KPIs, cross-property "needs you" queue, weekly review loop,
// listings table, per-agent supervision row), distinct from the lighter
// Licensee digest at /dashboard/licensee (which stays as the quick
// sign-off/flags check). This is the new default home for a licensee
// running the whole portfolio, not just one file at a time.
export default async function PortfolioPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: properties } = await supabase.from("properties").select("*").order("created_at", { ascending: false });
  const propertyList = (properties ?? []) as Property[];
  const propertyIds = propertyList.map((p) => p.id);

  const [{ data: itemRows }, { data: profileRows }, { data: agencyRow }, { data: complaintRows }] = await Promise.all([
    propertyIds.length > 0
      ? supabase.from("property_items").select("*").in("property_id", propertyIds)
      : Promise.resolve({ data: [] as PropertyItem[] }),
    supabase.from("profiles").select("*"),
    supabase.from("agencies").select("*").eq("id", profile.agency_id).maybeSingle(),
    supabase.from("complaints").select("*").neq("status", "resolved"),
  ]);

  const staffList = (profileRows ?? []) as Profile[];
  const agency = agencyRow as Agency | null;
  const openComplaints = (complaintRows ?? []) as Complaint[];

  const itemsByProperty = new Map<string, Map<string, PropertyItem>>();
  for (const row of (itemRows ?? []) as PropertyItem[]) {
    if (!itemsByProperty.has(row.property_id)) itemsByProperty.set(row.property_id, new Map());
    itemsByProperty.get(row.property_id)!.set(row.item_key, row);
  }

  const agentNames = new Map<string, string>();
  for (const p of staffList) agentNames.set(p.id, p.full_name ?? p.email);

  const digests = computePropertyDigests(propertyList, itemsByProperty);
  const needsYou = digests.filter((d) => d.pendingSignoff.length > 0 || d.flagged.length > 0);
  const dueForReview = digests.filter((d) => {
    const days = daysSinceActivity(d.lastActivityAt);
    return d.property.stage < 5 && (days === null || days > 7);
  });

  const licenceRisk = staffList.filter((s) => {
    const status = expiryStatus(s.licence_expiry);
    return status === "expired" || status === "urgent";
  }).length;
  const piRisk = agency && (expiryStatus(agency.pi_expiry) === "expired" || expiryStatus(agency.pi_expiry) === "urgent") ? 1 : 0;

  // Per-agent supervision row.
  const byAgent = new Map<string, { name: string; properties: number; flags: number; pendingSignoff: number }>();
  for (const d of digests) {
    const id = d.property.created_by;
    if (!byAgent.has(id)) byAgent.set(id, { name: agentNames.get(id) ?? "Unknown agent", properties: 0, flags: 0, pendingSignoff: 0 });
    const row = byAgent.get(id)!;
    row.properties += 1;
    row.flags += d.flagged.length;
    row.pendingSignoff += d.pendingSignoff.length;
  }

  return (
    <>
      <TopNav profile={profile} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-rc-ink">Portfolio</h1>
            <p className="mt-1 text-sm text-neutral-500">The whole agency at a glance — diligence support only, the licensee decides.</p>
          </div>
          <Link href="/dashboard" className="text-sm text-neutral-500 hover:underline">
            All properties →
          </Link>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Tile n={propertyList.length} l="Properties" />
          <Tile n={digests.filter((d) => d.pendingSignoff.length > 0).length} l="Need sign-off" warn />
          <Tile n={digests.filter((d) => d.flagged.length > 0).length} l="Flagged" warn />
          <Tile n={licenceRisk + piRisk} l="Licence/PI at risk" warn={licenceRisk + piRisk > 0} ok={licenceRisk + piRisk === 0} />
          <Tile n={openComplaints.length} l="Open complaints" warn={openComplaints.length > 0} ok={openComplaints.length === 0} />
        </div>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-rc-ink">
            Needs you {needsYou.length > 0 && `(${needsYou.length})`}
          </h2>
          {needsYou.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">Nothing needs your attention right now.</p>
          ) : (
            <ul className="mt-2 divide-y divide-rc-border rounded-lg border border-rc-border">
              {needsYou.map((d) => (
                <li key={d.property.id} className="px-4 py-3">
                  <Link href={`/dashboard/${d.property.id}`} className="font-medium text-rc-ink hover:underline">
                    {d.property.address}
                  </Link>
                  <span className="ml-2 text-xs text-neutral-400">
                    {STAGE_LABELS[d.property.stage]} · {agentNames.get(d.property.created_by) ?? "Unknown agent"}
                  </span>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {[...d.pendingSignoff, ...d.flagged].map((item, i) => (
                      <li key={`${item.key}-${i}`} className="rounded-full bg-rc-amber/15 px-2.5 py-0.5 text-xs font-medium text-rc-amber-deep">
                        {item.label}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-rc-ink">
            Due for weekly review {dueForReview.length > 0 && `(${dueForReview.length})`}
          </h2>
          <p className="mt-1 text-xs text-neutral-500">Files with no activity in the last 7 days — worth a check-in.</p>
          {dueForReview.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">Every active file has had activity this week.</p>
          ) : (
            <ul className="mt-2 divide-y divide-rc-border rounded-lg border border-rc-border">
              {dueForReview.map((d) => {
                const days = daysSinceActivity(d.lastActivityAt);
                return (
                  <li key={d.property.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <Link href={`/dashboard/${d.property.id}`} className="font-medium text-rc-ink hover:underline">
                      {d.property.address}
                    </Link>
                    <span className="text-xs text-neutral-400">{days === null ? "No activity yet" : `${days} days since last activity`}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-rc-ink">Listings</h2>
          <ul className="mt-2 divide-y divide-rc-border rounded-lg border border-rc-border">
            {digests.map((d) => (
              <li key={d.property.id}>
                <Link href={`/dashboard/${d.property.id}`} className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-neutral-50">
                  <div>
                    <p className="font-medium text-rc-ink">{d.property.address}</p>
                    <p className="text-xs text-neutral-400">
                      {STAGE_LABELS[d.property.stage]} · {agentNames.get(d.property.created_by) ?? "Unknown agent"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs">
                    <span className="text-neutral-500">
                      {d.doneCurrentStage.length}/{d.requiredCurrentStage.length} done this stage
                    </span>
                    {d.pendingSignoff.length > 0 && (
                      <span className="rounded-full bg-rc-amber/15 px-2 py-0.5 font-medium text-rc-amber-deep">
                        {d.pendingSignoff.length} awaiting sign-off
                      </span>
                    )}
                    {d.flagged.length > 0 && (
                      <span className="rounded-full bg-rc-amber/15 px-2 py-0.5 font-medium text-rc-amber-deep">{d.flagged.length} flagged</span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-rc-ink">Per-agent supervision</h2>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-rc-border text-left text-xs uppercase tracking-wide text-neutral-400">
                <th className="pb-2 pr-3">Agent</th>
                <th className="pb-2 pr-3">Properties</th>
                <th className="pb-2 pr-3">Flags</th>
                <th className="pb-2">Pending sign-off</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(byAgent.values()).map((row) => (
                <tr key={row.name} className="border-b border-neutral-100">
                  <td className="py-2 pr-3 font-medium text-rc-ink">{row.name}</td>
                  <td className="py-2 pr-3">{row.properties}</td>
                  <td className="py-2 pr-3">{row.flags}</td>
                  <td className="py-2">{row.pendingSignoff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}

function Tile({ n, l, ok, warn }: { n: number; l: string; ok?: boolean; warn?: boolean }) {
  const color = warn && n > 0 ? "text-rc-amber-deep" : ok ? "text-rc-green-deep" : "text-rc-ink";
  return (
    <div className="rounded-lg border border-rc-border bg-white p-3">
      <div className={`text-xl font-bold ${color}`}>{n}</div>
      <div className="mt-0.5 text-[11px] font-medium text-neutral-500">{l}</div>
    </div>
  );
}
