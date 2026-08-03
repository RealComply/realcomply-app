import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { TopNav } from "@/components/TopNav";
import { STAGE_LABELS, type Property } from "@/lib/types";

export default async function PropertyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: property } = await supabase
    .from("properties")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!property) {
    notFound();
  }

  const p = property as Property;

  return (
    <>
      <TopNav profile={profile} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <Link href="/dashboard" className="text-sm text-neutral-500 hover:underline">
          ← All properties
        </Link>

        <div className="mt-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-rc-ink">{p.address}</h1>
            <p className="mt-1 text-sm text-neutral-500">
              {p.property_type}
              {p.is_strata ? " · Strata" : ""}
              {p.is_tenanted ? " · Tenanted" : ""}
              {p.has_pool ? " · Pool" : ""}
            </p>
          </div>
          <span className="rounded-full bg-rc-green/15 px-3 py-1 text-xs font-medium text-rc-green-deep">
            {STAGE_LABELS[p.stage]}
          </span>
        </div>

        <div className="mt-8 rounded-lg border border-dashed border-rc-border px-6 py-12 text-center text-sm text-neutral-500">
          The stage-by-stage compliance checklist (ported from the prototype, item
          by item) lands here next — this page currently just proves the
          property record itself is real, persisted, and scoped to your agency.
        </div>
      </main>
    </>
  );
}
