import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { TopNav } from "@/components/TopNav";
import { allItemsFor, type ComplianceItem } from "@/lib/rules/nsw-sales";
import { expiryStatus } from "@/lib/expiry-status";
import { STAGE_LABELS, type Agency, type Profile, type Property, type PropertyItem } from "@/lib/types";

// The licensee digest — "at a glance across every file," the in-app version
// of the two-tier Monday status email idea from the product brief (per-agent
// + licensee digest). Everyone in the agency can open this (properties are
// already agency-wide visible, and agents benefit from seeing what's stuck
// waiting on the licensee), but the two things a licensee actually needs —
// what's waiting on their sign-off, and what's been flagged — are surfaced
// first rather than buried in a per-property view. Read-only: acting on any
// item still happens on the property's own page, where the existing
// licenseeOnly gating (see compliance.ts) already stops anyone else signing
// on the licensee's behalf.
export default async function LicenseeDigestPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: properties } = await supabase
    .from("properties")
    .select("*")
    .order("created_at", { ascending: false });

  const propertyList = (properties ?? []) as Property[];
  const propertyIds = propertyList.map((p) => p.id);

  const [{ data: itemRows }, { data: profileRows }, { data: agencyRow }] = await Promise.all([
    propertyIds.length > 0
      ? supabase.from("property_items").select("*").in("property_id", propertyIds)
      : Promise.resolve({ data: [] as PropertyItem[] }),
    supabase.from("profiles").select("*"),
    supabase.from("agencies").select("*").eq("id", profile.agency_id).maybeSingle(),
  ]);

  const staffList = (profileRows ?? []) as Profile[];
  const agency = agencyRow as Agency | null;
  const expiringStaff = staffList.filter((s) => {
    const status = expiryStatus(s.licence_expiry);
    return status === "expired" || status === "urgent";
  });
  const piConcern = agency ? expiryStatus(agency.pi_expiry) : "none";

  const itemsByProperty = new Map<string, Map<string, PropertyItem>>();
  for (const row of (itemRows ?? []) as PropertyItem[]) {
    if (!itemsByProperty.has(row.property_id)) itemsByProperty.set(row.property_id, new Map());
    itemsByProperty.get(row.property_id)!.set(row.item_key, row);
  }

  const agentNames = new Map<string, string>();
  for (const p of (profileRows ?? []) as Profile[]) {
    agentNames.set(p.id, p.full_name ?? p.email);
  }

  type PropertyDigest = {
    property: Property;
    agentName: string;
    pendingSignoff: ComplianceItem[];
    flagged: ComplianceItem[];
    requiredCurrentStage: ComplianceItem[];
    doneCurrentStage: ComplianceItem[];
  };

  const digests: PropertyDigest[] = propertyList.map((property) => {
    const rows = itemsByProperty.get(property.id) ?? new Map<string, PropertyItem>();
    // Only items in stages the file has actually reached — anything further
    // out hasn't been started yet, so it's not meaningfully "pending" or
    // "flagged," it just hasn't come up.
    const reached = allItemsFor(property).filter((i) => i.stage <= property.stage);

    const pendingSignoff = reached.filter((i) => i.licenseeOnly && rows.get(i.key)?.status !== "done");
    const flagged = reached.filter((i) => rows.get(i.key)?.status === "flagged");
    const requiredCurrentStage = reached.filter(
      (i) => i.stage === property.stage && i.requiredForStageCompletion,
    );
    const doneCurrentStage = requiredCurrentStage.filter((i) => rows.get(i.key)?.status === "done");

    return {
      property,
      agentName: agentNames.get(property.created_by) ?? "Unknown agent",
      pendingSignoff,
      flagged,
      requiredCurrentStage,
      doneCurrentStage,
    };
  });

  const awaitingSignoff = digests.filter((d) => d.pendingSignoff.length > 0);
  const withFlags = digests.filter((d) => d.flagged.length > 0);

  return (
    <>
      <TopNav profile={profile} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Licensee digest</h1>
            <p className="mt-1 text-sm text-rc-muted">
              What&rsquo;s waiting on sign-off and what&rsquo;s been flagged, across every file — diligence support
              only, the licensee still decides.
            </p>
          </div>
          <Link href="/dashboard" className="text-sm font-medium text-rc-muted transition hover:text-rc-green-deep">
            ← All properties
          </Link>
        </div>

        {!profile.is_licensee_in_charge && (
          <p className="mt-4 rounded-md border border-rc-border bg-neutral-50 px-3 py-2 text-xs text-rc-muted">
            You&rsquo;re viewing this as an agent, not the licensee in charge — the sign-off items below need the
            licensee&rsquo;s action, not yours.
          </p>
        )}

        {(expiringStaff.length > 0 || piConcern === "expired" || piConcern === "urgent") && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold text-rc-ink">Licences &amp; insurance</h2>
            <ul className="mt-2 divide-y divide-rc-border rounded-card border border-rc-border bg-white shadow-card">
              {(piConcern === "expired" || piConcern === "urgent") && (
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
            Needs sign-off {awaitingSignoff.length > 0 && `(${awaitingSignoff.length})`}
          </h2>
          {awaitingSignoff.length === 0 ? (
            <p className="mt-2 text-sm text-rc-muted">Nothing waiting on a licensee sign-off right now.</p>
          ) : (
            <ul className="mt-2 divide-y divide-rc-border rounded-card border border-rc-border bg-white shadow-card">
              {awaitingSignoff.map((d) => (
                <li key={d.property.id} className="px-4 py-3">
                  <Link
                    href={`/dashboard/${d.property.id}`}
                    className="font-medium text-rc-ink hover:underline"
                  >
                    {d.property.address}
                  </Link>
                  <span className="ml-2 text-xs text-rc-faint">
                    {STAGE_LABELS[d.property.stage]} · {d.agentName}
                  </span>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {d.pendingSignoff.map((item) => (
                      <li
                        key={item.key}
                        className="rounded-full bg-rc-amber/15 px-2.5 py-0.5 text-xs font-medium text-rc-amber-deep"
                      >
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
            Flagged {withFlags.length > 0 && `(${withFlags.length})`}
          </h2>
          {withFlags.length === 0 ? (
            <p className="mt-2 text-sm text-rc-muted">No flags on any file right now.</p>
          ) : (
            <ul className="mt-2 divide-y divide-rc-border rounded-card border border-rc-border bg-white shadow-card">
              {withFlags.map((d) => (
                <li key={d.property.id} className="px-4 py-3">
                  <Link
                    href={`/dashboard/${d.property.id}`}
                    className="font-medium text-rc-ink hover:underline"
                  >
                    {d.property.address}
                  </Link>
                  <span className="ml-2 text-xs text-rc-faint">
                    {STAGE_LABELS[d.property.stage]} · {d.agentName}
                  </span>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {d.flagged.map((item) => (
                      <li
                        key={item.key}
                        className="rounded-full bg-rc-amber/15 px-2.5 py-0.5 text-xs font-medium text-rc-amber-deep"
                      >
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
          <h2 className="text-sm font-semibold text-rc-ink">All properties</h2>
          {digests.length === 0 ? (
            <p className="mt-2 text-sm text-rc-muted">No properties yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-rc-border rounded-card border border-rc-border bg-white shadow-card">
              {digests.map((d) => (
                <li key={d.property.id}>
                  <Link
                    href={`/dashboard/${d.property.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-neutral-50"
                  >
                    <div>
                      <p className="font-medium text-rc-ink">{d.property.address}</p>
                      <p className="text-xs text-rc-faint">
                        {STAGE_LABELS[d.property.stage]} · {d.agentName}
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
                        <span className="rounded-full bg-rc-amber/15 px-2 py-0.5 font-medium text-rc-amber-deep">
                          {d.flagged.length} flagged
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
