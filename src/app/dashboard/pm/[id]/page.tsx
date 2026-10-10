import Link from "next/link";
import { notFound } from "next/navigation";
import { History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { loadPmProperty, loadPmRecords, pmAgencySettings, pmItemDetail, pmPeople, type PmRecordRow } from "@/lib/data/pm";
import { formatAuDate } from "@/lib/format-date";
import {
  PM_COPY,
  pmGround,
  pmGroupLabel,
  pmManagementEndedLabel,
  pmRetentionUntil,
  pmStage,
  type PmWaterAnswers,
} from "@/lib/rules/nsw-pm";
import {
  pmCanRecord,
  pmMoveChecks,
  pmOutgoing,
  pmStageCountLabel,
  pmStageItems,
  pmStageViews,
  type PmStageView,
  type PmTenancyInput,
  type PmTicks,
} from "@/lib/rules/pm-engine";
import { PmStageOvals } from "@/components/pm/PmStageOvals";
import { PmStageSection } from "@/components/pm/PmStageSection";
import { PmItemRow } from "@/components/pm/PmItemRow";
import { PmWaterRow } from "@/components/pm/PmWaterRow";
import { PmMoveControl } from "@/components/pm/PmMoveControl";
import { PmOngoingRecords, PmOpenPetRequests, PmPetApplication, type PmRecordView } from "@/components/pm/PmRecords";
import { PmOutgoingMoveOut } from "@/components/pm/PmOutgoingMoveOut";
import { todayInSydney } from "@/components/pm/pm-dates";

// One PM property (brief A5 to A9, B1 to B8): the pinned header, one oval per
// stage, the move buttons, any outgoing tenant still finishing, then one
// section per stage with its ticks and records.

function stageCount(view: PmStageView): string {
  if (!view.ongoing) return pmStageCountLabel(view);
  if (view.finished) return "Closed";
  if (view.oval.kind === "underWay") return "As it happens";
  return "Starts at move-in";
}

/** "Ended by the landlord: Renovation. Vacate date 1 November 2026." */
function endingLine(t: PmTenancyInput & { vacateDate?: string | null }): string | null {
  if (!t.endedBy) return null;
  const who =
    t.endedBy === "tenant"
      ? "Ended by the tenant."
      : `Ended by the landlord${t.ground ? `: ${pmGround(t.ground).label}` : ""}.`;
  return t.vacateDate ? `${who} Vacate date ${formatAuDate(t.vacateDate)}.` : who;
}

function RetentionNote({ text }: { text: string }) {
  return (
    <p className="mt-3 rounded-lg border border-rc-border bg-white px-3.5 py-2.5 text-[13px] text-rc-ink shadow-card">{text}</p>
  );
}

export default async function PmPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();
  const settings = await pmAgencySettings(supabase, profile.agency_id);
  if (!settings.enabled) notFound();

  const [loaded, people, recordRows] = await Promise.all([
    loadPmProperty(supabase, id),
    pmPeople(supabase),
    loadPmRecords(supabase, id),
  ]);
  if (!loaded) notFound();

  const { property, input, tenancy, tenancies, states } = loaded;
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const name = (uid: string | null | undefined) => (uid ? (nameOf.get(uid) ?? "Someone") : "Someone");
  const viewerName = nameOf.get(profile.id) ?? profile.full_name ?? profile.email;
  const views = pmStageViews(input);
  const moves = pmMoveChecks(input);
  const outgoing = pmOutgoing(input);
  const recordsIn = settings.recordsSystem ?? PM_COPY.recordsFallback;
  const today = todayInSydney();

  const toView = (r: PmRecordRow): PmRecordView => ({
    id: r.id,
    kind: r.kind,
    data: r.data ?? {},
    byName: name(r.recorded_by),
    at: r.recorded_at,
    responseByName: r.response_given_at ? name(r.response_given_by) : null,
    responseAt: r.response_given_at,
  });
  const currentRecords = recordRows.filter((r) => r.tenancy_id === tenancy?.id).map(toView);

  const rowTick = (ticks: PmTicks, key: string) => {
    const t = ticks[key];
    return t && t.state !== "open" ? { state: t.state, byName: name(t.changedBy), at: t.changedAt } : null;
  };

  const water = pmItemDetail(states, tenancy?.id, "water_usage");
  const archived = property.grp === "archived";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <div className="flex items-center justify-between gap-3">
        <Link href="/dashboard/pm" className="text-sm font-medium text-rc-muted transition hover:text-rc-green-deep">
          ← All properties
        </Link>
        <Link
          href={`/dashboard/pm/${property.id}/history`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-rc-green-deep hover:underline"
        >
          <History size={15} aria-hidden="true" />
          History
        </Link>
      </div>

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

      {/* Management has ended (brief B3, B4). */}
      {archived && property.management_ended_on && (
        <div className="mt-4 rounded-card border border-rc-border bg-white px-4 py-3 shadow-card">
          <p className="text-sm font-semibold text-rc-ink">
            Management ended on {formatAuDate(property.management_ended_on)}
            {property.management_ended_reason ? `: ${pmManagementEndedLabel(property.management_ended_reason)}` : ""}.
          </p>
          <p className="mt-1 text-[13px] text-rc-ink">
            {PM_COPY.retentionManagement(formatAuDate(pmRetentionUntil(property.management_ended_on)))}
          </p>
        </div>
      )}

      <PmMoveControl propertyId={property.id} options={moves.map((c) => ({ move: c.move, line: c.line }))} />

      {/* The tenant has moved out of the current tenancy (brief B4). Still shown
          once the management has ended: its reminder is still sent. */}
      {tenancy?.move_out_date && (
        <RetentionNote text={PM_COPY.retentionTenant(formatAuDate(pmRetentionUntil(tenancy.move_out_date)))} />
      )}

      {/* An earlier tenant still finishing, while the next one is let (brief B2). Never locked. */}
      {outgoing.map((o) => {
        const row = tenancies.find((t) => t.id === o.tenancyId);
        const ending = endingLine({ ...o.tenancy, vacateDate: row?.vacate_date });
        const countLabel = o.exit.before ? "" : `${o.exit.done} of ${o.exit.total}${o.exit.na > 0 ? ` (${o.exit.na} N/A)` : ""}`;
        return (
          <PmStageSection
            key={o.tenancyId}
            stage={5}
            anchorId={`outgoing-${o.tenancyId}`}
            number={null}
            title={PM_COPY.outgoingTitle}
            cadence="the previous tenant"
            countLabel={countLabel}
            finished={false}
            locked={false}
            before={false}
            startOpen
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              {ending && <p className="text-[13px] text-rc-muted">{ending}</p>}
              {o.movedOut ? (
                <p className="basis-full text-[13px] text-rc-ink">
                  Moved out {formatAuDate(o.tenancy.moveOutDate)}.{" "}
                  {PM_COPY.retentionTenant(formatAuDate(pmRetentionUntil(o.tenancy.moveOutDate!)))}
                </p>
              ) : (
                <PmOutgoingMoveOut propertyId={property.id} tenancyId={o.tenancyId} />
              )}
            </div>
            <ul className="-mt-px">
              {o.items.map((item, i) => (
                <PmItemRow
                  key={item.key}
                  propertyId={property.id}
                  item={item}
                  tick={rowTick(o.ticks, item.key)}
                  viewerName={viewerName}
                  striped={i % 2 === 1}
                  outgoingTenancyId={o.tenancyId}
                />
              ))}
            </ul>
            <PmOpenPetRequests
              propertyId={property.id}
              records={recordRows.filter((r) => r.tenancy_id === o.tenancyId).map(toView)}
              today={today}
            />
          </PmStageSection>
        );
      })}

      <div className="mt-2">
        {views.map((v) => {
          const stage = pmStage(v.stage);
          const items = pmStageItems(stage, input.tenancy);
          const ending = v.stage === 5 ? endingLine({ ...input.tenancy, vacateDate: tenancy?.vacate_date }) : null;
          return (
            // Keyed by tenancy as well, so nothing a row was showing for one
            // tenancy carries over when re-leasing starts the next one.
            <PmStageSection
              key={`${tenancy?.id ?? "none"}-${v.stage}`}
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
                <PmOngoingRecords
                  propertyId={property.id}
                  records={currentRecords.filter((r) => r.kind !== "pet_application")}
                  canRecord={pmCanRecord(input, "ongoing") === null}
                  canRespond={!archived}
                  note={
                    v.oval.kind === "underWay"
                      ? PM_COPY.ongoingBody(recordsIn)
                      : v.finished
                        ? PM_COPY.ongoingClosed
                        : PM_COPY.ongoingBeforeMoveIn
                  }
                  today={today}
                />
              ) : (
                <>
                  {ending && <p className="px-4 pt-3 text-[13px] text-rc-muted">{ending}</p>}
                  <ul className="-mt-px">
                    {items.map((item, i) =>
                      item.kind === "water" ? (
                        <PmWaterRow
                          key={item.key}
                          propertyId={property.id}
                          item={item}
                          saved={
                            water
                              ? {
                                  state: water.state,
                                  answers: water.detail as PmWaterAnswers,
                                  byName: name(water.changedBy),
                                  at: water.changedAt,
                                }
                              : null
                          }
                          striped={i % 2 === 1}
                        />
                      ) : (
                        <PmItemRow
                          key={item.key}
                          propertyId={property.id}
                          item={item}
                          tick={rowTick(input.ticks, item.key)}
                          viewerName={viewerName}
                          striped={i % 2 === 1}
                        />
                      ),
                    )}
                  </ul>
                  {v.stage === 2 && (
                    <PmPetApplication
                      propertyId={property.id}
                      records={currentRecords.filter((r) => r.kind === "pet_application")}
                      canRecord={pmCanRecord(input, "pet_application") === null}
                    />
                  )}
                </>
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
