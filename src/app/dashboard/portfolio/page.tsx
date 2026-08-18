import Link from "next/link";
import { Building2, ClipboardCheck, Flag, ShieldCheck, MessageSquareWarning } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { StatTile } from "@/components/home/WidgetCard";
import { computePropertyDigests, daysSinceActivity } from "@/lib/property-digest";
import { expiryStatus } from "@/lib/expiry-status";
import { STAGE_LABELS, type Agency, type Complaint, type Profile, type Property, type PropertyItem } from "@/lib/types";

// Office overview — the command-centre from the website IA mockup (KPIs,
// cross-property "needs you" queue, weekly review loop, listings table,
// per-agent supervision row). This used to be split across two pages
// ("Portfolio" here + a separate "Licensee digest" at /dashboard/licensee),
// but in practice they showed almost the same thing — sign-off/flags across
// every file — just with different framing. Per Adam: "they're basically
// showing the same thing... condense them into one page and just call it
// office overview." This is that merge: the licensee digest's named
// "who exactly is expiring" list and its agent-viewing note are folded in
// below, and /dashboard/licensee now just redirects here.
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
  const needsYou = digests.filter(
    (d) => d.pendingSignoff.length > 0 || d.flagged.length > 0 || d.awaiting.length > 0,
  );
  const dueForReview = digests.filter((d) => {
    const days = daysSinceActivity(d.lastActivityAt);
    return d.property.stage < 5 && (days === null || days > 7);
  });

  // Named, not just counted — "4 at risk" tells you there's a problem,
  // but the licensee needs to know whose licence it is without a second
  // click. This is the bit the old /dashboard/licensee page had that this
  // page's stat tile alone didn't.
  const expiringStaff = staffList.filter((s) => {
    const status = expiryStatus(s.licence_expiry);
    return status === "expired" || status === "urgent";
  });
  const licenceRisk = expiringStaff.length;
  const piConcern = agency ? expiryStatus(agency.pi_expiry) : "none";
  const piRisk = piConcern === "expired" || piConcern === "urgent" ? 1 : 0;

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
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        {/* px-3 matches gap-3 on the tile grid below, so the outer edges get
            the same breathing room as the gaps between tiles instead of the
            first and last tile sitting flush against the band. Home has had
            this since 9 Aug 2026 (Adam raised it there first); this page was
            built from the same shape but never picked the fix up, which is why
            the two looked subtly different side by side. */}
        <div className="relative isolate overflow-hidden rounded-card px-3">
          <div className="rc-mesh-bg" />
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Office overview</h1>
              <p className="mt-1 text-sm text-rc-muted">The whole agency at a glance — diligence support only, the licensee decides.</p>
            </div>
            <Link href="/dashboard" className="text-sm font-medium text-rc-muted transition hover:text-rc-green-deep">
              All listings →
            </Link>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatTile n={propertyList.length} l="Listings" icon={Building2} />
            <StatTile
              n={digests.filter((d) => d.pendingSignoff.length > 0).length}
              l="Need sign-off"
              tone={digests.filter((d) => d.pendingSignoff.length > 0).length > 0 ? "warn" : "ok"}
              icon={ClipboardCheck}
            />
            <StatTile
              n={digests.filter((d) => d.flagged.length > 0).length}
              l="Flagged"
              tone={digests.filter((d) => d.flagged.length > 0).length > 0 ? "warn" : "ok"}
              icon={Flag}
            />
            <StatTile n={licenceRisk + piRisk} l="Licence/PI at risk" tone={licenceRisk + piRisk > 0 ? "warn" : "ok"} icon={ShieldCheck} />
            <StatTile n={openComplaints.length} l="Open complaints" tone={openComplaints.length > 0 ? "warn" : "ok"} icon={MessageSquareWarning} />
          </div>
        </div>

        {!profile.is_licensee_in_charge && (
          <p className="mt-4 rounded-md border border-rc-border bg-neutral-50 px-3 py-2 text-xs text-rc-muted">
            You&rsquo;re viewing this as an agent, not the licensee in charge — the sign-off items below need the
            licensee&rsquo;s action, not yours.
          </p>
        )}

        {(expiringStaff.length > 0 || piRisk > 0) && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold text-rc-ink">Licences &amp; insurance</h2>
            <ul className="mt-2 divide-y divide-rc-border rounded-card border border-rc-border bg-white shadow-card">
              {piRisk > 0 && (
                <li className="px-4 py-3 text-sm">
                  <Link href="/dashboard/registers" className="font-medium text-rc-ink hover:underline">
                    PI insurance
                  </Link>{" "}
                  <span className="text-rc-amber-deep">
                    {piConcern === "expired" ? "expired" : "expires within 30 days"}
                  </span>
                </li>
              )}
              {expiringStaff.map((s) => (
                <li key={s.id} className="px-4 py-3 text-sm">
                  <Link href="/dashboard/registers" className="font-medium text-rc-ink hover:underline">
                    {s.full_name ?? s.email}
                  </Link>{" "}
                  <span className="text-rc-amber-deep">
                    licence {expiryStatus(s.licence_expiry) === "expired" ? "expired" : "expires within 30 days"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-rc-ink">
            Needs you {needsYou.length > 0 && `(${needsYou.length})`}
          </h2>
          {needsYou.length === 0 ? (
            <p className="mt-2 text-sm text-rc-muted">Nothing needs your attention right now.</p>
          ) : (
            <ul className="mt-2 divide-y divide-rc-border rounded-card border border-rc-border bg-white shadow-card">
              {needsYou.map((d) => (
                <li key={d.property.id} className="px-4 py-3">
                  <Link href={`/dashboard/${d.property.id}`} className="font-medium text-rc-ink hover:underline">
                    {d.property.address}
                  </Link>
                  <span className="ml-2 text-xs text-rc-faint">
                    {STAGE_LABELS[d.property.stage]} · {agentNames.get(d.property.created_by) ?? "Unknown agent"}
                  </span>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {[...d.pendingSignoff, ...d.flagged, ...d.awaiting].map((item, i) => (
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
          <p className="mt-1 text-xs text-rc-muted">Files with no activity in the last 7 days — worth a check-in.</p>
          {dueForReview.length === 0 ? (
            <p className="mt-2 text-sm text-rc-muted">Every active file has had activity this week.</p>
          ) : (
            <ul className="mt-2 divide-y divide-rc-border rounded-card border border-rc-border bg-white shadow-card">
              {dueForReview.map((d) => {
                const days = daysSinceActivity(d.lastActivityAt);
                return (
                  <li key={d.property.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <Link href={`/dashboard/${d.property.id}`} className="font-medium text-rc-ink hover:underline">
                      {d.property.address}
                    </Link>
                    <span className="text-xs text-rc-faint">{days === null ? "No activity yet" : `${days} days since last activity`}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-rc-ink">Listings</h2>
          <ul className="mt-2 divide-y divide-rc-border rounded-card border border-rc-border bg-white shadow-card">
            {digests.map((d) => (
              <li key={d.property.id}>
                <Link href={`/dashboard/${d.property.id}`} className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-neutral-50">
                  <div>
                    <p className="font-medium text-rc-ink">{d.property.address}</p>
                    <p className="text-xs text-rc-faint">
                      {STAGE_LABELS[d.property.stage]} · {agentNames.get(d.property.created_by) ?? "Unknown agent"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs">
                    <span className="text-rc-muted">
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
              <tr className="border-b border-rc-border text-left text-xs uppercase tracking-wide text-rc-faint">
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
