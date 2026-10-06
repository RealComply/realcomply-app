import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { loadPmProperty, pmAgencySettings, pmPeople } from "@/lib/data/pm";
import { PM_COPY, pmGroupLabel, pmStage } from "@/lib/rules/nsw-pm";
import { pmBlockedLine, pmMoveCheck, pmStageCountLabel, pmStageViews, type PmStageView } from "@/lib/rules/pm-engine";
import { PmStageOvals } from "@/components/pm/PmStageOvals";
import { PmStageSection } from "@/components/pm/PmStageSection";
import { PmItemRow } from "@/components/pm/PmItemRow";
import { PmMoveControl } from "@/components/pm/PmMoveControl";

// One PM property (brief A5 to A9): the pinned header, one oval per stage, the
// move button, then one section per stage with its ticks.

function stageCount(view: PmStageView): string {
  if (!view.ongoing) return pmStageCountLabel(view);
  if (view.finished) return "Closed";
  if (view.oval.kind === "underWay") return "As it happens";
  return "Starts at move-in";
}

export default async function PmPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();
  const settings = await pmAgencySettings(supabase, profile.agency_id);
  if (!settings.enabled) notFound();

  const [loaded, people] = await Promise.all([loadPmProperty(supabase, id), pmPeople(supabase)]);
  if (!loaded) notFound();

  const { property, input } = loaded;
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const viewerName = nameOf.get(profile.id) ?? profile.full_name ?? profile.email;
  const views = pmStageViews(input);
  const move = pmMoveCheck(input);
  const recordsIn = settings.recordsSystem ?? PM_COPY.recordsFallback;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <Link href="/dashboard/pm" className="text-sm font-medium text-rc-muted transition hover:text-rc-green-deep">
        ← All properties
      </Link>

      {/* Pinned while scrolling, the way the sales property header is: the
          address and the group, and on a computer the ovals with them. On a
          phone only the address and group stay pinned (brief A5). */}
      <div className="sticky top-[var(--rc-userbar-h,0px)] z-10 -mx-4 mt-3 border-b border-rc-border bg-rc-bg-alt/90 px-4 py-3 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="min-w-0 text-xl font-bold tracking-tight text-rc-ink sm:text-2xl">{property.address}</h1>
          <span className="rounded-full border border-rc-green-deep bg-rc-green-soft px-2.5 py-0.5 text-xs font-semibold text-rc-green-deep">
            {pmGroupLabel(property.grp)}
          </span>
        </div>
        <div className="mt-3 hidden md:block">
          <PmStageOvals stages={views} />
        </div>
      </div>

      <p className="mt-3 text-sm text-rc-muted">
        Property manager: {nameOf.get(property.manager_id) ?? "not set"}. Records are kept in{" "}
        <b className="font-semibold text-rc-ink">{recordsIn}</b>.
      </p>

      <div className="mt-3 md:hidden">
        <PmStageOvals stages={views} />
      </div>

      {move && (
        <PmMoveControl propertyId={property.id} move={move.move} blockedLine={pmBlockedLine(move.blockedBy)} />
      )}

      <div className="mt-2">
        {views.map((v) => {
          const stage = pmStage(v.stage);
          return (
            <PmStageSection
              key={v.stage}
              stage={v.stage}
              number={v.displayNumber}
              title={v.title}
              cadence={v.cadence}
              countLabel={stageCount(v)}
              finished={v.finished}
              locked={v.locked}
              before={v.before}
              startOpen={!v.finished && !(v.ongoing && v.oval.kind === "notStarted")}
            >
              {v.ongoing ? (
                <p className="px-4 py-3 text-[13px] text-rc-muted">
                  {v.oval.kind === "underWay" ? PM_COPY.ongoingBody(recordsIn) : PM_COPY.ongoingBeforeMoveIn}
                </p>
              ) : (
                <ul className="-mt-px">
                  {stage.items.map((item, i) => {
                    const t = input.ticks[item.key];
                    const tick =
                      t && t.state !== "open"
                        ? { state: t.state, byName: nameOf.get(t.changedBy) ?? "Someone", at: t.changedAt }
                        : null;
                    return (
                      <PmItemRow
                        key={item.key}
                        propertyId={property.id}
                        item={item}
                        tick={tick}
                        viewerName={viewerName}
                        striped={i % 2 === 1}
                      />
                    );
                  })}
                </ul>
              )}
            </PmStageSection>
          );
        })}
      </div>

      <p className="mt-8 max-w-[72ch] text-[13px] text-rc-muted">
        RealComply holds no documents here. Each tick records who confirmed it and when, and the record itself stays in{" "}
        {recordsIn}. Diligence support only. The licensee decides.
      </p>
    </main>
  );
}
