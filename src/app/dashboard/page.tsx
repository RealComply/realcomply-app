import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { TopNav } from "@/components/TopNav";
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
      <TopNav profile={profile} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-rc-ink">Your properties</h1>
          <Link
            href="/dashboard/new"
            className="rounded-md bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
          >
            + Add property
          </Link>
        </div>

        {list.length === 0 ? (
          <div className="mt-10 rounded-lg border border-dashed border-rc-border px-6 py-16 text-center">
            <p className="text-neutral-500">
              No properties yet. Add your first listing to start the compliance checklist.
            </p>
            <Link
              href="/dashboard/new"
              className="mt-4 inline-block rounded-md bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            >
              + Add property
            </Link>
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-rc-border rounded-lg border border-rc-border">
            {list.map((property) => (
              <li key={property.id}>
                <Link
                  href={`/dashboard/${property.id}`}
                  className="flex items-center justify-between px-4 py-4 transition hover:bg-neutral-50"
                >
                  <div>
                    <p className="font-medium text-rc-ink">{property.address}</p>
                    <p className="text-sm text-neutral-500">
                      {property.property_type}
                      {property.is_strata ? " · Strata" : ""}
                      {property.is_tenanted ? " · Tenanted" : ""}
                      {property.has_pool ? " · Pool" : ""}
                    </p>
                  </div>
                  <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-600">
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
