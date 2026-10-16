import Link from "next/link";
import { Building2, FileWarning, ShieldCheck, MessageSquareWarning, Gift as GiftIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/data/current-profile";
import { agencyPeople } from "@/lib/data/people";
import { AgentHome } from "./AgentHome";
import { computePropertyDigests, daysSinceActivity } from "@/lib/property-digest";
import { expiryStatus } from "@/lib/expiry-status";
import { currentCpdYear } from "@/lib/cpd-year";
import { StatTile } from "@/components/home/WidgetCard";
import { NeedsAttentionWidget, type NeedsAttentionItem } from "@/components/home/NeedsAttentionWidget";
import { WeeklyReviewWidget } from "@/components/home/WeeklyReviewWidget";
import { TeamWidget } from "@/components/home/TeamWidget";
import { LicenceCpdWidget } from "@/components/home/LicenceCpdWidget";
import { PiInsuranceWidget } from "@/components/home/PiInsuranceWidget";
import { GiftsWidget } from "@/components/home/GiftsWidget";
import { ComplaintsWidget } from "@/components/home/ComplaintsWidget";
import { TrainingWidget } from "@/components/home/TrainingWidget";
import { SgManualWidget } from "@/components/home/SgManualWidget";
import { AnnexureCard } from "@/components/home/AnnexureCard";
import { FairTradingCard, NewLicenseeAnnexureCard } from "@/components/home/LicenseeChangeCards";
import { fairTradingDueSentence, fairTradingReminder, type LicenseeHistoryLine } from "@/lib/licensee-history";
import { sydneyDate } from "@/lib/subscription-end/dates";
import { licenseeChangeStatus } from "@/lib/data/licensee-change";
import { AgentAnnexureCard } from "@/components/home/AgentAnnexureCard";
import { licenseeNameFor, listingGate } from "@/lib/data/listing-gate";
import { SG_ANNEXURE_VERSION } from "@/lib/legal/sg-annexure";
import { STAGE_LABELS, type Agency, type Complaint, type Gift, type Profile, type Property, type PropertyItem, type SgManualVersion, type TrainingSession } from "@/lib/types";
import { isOfficeAgent, myConfirmedVersions, officeAdoption, sgReadDue } from "@/lib/sg-annexure/office-read";

// Home — the single consolidated landing dashboard a licensee sees after
// login, replacing "check five different pages" with one page of widgets
// (per Adam: "everything should be on 1 customisable dashboard, similar to
// what propertyme does"). Scoping decisions from the two clarifying
// questions: (1) fixed layout for v1, but built as a grid of independent,
// self-contained widget components ("1 and 3") so drag-and-drop reordering
// can be layered on later without a rebuild; (2) this is a NEW page — the
// existing Portfolio/Registers/Training/SG Manual pages stay exactly as they
// are, each still reachable from the nav ("new home page, keep the others").
//
// Deliberately does NOT copy PropertyMe's visual/typographic style — it
// reuses RealComply's own existing design tokens (rc-ink/rc-green-deep/
// rc-amber, the app's Plus Jakarta Sans type scale) already used on the
// Portfolio and Registers pages. Only the structural pattern (stat-tile row
// + card grid of metric/breakdown widgets, colour-coded by status) is
// borrowed, not the look.
export default async function HomeDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { profile, access } = await requireAccess();
  const supabase = await createClient();

  // REVERSAL (Adam, 7 Oct 2026): an agent's and an assistant's Home is their
  // own work. Everything below this line is the licensee's office view.
  if (!access.actsAsLicensee) {
    // An agent in an office reads and ticks the annexure and the Supervision
    // Guidelines once the office has adopted it (brief, 14 Oct 2026). Only on
    // a clean read: if their confirmations can't be read, no card.
    let sgReadShows = false;
    if (isOfficeAgent(access)) {
      const [adoption, confirmedVersions] = await Promise.all([
        officeAdoption(supabase),
        myConfirmedVersions(supabase, profile.id),
      ]);
      sgReadShows =
        confirmedVersions !== null && sgReadDue({ officeAgent: true, adoption, confirmedVersions });
    }
    return <AgentHome supabase={supabase} profile={profile} sgReadShows={sgReadShows} />;
  }

  const cpdYear = currentCpdYear();

  // Until the annexure is adopted (brief, 14 Oct 2026), the Home of an
  // office's licensee in charge asks for it. Shown only on a clean read that
  // finds no adoption of this version: if the table can't be read, no card,
  // rather than a button that leads nowhere. Never on an agent plan
  // (CORRECTION, Adam, 14 Oct 2026, restoring the 22 Sep 2026 rule): nothing
  // asks an agent on their own plan to get the annexure signed.
  const [{ data: adoptionRows, error: adoptionError }, query] = await Promise.all([
    supabase.from("sg_annexure_adoptions").select("id").eq("annexure_version", SG_ANNEXURE_VERSION),
    searchParams,
  ]);
  // After a change of licensee in charge (0080): the new licensee tells Fair
  // Trading, and adopts the annexure themselves before the office adds new
  // listings. Both only on a clean read; no card if the history can't be read
  // (before 0080 has run).
  const todayIso = sydneyDate(new Date());
  const [{ data: myLineRows }, changeStatus] = access.officeLicensee
    ? await Promise.all([
        supabase
          .from("licensee_in_charge_history")
          .select("*")
          .eq("profile_id", profile.id)
          .is("ended_at", null)
          .order("recorded_at", { ascending: false })
          .limit(1),
        licenseeChangeStatus(supabase),
      ])
    : [{ data: null }, null];
  const myLine = ((myLineRows ?? []) as LicenseeHistoryLine[])[0] ?? null;
  const fairTrading = fairTradingReminder(myLine, todayIso);
  // With no earlier adoption on file there is no one to name: the usual
  // annexure card asks instead.
  const newLicenseeAnnexureFrom =
    changeStatus?.annexurePending && changeStatus.previousAdopter ? changeStatus.previousAdopter : null;
  const annexureOutstanding =
    access.officeLicensee && !adoptionError && (adoptionRows ?? []).length === 0 && !newLicenseeAnnexureFrom;

  // An agent on their own plan whose office has the annexure lock on (job 7
  // brief, Part 3; 0071): "get your licensee's sign-off", until the signed
  // annexure is uploaded. Offices that existed before the lock never see it
  // unless RealComply switches theirs on.
  let agentAnnexure: { licenseeName: string | null; downloadHref: string } | null = null;
  if (access.isAgentPlan && (await listingGate(supabase)) === "signed_annexure") {
    const [licenseeName, { data: tokenRow }] = await Promise.all([
      licenseeNameFor(supabase, profile.agency_id, { agentPlan: true }),
      supabase.from("agencies").select("annexure_download_token").eq("id", profile.agency_id).maybeSingle(),
    ]);
    const token = (tokenRow as { annexure_download_token?: string | null } | null)?.annexure_download_token;
    agentAnnexure = {
      licenseeName,
      downloadHref: token ? `/annexure/download/${encodeURIComponent(token)}` : "/annexure/download",
    };
  }

  const { data: properties } = await supabase.from("properties").select("*").order("created_at", { ascending: false });
  const propertyList = (properties ?? []) as Property[];

  // Files an assistant has handed to THIS person. Scoped to the reader: a
  // licensee sees the ones on their own listings here, and the office-wide
  // picture on the Monday digest and the portfolio page rather than in a
  // personal to-do list.
  const awaitingMyReview = propertyList.filter(
    (prop) => prop.review_requested_at && prop.created_by === profile.id,
  );
  const propertyIds = propertyList.map((p) => p.id);

  const [
    { data: itemRows },
    { data: staffRows },
    { data: agencyRow },
    { data: giftRows },
    { data: complaintRows },
    { data: sessionRows },
    { data: sgVersionRows },
    { data: pendingInviteRows },
    { data: cpdSignoffRows },
  ] = await Promise.all([
    propertyIds.length > 0
      ? supabase.from("property_items").select("*").in("property_id", propertyIds)
      : Promise.resolve({ data: [] as PropertyItem[] }),
    supabase.from("profiles").select("*").order("full_name", { ascending: true }),
    supabase.from("agencies").select("*").eq("id", profile.agency_id).maybeSingle(),
    supabase.from("gifts").select("*"),
    supabase.from("complaints").select("*"),
    supabase.from("training_sessions").select("*").order("session_date", { ascending: false }),
    supabase.from("sg_manual_versions").select("*").order("created_at", { ascending: false }).limit(1),
    supabase.from("agency_invites").select("id").eq("status", "pending"),
    // Who has ticked the year's CPD as done (14 Oct 2026: that tick is the CPD).
    supabase.from("cpd_year_signoffs").select("profile_id").eq("cpd_year_start", cpdYear.start),
  ]);

  const staff = (staffRows ?? []) as Profile[];

  const preparedBy = (id: string | null) => {
    const found = staff.find((x) => x.id === id);
    return found?.full_name ?? found?.email ?? "your assistant";
  };
  const handedOver = (at: string | null) =>
    at
      ? `handed over ${new Date(at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`
      : "handed over";
  const agency = agencyRow as Agency | null;
  const pendingInviteCount = (pendingInviteRows ?? []).length;
  const gifts = (giftRows ?? []) as Gift[];
  const complaints = (complaintRows ?? []) as Complaint[];
  const sessions = (sessionRows ?? []) as TrainingSession[];
  const currentSgVersion = ((sgVersionRows ?? []) as SgManualVersion[])[0] ?? null;

  const agentNames = new Map<string, string>();
  for (const p of staff) agentNames.set(p.id, p.full_name ?? p.email);

  // ── Properties: needs-you queue + weekly review, same rollup as Portfolio ──
  const itemsByProperty = new Map<string, Map<string, PropertyItem>>();
  for (const row of (itemRows ?? []) as PropertyItem[]) {
    if (!itemsByProperty.has(row.property_id)) itemsByProperty.set(row.property_id, new Map());
    itemsByProperty.get(row.property_id)!.set(row.item_key, row);
  }
  // Who counts as a licensee in charge, for the Settled-stage split between
  // "Send to licensee" and "Licensee signature". One query, not one per file.
  const licenseeIds = new Set((await agencyPeople(supabase)).filter((r) => r.is_licensee_in_charge).map((r) => r.id));

  const digests = computePropertyDigests(propertyList, itemsByProperty, licenseeIds);
  const needsYouDigests = digests.filter((d) => d.pendingSignoff.length > 0 || d.flagged.length > 0);
  const needsAttentionItems: NeedsAttentionItem[] = needsYouDigests.map((d) => ({
    propertyId: d.property.id,
    address: d.property.address,
    stageLabel: STAGE_LABELS[d.property.stage],
    agentName: agentNames.get(d.property.created_by) ?? "Unknown agent",
    badges: [...d.pendingSignoff, ...d.flagged].map((item) => item.label),
  }));
  const dueForReview = digests.filter((d) => {
    const days = daysSinceActivity(d.lastActivityAt);
    return d.property.stage < 5 && (days === null || days > 7);
  }).length;

  // ── Licence & CPD ────────────────────────────────────────────────────────
  // People who have left (archived) are kept for their names on old files,
  // but are not counted here: Registers, CPD and the sidebar dot already
  // leave them out, so a departed agent's lapsed licence kept this card red
  // with nothing on Registers to fix (review of the 10 Oct fixes).
  const activeStaff = staff.filter((s) => !s.archived_at);
  const licenceStatuses = activeStaff.map((s) => expiryStatus(s.licence_expiry));
  const licenceCurrent = licenceStatuses.filter((s) => s === "ok" || s === "soon").length;
  const licenceExpiringSoon = licenceStatuses.filter((s) => s === "urgent").length;
  const licenceExpired = licenceStatuses.filter((s) => s === "expired").length;
  // Not yet ticked as done for the year, as the CPD page counts it (Adam,
  // 14 Oct 2026: CPD is a tick for the year, with the certificate optional).
  // It used to count people short of an hours figure.
  const cpdDone = new Set(((cpdSignoffRows ?? []) as Array<{ profile_id: string }>).map((r) => r.profile_id));
  const cpdOutstanding = activeStaff.filter((s) => !cpdDone.has(s.id)).length;

  // ── PI insurance ─────────────────────────────────────────────────────────
  const piStatus = agency ? expiryStatus(agency.pi_expiry) : "none";

  // ── Gifts ────────────────────────────────────────────────────────────────
  const giftsFlagged = gifts.filter((g) => g.status === "flagged").length;
  const giftsReviewed = gifts.filter((g) => g.status === "reviewed").length;
  const giftsRecorded = gifts.filter((g) => g.status === "recorded").length;

  // ── Complaints ───────────────────────────────────────────────────────────
  const targetDays = agency?.complaint_resolution_target_days ?? 30;
  const today = new Date();
  const complaintsOpen = complaints.filter((c) => c.status === "open").length;
  const complaintsUnderReview = complaints.filter((c) => c.status === "under_review").length;
  const complaintsResolved = complaints.filter((c) => c.status === "resolved").length;
  const complaintsOverdue = complaints.filter((c) => {
    if (c.status === "resolved") return false;
    const days = Math.floor((today.getTime() - new Date(c.received_date).getTime()) / (1000 * 60 * 60 * 24));
    return days > targetDays;
  }).length;

  // ── Training ─────────────────────────────────────────────────────────────
  const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
  const sessionsLast90Days = sessions.filter((s) => new Date(s.session_date) >= ninetyDaysAgo).length;
  const lastSessionDate = sessions[0]?.session_date ?? null;

  // ── Top-line risk count for the stat row ────────────────────────────────
  const licenceRisk = licenceExpired + licenceExpiringSoon;
  const piRisk = piStatus === "expired" || piStatus === "urgent" ? 1 : 0;

  return (
    <>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <div className="relative isolate overflow-hidden rounded-card px-3">
          <div className="rc-mesh-bg" />
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Home</h1>
              <p className="mt-1 text-sm text-rc-muted">
                Everything at a glance — diligence support only, the licensee decides.
              </p>
            </div>
          </div>

          {annexureOutstanding && <AnnexureCard unavailable={query.annexure === "unavailable"} />}
          {fairTrading && myLine && (
            <FairTradingCard
              lineId={myLine.id}
              dueSentence={fairTradingDueSentence(fairTrading)}
              overdue={fairTrading.overdue}
              todayIso={todayIso}
            />
          )}
          {newLicenseeAnnexureFrom && (
            <NewLicenseeAnnexureCard
              previousAdopter={newLicenseeAnnexureFrom}
              unavailable={query.annexure === "unavailable"}
            />
          )}
          {agentAnnexure && (
            <AgentAnnexureCard
              licenseeName={agentAnnexure.licenseeName}
              downloadHref={agentAnnexure.downloadHref}
              agencyId={profile.agency_id}
            />
          )}

          {/* Files an assistant has handed over and prepared for this agent.
              Top of Home, above the tiles, because it is the one thing on the
              page that is specifically WAITING ON THE PERSON READING IT —
              everything below is a picture of the office. Only rendered when
              there is something in it, so an office with no assistants never
              sees it. */}
          {awaitingMyReview.length > 0 && (
            <section className="mt-6 rounded-card border border-rc-amber-deep/25 bg-rc-amber/10 px-4 py-3.5">
              <h2 className="text-sm font-semibold text-rc-amber-deep">
                Waiting for your review ({awaitingMyReview.length})
              </h2>
              <ul className="mt-2.5 space-y-1.5">
                {awaitingMyReview.map((prop) => (
                  <li key={prop.id}>
                    <Link
                      href={`/dashboard/${prop.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2.5 text-sm shadow-card transition hover:bg-white/70"
                    >
                      <span className="font-medium text-rc-ink">{prop.address}</span>
                      <span className="text-xs text-rc-muted">
                        Prepared by {preparedBy(prop.review_requested_by)} ·{" "}
                        {handedOver(prop.review_requested_at)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-rc-amber-deep/80">
                Review the file and sign it. Your signature is the attestation — the hand-over isn&rsquo;t one.
              </p>
            </section>
          )}

          {/* px-3 above matches gap-3 below, so the outer edges get the same
              gap as the gap between tiles, rather than the first/last tile
              sitting flush against the section edge (Adam, 9 Aug 2026). */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatTile n={propertyList.length} l="Listings" icon={Building2} href="/dashboard" />
            <StatTile
              n={needsAttentionItems.length}
              l="Files need you"
              tone={needsAttentionItems.length > 0 ? "warn" : "ok"}
              icon={FileWarning}
              href="/dashboard/portfolio"
            />
            <StatTile
              n={licenceRisk + piRisk}
              l="Licence/PI at risk"
              tone={licenceRisk + piRisk > 0 ? "warn" : "ok"}
              icon={ShieldCheck}
              href="/dashboard/registers"
            />
            <StatTile
              n={complaintsOpen + complaintsUnderReview}
              l="Open complaints"
              tone={complaintsOpen + complaintsUnderReview > 0 ? "warn" : "ok"}
              icon={MessageSquareWarning}
              href="/dashboard/registers"
            />
            <StatTile
              n={giftsFlagged}
              l="Gifts awaiting review"
              tone={giftsFlagged > 0 ? "warn" : "ok"}
              icon={GiftIcon}
              href="/dashboard/registers"
            />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NeedsAttentionWidget items={needsAttentionItems} />
          <WeeklyReviewWidget dueCount={dueForReview} />

          <LicenceCpdWidget
            holders={activeStaff.length}
            current={licenceCurrent}
            expiringSoon={licenceExpiringSoon}
            expired={licenceExpired}
            cpdOutstanding={cpdOutstanding}
            cpdYearLabel={cpdYear.label}
          />
          <PiInsuranceWidget status={piStatus} expiry={agency?.pi_expiry ?? null} insurer={agency?.pi_insurer ?? null} />

          <GiftsWidget total={gifts.length} flagged={giftsFlagged} reviewed={giftsReviewed} recorded={giftsRecorded} />
          <ComplaintsWidget open={complaintsOpen} underReview={complaintsUnderReview} overdue={complaintsOverdue} resolved={complaintsResolved} />

          <TrainingWidget sessionsLast90Days={sessionsLast90Days} totalSessions={sessions.length} lastSessionDate={lastSessionDate} />
          <SgManualWidget
            hasVersion={currentSgVersion !== null}
            versionLabel={currentSgVersion?.version_label ?? null}
            uploadedAt={currentSgVersion?.created_at ?? null}
          />
          <TeamWidget staffCount={activeStaff.length} pendingInvites={pendingInviteCount} />
        </div>
      </main>
    </>
  );
}
