import Link from "next/link";
import { Building2, ClipboardCheck, FileWarning, IdCard, PenLine } from "lucide-react";
import type { createClient } from "@/lib/supabase/server";
import { navCountsFor } from "@/lib/data/nav-counts";
import { agencyPeople } from "@/lib/data/people";
import { expiryStatus } from "@/lib/expiry-status";
import { currentCpdYear } from "@/lib/cpd-year";
import { StatTile } from "@/components/home/WidgetCard";
import { NeedsAttentionWidget, type NeedsAttentionItem } from "@/components/home/NeedsAttentionWidget";
import { GiftsWidget } from "@/components/home/GiftsWidget";
import { TrainingWidget } from "@/components/home/TrainingWidget";
import { SgReadCard } from "@/components/home/SgReadCard";
import { STAGE_LABELS, type Gift, type Profile, type Property, type TrainingSession } from "@/lib/types";

// An agent's or an assistant's Home: their own work only (Adam, 7 Oct 2026).
// "Each individual agent kind of has their own dashboard." Needs your
// attention, my listings, my licence, my CPD, my training and gifts — the
// office-wide tiles (complaints, PI insurance, the team, the SG manual) are
// the licensee's.
//
// "Needs your attention" counts the same thing the Listings page and the
// sidebar dots count (lib/data/nav-counts.ts: required to-dos in the current
// stage plus anything flagged), so the two always agree. Before this it read
// 0 for an agent while Listings said "4 to do", because it counted only
// licensee sign-offs.
export async function AgentHome({
  supabase,
  profile,
  sgReadShows = false,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  profile: Profile;
  /** An agent in an office who has not yet confirmed reading the adopted annexure and the SG (brief, 14 Oct 2026). */
  sgReadShows?: boolean;
}) {
  const cpdYear = currentCpdYear();

  // Every query here goes through the signed-in person's own rules (0058):
  // their listings (or their agents', for an assistant), their CPD, the
  // sessions they attended and the gifts they logged.
  const [counts, people, { data: propertyRows }, { data: cpdSignoffRows }, { data: sessionRows }, { data: giftRows }] =
    await Promise.all([
      navCountsFor(supabase, profile),
      agencyPeople(supabase),
      supabase.from("properties").select("*").order("created_at", { ascending: false }),
      // Their tick for the year (14 Oct 2026: that tick is the CPD).
      supabase
        .from("cpd_year_signoffs")
        .select("id")
        .eq("profile_id", profile.id)
        .eq("cpd_year_start", cpdYear.start),
      supabase.from("training_sessions").select("*").order("session_date", { ascending: false }),
      supabase.from("gifts").select("*"),
    ]);

  const properties = (propertyRows ?? []) as Property[];
  const byId = new Map(properties.map((p) => [p.id, p]));
  const nameOf = (id: string | null) => people.find((x) => x.id === id)?.full_name ?? "Unknown";

  const needs: NeedsAttentionItem[] = counts.listingRows
    .filter((r) => r.outstanding > 0 || r.flagged > 0)
    .map((r) => ({
      propertyId: r.id,
      address: r.address,
      stageLabel: STAGE_LABELS[r.stage as keyof typeof STAGE_LABELS],
      agentName: nameOf(byId.get(r.id)?.created_by ?? null),
      badges: [
        ...(r.outstanding > 0 ? [`${r.outstanding} to do`] : []),
        ...(r.flagged > 0 ? [`${r.flagged} flagged`] : []),
      ],
    }));

  const awaitingMyReview = properties.filter((p) => p.review_requested_at && p.created_by === profile.id);

  const licence = expiryStatus(profile.licence_expiry);
  const cpdDone = (cpdSignoffRows ?? []).length > 0;

  const sessions = (sessionRows ?? []) as TrainingSession[];
  const today = new Date();
  const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
  const gifts = (giftRows ?? []) as Gift[];

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
      <div className="relative isolate overflow-hidden rounded-card px-3">
        <div className="rc-mesh-bg" />
        <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Home</h1>
        <p className="mt-1 text-sm text-rc-muted">
          {profile.is_assistant ? "The work of the agents you assist" : "Your own work"} — diligence support only, the
          licensee decides.
        </p>

        {sgReadShows && <SgReadCard />}

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
                    <span className="text-xs text-rc-muted">Prepared by {nameOf(prop.review_requested_by)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatTile
            n={properties.length}
            l={profile.is_assistant ? "Listings" : "My listings"}
            icon={Building2}
            href="/dashboard"
          />
          <StatTile
            n={needs.length}
            l="Need you"
            tone={needs.length > 0 ? "warn" : "ok"}
            icon={FileWarning}
            href="/dashboard"
          />
          <StatTile
            n={counts.signoffs}
            l="Sign-offs"
            tone={counts.signoffs > 0 ? "warn" : "ok"}
            icon={PenLine}
            href="/dashboard/document-signoffs"
          />
          <StatTile
            n={
              licence === "none"
                ? "—"
                : licence === "expired"
                  ? "Expired"
                  : licence === "urgent"
                    ? "Soon"
                    : "Current"
            }
            l="My licence"
            tone={licence === "expired" || licence === "urgent" ? "warn" : licence === "none" ? "neutral" : "ok"}
            icon={IdCard}
            // Their own licence card, where the renewal is uploaded (10 Oct
            // 2026). CPD has no licence controls.
            href="/dashboard/registers?tab=licence"
          />
          <StatTile
            n={cpdDone ? "Done" : "Not yet"}
            l="My CPD"
            tone={cpdDone ? "ok" : "warn"}
            icon={ClipboardCheck}
            href="/dashboard/cpd"
          />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NeedsAttentionWidget items={needs} scope="own" />
        <TrainingWidget
          sessionsLast90Days={sessions.filter((s) => new Date(s.session_date) >= ninetyDaysAgo).length}
          totalSessions={sessions.length}
          lastSessionDate={sessions[0]?.session_date ?? null}
        />
        <GiftsWidget
          total={gifts.length}
          flagged={gifts.filter((g) => g.status === "flagged").length}
          reviewed={gifts.filter((g) => g.status === "reviewed").length}
          recorded={gifts.filter((g) => g.status === "recorded").length}
        />
      </div>
    </main>
  );
}
