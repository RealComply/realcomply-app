import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { TopNav } from "@/components/TopNav";
import { ItemCard } from "@/components/compliance/ItemCard";
import { CompleteStageButton, ExtractDocumentsButton, TestModeToggle } from "@/components/compliance/StageActions";
import { DeletePropertySection } from "@/components/compliance/DeletePropertySection";
import { itemsForStage } from "@/lib/rules/nsw-sales";
import { STAGE_LABELS, type Property, type PropertyItem, type PropertyStage } from "@/lib/types";

export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stage?: string }>;
}) {
  const { id } = await params;
  const { stage: stageParam } = await searchParams;
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

  const { data: propertyItemRows } = await supabase
    .from("property_items")
    .select("*")
    .eq("property_id", id);

  const allItems = Object.fromEntries(
    ((propertyItemRows ?? []) as PropertyItem[]).map((item) => [item.item_key, item]),
  );

  const maxViewable = p.test_mode ? 5 : p.stage;
  const requestedStage = stageParam ? (Number(stageParam) as PropertyStage) : p.stage;
  const viewedStage = (
    Number.isFinite(requestedStage) && requestedStage >= 0 && requestedStage <= maxViewable
      ? requestedStage
      : p.stage
  ) as PropertyStage;

  const stageItems = itemsForStage(viewedStage, p);
  const isCurrentStage = viewedStage === p.stage;
  const fileFinalised = p.stage === 5 && allItems["f1"]?.status === "done";
  const hasSourceDocs = ["a3", "b1", "a4b"].some((key) => allItems[key]?.evidence_path);

  return (
    <>
      <TopNav profile={profile} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <div className="flex items-center justify-between">
          <Link href="/dashboard" className="text-sm font-medium text-rc-muted transition hover:text-rc-green-deep">
            ← All properties
          </Link>
          <TestModeToggle propertyId={p.id} testMode={p.test_mode} />
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-rc-ink">{p.address}</h1>
            <p className="mt-1 text-sm text-rc-muted">
              {p.property_type}
              {p.is_strata ? " · Strata" : ""}
              {p.is_tenanted ? " · Tenanted" : ""}
              {p.has_pool ? " · Pool" : ""}
            </p>
          </div>
          <Link
            href={`/dashboard/${p.id}/summary`}
            className="shrink-0 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-medium text-rc-muted shadow-card transition hover:border-rc-green-deep/40 hover:text-rc-green-deep"
          >
            Download audit pack
          </Link>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {([0, 1, 2, 3, 4, 5] as PropertyStage[]).map((s) => {
            const reachable = s <= maxViewable;
            const active = s === viewedStage;
            return reachable ? (
              <Link
                key={s}
                href={`/dashboard/${p.id}?stage=${s}`}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  active
                    ? "bg-rc-green-deep text-white"
                    : s < p.stage
                      ? "bg-rc-green-soft text-rc-green-deep hover:opacity-80"
                      : "border border-rc-border bg-white text-rc-muted hover:bg-rc-bg-alt"
                }`}
              >
                {STAGE_LABELS[s]}
              </Link>
            ) : (
              <span
                key={s}
                className="rounded-full border border-dashed border-rc-border px-3 py-1 text-xs font-medium text-neutral-300"
              >
                {STAGE_LABELS[s]}
              </span>
            );
          })}
        </div>

        {/* Not stage-gated: extractFromDocuments only ever pre-fills a
            still-open item's aiDraft, or auto-completes a2 specifically
            when the model finds an explicit, dated confirmation — it never
            touches an item that's already done or flagged. So re-reading
            the same attached documents stays safe and useful long after a
            property has moved past Stage 0/1 (e.g. re-checking the agency
            agreement for a2 on a property that's already in Campaign). */}
        {hasSourceDocs && <ExtractDocumentsButton propertyId={p.id} />}

        {fileFinalised && (
          <div className="mt-6 rounded-card border border-rc-green-deep/30 bg-rc-green-soft px-4 py-3 text-sm text-rc-green-deep shadow-card">
            This file is finalised. See the{" "}
            <Link href={`/dashboard/${p.id}/summary`} className="underline">
              finalised summary
            </Link>
            .
          </div>
        )}

        {!isCurrentStage && (
          <div className="mt-6 rounded-2xl border border-rc-border bg-rc-bg-alt px-4 py-2 text-xs text-rc-muted">
            Viewing {STAGE_LABELS[viewedStage]} — the file&rsquo;s current stage is {STAGE_LABELS[p.stage]}.
          </div>
        )}

        <div className="mt-6 space-y-4">
          {stageItems.map((item) => (
            <ItemCard
              key={item.key}
              item={item}
              propertyId={p.id}
              current={allItems[item.key]}
              profile={profile}
              allItems={allItems}
            />
          ))}
        </div>

        {isCurrentStage && p.stage < 5 && <CompleteStageButton propertyId={p.id} stage={p.stage} />}

        {profile.is_licensee_in_charge && <DeletePropertySection propertyId={p.id} address={p.address} />}
      </main>
    </>
  );
}
