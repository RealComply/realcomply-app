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

    let lastActivityAt: string | null = null;
    for (const row of rows.values()) {
      if (!lastActivityAt || row.recorded_at > lastActivityAt) lastActivityAt = row.recorded_at;
    }

    return { property, pendingSignoff, flagged, requiredCurrentStage, doneCurrentStage, lastActivityAt };
  });
}

export function daysSinceActivity(lastActivityAt: string | null, reference: Date = new Date()): number | null {
  if (!lastActivityAt) return null;
  const then = new Date(lastActivityAt);
  return Math.floor((reference.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
}
