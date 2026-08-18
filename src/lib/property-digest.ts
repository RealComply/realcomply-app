// Shared by the Licensee digest and Portfolio dashboard pages — both need
// the same "what's pending sign-off / flagged / due this stage" rollup per
// property, computed the same way, so it lives in one place rather than
// being reimplemented twice and drifting.
import { allItemsFor, type ComplianceItem } from "@/lib/rules/nsw-sales";
import type { Property, PropertyItem } from "@/lib/types";

export type PropertyDigest = {
  property: Property;
  pendingSignoff: ComplianceItem[];
  flagged: ComplianceItem[];
  requiredCurrentStage: ComplianceItem[];
  doneCurrentStage: ComplianceItem[];
  // Items whose moment has passed and which are still open. Today this is
  // just the bidders record (x7) after the auction has been run: it is
  // deliberately not required for stage completion, because the auctioneer
  // often sends it through days later and a file that can't move on because
  // of someone else's admin turns a real obligation into an obstacle. But
  // "not blocking" must not mean "invisible" — without this it would sit
  // open forever with nothing ever mentioning it again.
  awaiting: ComplianceItem[];
  lastActivityAt: string | null;
};

export function computePropertyDigests(
  properties: Property[],
  itemsByProperty: Map<string, Map<string, PropertyItem>>,
): PropertyDigest[] {
  return properties.map((property) => {
    const rows = itemsByProperty.get(property.id) ?? new Map<string, PropertyItem>();
    // Only items in stages the file has actually reached — anything further
    // out hasn't been started yet, so it's not meaningfully "pending" or
    // "flagged," it just hasn't come up.
    const reached = allItemsFor(property, Object.fromEntries(rows)).filter((i) => i.stage <= property.stage);

    const pendingSignoff = reached.filter((i) => i.licenseeOnly && rows.get(i.key)?.status !== "done");
    const flagged = reached.filter((i) => rows.get(i.key)?.status === "flagged");
    const requiredCurrentStage = reached.filter((i) => i.stage === property.stage && i.requiredForStageCompletion);
    const doneCurrentStage = requiredCurrentStage.filter((i) => rows.get(i.key)?.status === "done");

    // The auction has been run (an outcome is recorded) but the bidders
    // record still isn't attached.
    const awaiting =
      rows.get("x8") && rows.get("x7")?.status !== "done" ? reached.filter((i) => i.key === "x7") : [];

    let lastActivityAt: string | null = null;
    for (const row of rows.values()) {
      if (!lastActivityAt || row.recorded_at > lastActivityAt) lastActivityAt = row.recorded_at;
    }

    return {
      property,
      pendingSignoff,
      flagged,
      requiredCurrentStage,
      doneCurrentStage,
      awaiting,
      lastActivityAt,
    };
  });
}

export function daysSinceActivity(lastActivityAt: string | null, reference: Date = new Date()): number | null {
  if (!lastActivityAt) return null;
  const then = new Date(lastActivityAt);
  return Math.floor((reference.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
}
