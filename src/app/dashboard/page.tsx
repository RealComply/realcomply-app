import Link from "next/link";
import { Home as HomeIcon, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { STAGE_LABELS, type Property } from "@/lib/types";

export default async function DashboardPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: properties } = await supabase
    .from("properties")
    .select("*")
    .order("created_at", { ascending: false });

  const list = (properties ?? []) as Property[];

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
              {list.length === 0
                ? "Every listing you're running, and where each one is up to."
                : `${list.length} listing${list.length === 1 ? "" : "s"} — open one to work through its checklist.`}
            </p>
          </div>
          <Link
            href="/dashboard/new"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-semibold text-white shadow-glow-green transition hover:bg-rc-green-deep-600"
          >
            <Plus size={16} strokeWidth={2.5} /> Add listing
          </Link>
        </div>

        {list.length === 0 ? (
          <div className="mt-10 rounded-card border border-dashed border-rc-border bg-white px-6 py-16 text-center">
            <p className="text-rc-muted">No listings yet. Add your first one to start its compliance checklist.</p>
            <Link
              href="/dashboard/new"
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-semibold text-white shadow-glow-green transition hover:bg-rc-green-deep-600"
            >
              <Plus size={16} strokeWidth={2.5} /> Add listing
            </Link>
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-rc-border rounded-card border border-rc-border bg-white shadow-card">
            {list.map((property) => (
              <li key={property.id}>
                <Link
                  href={`/dashboard/${property.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-4 transition hover:bg-rc-bg-alt"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-rc-green-deep ring-1 ring-inset ring-white/70"
                      style={{ background: "var(--rc-badge-grad-green)" }}
                    >
                      <HomeIcon size={16} strokeWidth={2} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-rc-ink">{property.address}</p>
                      <p className="text-sm text-rc-muted">
                        {property.property_type}
                        {property.is_strata ? " · Strata" : ""}
                        {property.is_tenanted ? " · Tenanted" : ""}
                        {property.has_pool ? " · Pool" : ""}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-rc-green-soft px-3 py-1 text-xs font-medium text-rc-green-deep shadow-[inset_0_0_0_1px_rgba(12,166,120,0.14)]">
                    {STAGE_LABELS[property.stage]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
