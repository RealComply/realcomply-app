import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { EditPropertyDetails } from "@/components/property/EditPropertyDetails";
import { requireProfile } from "@/lib/data/current-profile";
import { ItemCard } from "@/components/compliance/ItemCard";
import { CompleteStageButton, ExtractDocumentsButton, TestModeToggle } from "@/components/compliance/StageActions";
import { TransferListingSection } from "@/components/compliance/TransferListingSection";
import { HandToAgent } from "@/components/compliance/HandToAgent";
import { itemsForStage, AUCTION_DAY_KEYS } from "@/lib/rules/nsw-sales";
import { ruleContextFor } from "@/lib/data/rule-context";
import { signoffLinksFor } from "@/lib/data/signoff-links";
import { comparablesFor, subjectAttributesFrom } from "@/lib/data/comparables";
import { marketListingsFor } from "@/lib/data/market-listings";
import { withEffectiveEspStatus } from "@/lib/rules/esp-reasoning-gate";
import { stageHold } from "@/lib/rules/stage-hold";
import { stageProgress } from "@/lib/rules/stage-progress";
import { StageProgressBar } from "@/components/compliance/StageProgressBar";
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

  const [{ data: propertyItemRows }, { data: agencyRow }, { data: peopleRows }, signoffLinks, comparables, marketListings] = await Promise.all([
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
    // Licensee sign-off links for this file. Read here rather than in the card
    // so the send_licensee card knows on first paint whether a link is already
    // out and whether it has been signed — see lib/data/signoff-links.ts.
    signoffLinksFor(supabase, id),
    // The comparable sales on this listing. Read here so the ESP card and the
    // ESP reasoning card directly below it both work from one query.
    comparablesFor(supabase, id),
    // Properties on the market as at the agency agreement date — the ESP
    // reasoning card shows them under the sales (29 Sep 2026).
    marketListingsFor(supabase, id),
  ]);

  // The listing's own attributes — the other half of every comparison, and
  // read off the property row the page already has rather than fetched again.
  const subject = subjectAttributesFrom(property as Record<string, unknown>);

  // The ESP reasoning card reads by its completion rule: one stored as done
  // with no reasoning, or no on-market answer, shows as not complete. See
  // lib/rules/esp-reasoning-gate.ts.
  const allItems = withEffectiveEspStatus(
    Object.fromEntries(((propertyItemRows ?? []) as PropertyItem[]).map((item) => [item.item_key, item])),
    { onMarketCount: marketListings.filter((l) => l.asAt === null).length },
  );

  const ruleCtx = await ruleContextFor(supabase, p);

  // Held at the first earlier stage with a required card not complete (Adam,
  // 3 Oct 2026). Later tabs lock and the page opens on that stage; the stored
  // stage and every later card are untouched, so completing the card puts the
  // file straight back where it was. See lib/rules/stage-hold.ts.
  const hold = stageHold({
    storedStage: p.stage,
    testMode: p.test_mode,
    signedOff: allItems["sign_licensee"]?.status === "done",
    incompleteRequired: (s) =>
      itemsForStage(s, p, allItems, ruleCtx)
        .filter((i) => i.requiredForStageCompletion && allItems[i.key]?.status !== "done")
        .map((i) => i.label),
  });
  const held = hold.stage !== p.stage;
  const currentStage = hold.stage;

  const maxViewable = p.test_mode ? 5 : currentStage;
  const requestedStage = stageParam ? (Number(stageParam) as PropertyStage) : currentStage;
  const viewedStage = (
    Number.isFinite(requestedStage) && requestedStage >= 0 && requestedStage <= maxViewable
      ? requestedStage
      : currentStage
  ) as PropertyStage;

  const stageItems = itemsForStage(viewedStage, p, allItems, ruleCtx);

  // One count per stage for the progress bar: every item that applies to this
  // listing in that stage, against those genuinely complete. allItems already
  // carries the ESP reasoning card's effective status, so it counts by its
  // rule. See lib/rules/stage-progress.ts.
  const progress = ([0, 1, 2, 3, 4, 5] as PropertyStage[]).map((s) => ({
    stage: s,
    label: STAGE_LABELS[s],
    reachable: s <= maxViewable,
    ...stageProgress(itemsForStage(s, p, allItems, ruleCtx).map((i) => allItems[i.key]?.status)),
  }));
  const isCurrentStage = viewedStage === currentStage;
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

        {/* Pinned while you scroll (Adam, 3 Oct 2026): "have the header on each
            property where we've got the address, the listing set up ... hold
            so that when you scroll down, the address of the property stays on
            screen at all times." Address, Edit listing and the progress bar
            (which is also the stage tabs since 3 Oct) ride along directly
            under the user bar (--rc-userbar-h, measured by
            UserBarHeight). Property type and auction details sit below it and
            scroll away, so the pinned bar stays slim on a phone. z-10 keeps it
            under the user bar (z-20) and the Edit listing overlay (z-40). */}
        <div className="sticky top-[var(--rc-userbar-h,0px)] z-10 -mx-4 mt-3 border-b border-rc-border bg-rc-bg-alt/90 px-4 py-3 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h1 className="min-w-0 text-xl font-bold tracking-tight text-rc-ink sm:text-2xl">{p.address}</h1>
            <div className="flex shrink-0 items-center gap-2">
              {/* Moved up here 20 Aug 2026. It used to sit collapsed at the very
                  bottom of the page, below every item card — Adam went looking
                  for it and couldn't find it: "it was way down the bottom, I
                  think it should be up the top somewhere, not in a crowded
                  position." Beside the audit-pack button is the only other
                  uncrowded spot on the page. */}
              <EditPropertyDetails property={p} canDelete={profile.is_licensee_in_charge} />
              <Link
                href={`/dashboard/${p.id}/summary`}
                className="rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-medium text-rc-muted shadow-card transition hover:border-rc-green-deep/40 hover:text-rc-green-deep"
              >
                Download audit pack
              </Link>
            </div>
          </div>
          {/* The progress bar, which is also the way between stages (3 Oct
              2026). See StageProgressBar for what it shows and the two
              reversals that came with it. */}
          <div className="mt-3">
            <StageProgressBar propertyId={p.id} stages={progress} viewedStage={viewedStage} />
          </div>
        </div>

        <div className="mt-3">
          <p className="text-sm text-rc-muted">
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

        {/* ⚠️ REVERSAL, 3 Oct 2026: the stage hold message that sat here ("This
            file is at Pre-market, but it is held at Listing set-up until these
            cards are complete: ...") is gone. Adam: the user does not need to
            see the system's reasoning; the progress bar replaces it. Do not
            put it back or replace it with a to-do list. The hold itself is
            unchanged: later stages still lock and Continue is still withheld. */}

        {!isCurrentStage && (
          <div className="mt-6 rounded-2xl border border-rc-border bg-rc-bg-alt px-4 py-2 text-xs text-rc-muted">
            Viewing {STAGE_LABELS[viewedStage]} — the file&rsquo;s current stage is {STAGE_LABELS[currentStage]}.
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
                  signoffLinks={signoffLinks}
                  subject={subject}
                  comparables={comparables}
                  marketListings={marketListings}
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
              signoffLinks={signoffLinks}
              subject={subject}
              comparables={comparables}
              marketListings={marketListings}
              />
          ))}
        </div>

        {/* Held: no Continue button. Completing the held stage's cards is
            what releases the file, back to its own stage. */}
        {isCurrentStage && !held && p.stage < 5 && <CompleteStageButton propertyId={p.id} stage={p.stage} />}

        {/* The way on from a stage you are looking back at (Adam, 3 Oct 2026):
            "at the bottom of the page of each stage, we should have a button
            that moves the user onto the next stage so they don't have to
            scroll all the way back up to the top again." The current stage
            already ends in its Continue button; this covers every other stage
            the file can open. A link, so it lands at the top of the next stage. */}
        {!isCurrentStage && viewedStage < maxViewable && (
          <div className="mt-6 border-t border-rc-border pt-6">
            <Link
              href={`/dashboard/${p.id}?stage=${viewedStage + 1}`}
              className="inline-block rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600"
            >
              Go to {STAGE_LABELS[(viewedStage + 1) as PropertyStage]}
            </Link>
          </div>
        )}

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

        {/* Listing set-up only. Adam, 3 Sep 2026: "this should only be on the
            listing set up page."

            Moving a listing changes who signs it, whose weekly summary it
            appears in, and which assistants can see it. That is a set-up
            decision, and putting it at the foot of every stage offers it
            during a live campaign where nobody wants it and one misclick is
            expensive. The Server Action and the 0034 trigger still police who
            may do it; this only stops the control being where it is not
            wanted. */}
        {profile.is_licensee_in_charge && viewedStage === 0 && (
          <TransferListingSection
            propertyId={p.id}
            currentAgentName={personName(p.created_by)}
            agents={transferCandidates}
          />
        )}

      </main>
    </>
  );
}
