import { Building2, FileWarning, ShieldCheck, MessageSquareWarning, Gift as GiftIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { computePropertyDigests, daysSinceActivity } from "@/lib/property-digest";
import { expiryStatus } from "@/lib/expiry-status";
import { currentCpdYear } from "@/lib/cpd-year";
import { cpdRequirementFor } from "@/lib/rules/nsw-cpd";
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
import { STAGE_LABELS, type Agency, type Complaint, type CpdRecord, type Gift, type Profile, type Property, type PropertyItem, type SgManualVersion, type TrainingSession } from "@/lib/types";

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
export default async function HomeDashboardPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const cpdYear = currentCpdYear();

  const { data: properties } = await supabase.from("properties").select("*").order("created_at", { ascending: false });
  const propertyList = (properties ?? []) as Property[];
  const propertyIds = propertyList.map((p) => p.id);

  const [
    { data: itemRows },
    { data: staffRows },
    { data: agencyRow },
    { data: giftRows },
    { data: complaintRows },
    { data: cpdRows },
    { data: sessionRows },
    { data: sgVersionRows },
    { data: pendingInviteRows },
  ] = await Promise.all([
    propertyIds.length > 0
      ? supabase.from("property_items").select("*").in("property_id", propertyIds)
      : Promise.resolve({ data: [] as PropertyItem[] }),
    supabase.from("profiles").select("*").order("full_name", { ascending: true }),
    supabase.from("agencies").select("*").eq("id", profile.agency_id).maybeSingle(),
    supabase.from("gifts").select("*"),
    supabase.from("complaints").select("*"),
    supabase.from("cpd_records").select("*").gte("completed_date", cpdYear.start).lte("completed_date", cpdYear.end),
    supabase.from("training_sessions").select("*").order("session_date", { ascending: false }),
    supabase.from("sg_manual_versions").select("*").order("created_at", { ascending: false }).limit(1),
    supabase.from("agency_invites").select("id").eq("status", "pending"),
  ]);

  const staff = (staffRows ?? []) as Profile[];
  const agency = agencyRow as Agency | null;
  const pendingInviteCount = (pendingInviteRows ?? []).length;
  const gifts = (giftRows ?? []) as Gift[];
  const complaints = (complaintRows ?? []) as Complaint[];
  const cpdRecords = (cpdRows ?? []) as CpdRecord[];
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
  const digests = computePropertyDigests(propertyList, itemsByProperty);
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
  const licenceStatuses = staff.map((s) => expiryStatus(s.licence_expiry));
  const licenceCurrent = licenceStatuses.filter((s) => s === "ok" || s === "soon").length;
  const licenceExpiringSoon = licenceStatuses.filter((s) => s === "urgent").length;
  const licenceExpired = licenceStatuses.filter((s) => s === "expired").length;
  const cpdByProfile = new Map<string, CpdRecord[]>();
  for (const row of cpdRecords) {
    if (!cpdByProfile.has(row.profile_id)) cpdByProfile.set(row.profile_id, []);
    cpdByProfile.get(row.profile_id)!.push(row);
  }
  // Only counts people whose requirement can actually be stated — Fair
  // Trading sets CPD hours per category of practice, and hasn't published a
  // figure for every category this year. See rules/nsw-cpd.ts.
  const cpdOutstanding = staff.filter((s) => {
    const requirement = cpdRequirementFor(s.licence_type, s.cpd_practice_category);
    const target = requirement.units ?? requirement.coreHours;
    if (target === null) return false;
    const total = (cpdByProfile.get(s.id) ?? []).reduce((sum, r) => sum + Number(r.hours), 0);
    return total < target;
  }).length;

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

          {/* px-3 above matches gap-3 below, so the outer edges get the same
              gap as the gap between tiles, rather than the first/last tile
              sitting flush against the section edge (Adam, 9 Aug 2026). */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatTile n={propertyList.length} l="Properties" icon={Building2} href="/dashboard/portfolio" />
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
            holders={staff.length}
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
          <TeamWidget staffCount={staff.length} pendingInvites={pendingInviteCount} />
        </div>
      </main>
    </>
  );
}
