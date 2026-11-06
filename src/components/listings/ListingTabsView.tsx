import Link from "next/link";
import { Check, Home as HomeIcon } from "lucide-react";
import type { ListingTabRow } from "@/lib/data/listing-tabs";
import { LISTING_TABS, matchesAddress, reasonLabel, soldLeftLine, type ListingTab } from "@/lib/rules/listing-tabs";
import { formatAuDate } from "@/lib/format-date";
import { sydneyDate } from "@/lib/subscription-end/dates";
import { STAGE_LABELS } from "@/lib/types";

// The Listings page's four tabs and their rows (Job B; mockup v6, Adam's OK,
// 5 Nov 2026). Data in, page out: the page loads the rows
// (lib/data/listing-tabs.ts) and the sidebar's per-listing counts.

export function ListingTabsView({
  rows,
  tab,
  query,
  status,
}: {
  rows: ListingTabRow[];
  tab: ListingTab;
  query: string;
  /** What each listing still needs in its stage, as the sidebar counts it (none on a test listing). */
  status: Record<string, { flagged: number; outstanding: number }>;
}) {
  const countFor = (key: ListingTab) => rows.filter((r) => r.tab === key).length;
  const searchable = tab === "settled" || tab === "withdrawn";
  const shown = rows.filter((r) => r.tab === tab && (!searchable || matchesAddress(r.property.address, query)));
  const statusById = new Map(Object.entries(status));
  return (
    <>
      <nav aria-label="Listings" className="mt-6 flex flex-wrap gap-1.5">
        {LISTING_TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "market" ? "/dashboard" : `/dashboard?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${
              t.key === tab
                ? "border-rc-green-deep bg-rc-green-deep text-white"
                : "border-rc-border bg-white text-rc-muted hover:border-rc-green-deep/40 hover:text-rc-green-deep"
            }`}
          >
            {t.label} ({countFor(t.key)})
          </Link>
        ))}
      </nav>

      {searchable && (
        <form action="/dashboard" className="mt-4">
          <input type="hidden" name="tab" value={tab} />
          <label htmlFor="listing-search" className="sr-only">
            Search by address
          </label>
          <input
            id="listing-search"
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search by address"
            className="w-full max-w-xs rounded-full border border-rc-border bg-white px-4 py-1.5 text-sm"
          />
        </form>
      )}

      {shown.length === 0 ? (
        <p className="mt-6 rounded-card border border-dashed border-rc-border bg-white px-6 py-10 text-center text-sm text-rc-muted">
          {query && searchable ? `No listings here match "${query}".` : "No listings here."}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-rc-border rounded-card border border-rc-border bg-white shadow-card">
          {shown.map((row) => {
            const property = row.property;
            const meta = metaLine(row);
            return (
              <li
                key={property.id}
                // On a phone the pills go under the address and the address
                // wraps (10 Oct 2026). From sm up, one row as before.
                className="flex flex-col gap-2 px-4 py-4 transition hover:bg-rc-bg-alt sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <Link href={`/dashboard/${property.id}`} className="flex min-w-0 items-center gap-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-rc-green-deep ring-1 ring-inset ring-white/70"
                    style={{ background: "var(--rc-badge-grad-green)" }}
                  >
                    <HomeIcon size={16} strokeWidth={2} />
                  </span>
                  <div className="min-w-0">
                    <p className="break-words font-medium text-rc-ink sm:truncate">{property.address}</p>
                    {meta && <p className="text-sm text-rc-muted">{meta}</p>}
                  </div>
                </Link>
                <div className="flex flex-wrap items-center gap-2 pl-12 sm:shrink-0 sm:flex-nowrap sm:pl-0">
                  {row.tab === "market" && (
                    <>
                      {/* What this file still needs, in the stage it is in.
                          Absent on a test listing, which is deliberately not
                          counted anywhere — see nav-counts.ts. */}
                      {(() => {
                        const s = statusById.get(property.id);
                        if (!s) return null;
                        if (s.flagged === 0 && s.outstanding === 0) {
                          return (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rc-green-soft px-2.5 py-1 text-xs font-semibold text-rc-green-deep">
                              <Check size={12} strokeWidth={3} aria-hidden="true" />
                              Stage complete
                            </span>
                          );
                        }
                        return (
                          <>
                            {s.flagged > 0 && (
                              <span className="rounded-full bg-rc-red-soft px-2.5 py-1 text-xs font-semibold text-rc-red">
                                {s.flagged} flagged
                              </span>
                            )}
                            {s.outstanding > 0 && (
                              <span className="rounded-full bg-rc-amber/15 px-2.5 py-1 text-xs font-semibold text-rc-amber-deep">
                                {s.outstanding} to do
                              </span>
                            )}
                          </>
                        );
                      })()}
                      <span className="rounded-full bg-rc-green-soft px-3 py-1 text-xs font-medium text-rc-green-deep shadow-[inset_0_0_0_1px_rgba(12,166,120,0.14)]">
                        {STAGE_LABELS[property.stage]}
                      </span>
                    </>
                  )}
                  {row.tab === "sold" && (
                    <span className="rounded-full border border-rc-amber/30 bg-rc-amber/10 px-3 py-1 text-xs font-semibold text-rc-amber-deep">
                      Sold
                    </span>
                  )}
                  {(row.tab === "settled" || row.tab === "withdrawn") && (
                    <>
                      <span
                        className={`rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold ${
                          row.tab === "withdrawn"
                            ? "border border-dashed border-rc-border text-rc-muted"
                            : "text-rc-ink"
                        }`}
                      >
                        {row.tab === "settled" ? "Settled" : "Withdrawn"}
                      </span>
                      <Link
                        href={`/dashboard/${property.id}/summary`}
                        className="text-sm font-semibold text-rc-green-deep hover:underline"
                      >
                        Audit pack
                      </Link>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 max-w-prose text-sm text-rc-muted">{TAB_HINT[tab]}</p>
    </>
  );
}

/** What each tab is, under its list (the mockup's notes). */
const TAB_HINT: Record<ListingTab, string> = {
  market: "Everything not yet exchanged, from Listing set-up to Campaign.",
  sold: "Exchanged, with settlement cards or the licensee's sign-off still to finish. Moves to Settled once all six stages are complete.",
  settled:
    "All six stages complete and signed off. Opens read only, with every card, document and sign-off. Nothing is deleted.",
  withdrawn: 'Opens read only. "Put back on the market" returns it to On the market.',
};

/** The line under the address: the agent, then what this tab is about. */
function metaLine(row: ListingTabRow): string {
  const p = row.property;
  const parts: (string | null)[] = [row.agentName];
  if (row.tab === "market") {
    parts.push(
      [p.property_type, p.is_strata ? "Strata" : null, p.is_tenanted ? "Tenanted" : null, p.has_pool ? "Pool" : null]
        .filter(Boolean)
        .join(" · ") || null,
    );
  } else if (row.tab === "sold") {
    parts.push(row.settlementDate ? `Settled ${formatAuDate(row.settlementDate)}` : null);
    parts.push(soldLeftLine({ cards: row.cardsLeft, signOff: !row.signedOff }) || null);
  } else if (row.tab === "settled") {
    parts.push(row.settlementDate ? `Settled ${formatAuDate(row.settlementDate)}` : null);
    parts.push(row.signedOffAt ? `Signed off ${formatAuDate(sydneyDate(new Date(row.signedOffAt)))}` : null);
  } else if (row.withdrawal) {
    parts.push(`Withdrawn ${formatAuDate(row.withdrawal.withdrawn_on)}`);
    parts.push(reasonLabel(row.withdrawal.reason, row.withdrawal.reason_other));
  }
  return parts.filter(Boolean).join(" · ");
}
