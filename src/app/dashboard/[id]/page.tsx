import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { EditPropertyDetails } from "@/components/property/EditPropertyDetails";
import { requireProfile } from "@/lib/data/current-profile";
import { ItemCard } from "@/components/compliance/ItemCard";
import { CompleteStageButton, ExtractDocumentsButton, TestModeToggle } from "@/components/compliance/StageActions";
import { DeletePropertySection } from "@/components/compliance/DeletePropertySection";
import { TransferListingSection } from "@/components/compliance/TransferListingSection";
import { HandToAgent } from "@/components/compliance/HandToAgent";
import { itemsForStage, AUCTION_DAY_KEYS } from "@/lib/rules/nsw-sales";
import { ruleContextFor } from "@/lib/data/rule-context";
import { STAGE_LABELS, type Property, type PropertyItem, type PropertyStage } from "@/lib/types";

function auctionDateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

// Days until the auction, as a short phrase. Null when there is no date (TBC)
// or the auction is behind us — a countdown that reads "-6 days" helps nobody.
function auctionCountdown(date: string | null): string | null {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${date}T00:00:00`);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return null;
  if (days === 0) return "Auction today";
  if (days === 1) return "Auction tomorrow";
  return `${days} days out`;
}

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

  const [{ data: propertyItemRows }, { data: agencyRow }, { data: peopleRows }] = await Promise.all([
    supabase.from("property_items").select("*").eq("property_id", id),
    // One lookup for the page, passed down to every card, rather than each
    // card asking. Only amv ever uses it.
    supabase
      .from("agencies")
      .select("aml_precommencement_enabled")
      .eq("id", profile.agency_id)
      .maybeSingle(),
    // For the hand-over card: whose listing this is, and who handed it over.
    // is_assistant as well, since 26 Aug — the transfer control has to leave
    // assistants out of the list. An assistant prepares files for an agent and
    // cannot sign one, so a listing sitting on their name could never be
    // completed by anybody.
    supabase.from("profiles").select("id, full_name, email, is_assistant"),
  ]);

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

  const ruleCtx = await ruleContextFor(supabase, p);
  const stageItems = itemsForStage(viewedStage, p, allItems, ruleCtx);
  const isCurrentStage = viewedStage === p.stage;
  const countdown = auctionCountdown(p.auction_date);

  const people = (peopleRows ?? []) as {
    id: string;
    full_name: string | null;
    email: string;
    is_assistant: boolean | null;
  }[];
  const personName = (id: string | null) => {
    const found = people.find((x) => x.id === id);
    return found?.full_name ?? found?.email ?? "the agent";
  };

  // Everyone this listing could move to: the agency's agents, minus assistants
  // and minus whoever already holds it.
  const transferCandidates = people
    .filter((x) => !x.is_assistant && x.id !== p.created_by)
    .map((x) => ({ id: x.id, name: x.full_name ?? x.email }));

  // The auction-day items are pulled out of the Campaign list and shown
  // together under one heading, in the order they happen. They are ordinary
  // items — same cards, same behaviour — they are just grouped, because on the
  // day they all happen inside about an hour and an agent working through them
  // on a phone at the property should not have to hunt for them among the
  // offers log and the reports register.
  const auctionDaySet = new Set<string>(AUCTION_DAY_KEYS);
  const auctionDayItems = stageItems.filter((item) => auctionDaySet.has(item.key));
  const ordinaryItems = stageItems.filter((item) => !auctionDaySet.has(item.key));
  // Finalised means the finalised file has actually been generated (f2), not
  // that someone ticked a box saying the licensee had reviewed it. That box
  // (f1) was removed on 23 Aug 2026 — see the note in rules/nsw-sales.ts —
  // and generating f2 is now gated on the licensee's signature, so this reads
  // as "signed off AND closed out" rather than merely asserted.
  const fileFinalised = p.stage === 5 && allItems["f2"]?.status === "done";
  const hasSourceDocs = ["a3", "b1", "a4"].some((key) => allItems[key]?.evidence_path);

  return (
    <>
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
            {p.sale_method === "auction" && (
              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-full bg-rc-green-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rc-green-deep">
                  Auction
                </span>
                {p.auction_date ? (
                  <span className="text-rc-muted">
                    {auctionDateLabel(p.auction_date)}
                    {p.auction_time ? `, ${p.auction_time}` : ""}
                    {p.auction_venue ? ` · ${p.auction_venue.toLowerCase()}` : ""}
                  </span>
                ) : (
                  // Not a warning. A listing that goes to auction before the
                  // date is fixed is completely normal, and the file should
                  // say what it knows rather than imply something is wrong.
                  <span className="text-rc-muted">date TBC</span>
                )}
                {countdown && (
                  <span className="rounded-full bg-rc-amber/15 px-2 py-0.5 text-[11px] font-medium text-rc-amber-deep">
                    {countdown}
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Moved up here 20 Aug 2026. It used to sit collapsed at the very
                bottom of the page, below every item card — Adam went looking
                for it and couldn't find it: "it was way down the bottom, I
                think it should be up the top somewhere, not in a crowded
                position." Beside the audit-pack button is the only other
                uncrowded spot on the page. */}
            <EditPropertyDetails property={p} />
            <Link
              href={`/dashboard/${p.id}/summary`}
              className="rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-medium text-rc-muted shadow-card transition hover:border-rc-green-deep/40 hover:text-rc-green-deep"
            >
              Download audit pack
            </Link>
          </div>
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

        {auctionDayItems.length > 0 && (
          <section className="mt-6 overflow-hidden rounded-card border border-rc-border bg-white shadow-card">
            <div className="bg-rc-ink px-4 py-3">
              <h2 className="text-sm font-semibold text-white">Auction day</h2>
              <p className="mt-0.5 text-xs text-rc-ink-muted">
                {p.auction_date
                  ? `${auctionDateLabel(p.auction_date)}${p.auction_time ? `, ${p.auction_time}` : ""}`
                  : "Date not set yet — set it in the listing details below."}
              </p>
            </div>
            <div className="space-y-4 bg-rc-bg-alt p-4">
              {auctionDayItems.map((item) => (
                <ItemCard
                  key={item.key}
                  item={item}
                  propertyId={p.id}
                  current={allItems[item.key]}
                  profile={profile}
                  allItems={allItems}
                  amlPreCommencementEnabled={Boolean(agencyRow?.aml_precommencement_enabled)}
                />
              ))}
            </div>
          </section>
        )}

        <div className="mt-6 space-y-4">
          {ordinaryItems.map((item) => (
            <ItemCard
              key={item.key}
              item={item}
              propertyId={p.id}
              current={allItems[item.key]}
              profile={profile}
              allItems={allItems}
              amlPreCommencementEnabled={Boolean(agencyRow?.aml_precommencement_enabled)}
              />
          ))}
        </div>

        {isCurrentStage && p.stage < 5 && <CompleteStageButton propertyId={p.id} stage={p.stage} />}

        {/* The assistant hand-over. Shown to the assistant as an action, and
            to everyone as a state once it has been used — the licensee should
            be able to see a file is parked with an agent without asking. */}
        <HandToAgent
          propertyId={p.id}
          agentName={personName(p.created_by)}
          requestedAt={p.review_requested_at}
          requestedByName={p.review_requested_by ? personName(p.review_requested_by) : null}
          viewerIsAssistant={Boolean(profile.is_assistant)}
        />

        {profile.is_licensee_in_charge && (
          <TransferListingSection
            propertyId={p.id}
            currentAgentName={personName(p.created_by)}
            agents={transferCandidates}
          />
        )}

        {profile.is_licensee_in_charge && <DeletePropertySection propertyId={p.id} address={p.address} />}
      </main>
    </>
  );
}
