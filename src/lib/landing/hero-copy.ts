// The public homepage's reforms hook. Same midnight as the rest of the
// product: REFORMS_FROM in src/lib/rules/underquoting-reforms.ts
// (17 November 2026, Sydney). The page calls these per request, so the
// wording changes on that midnight without a deploy.

import { reformsInForce } from "@/lib/rules/underquoting-reforms";

export const PAGE_TITLE = "RealComply. Stay on top of compliance, without a full-time hire";

export const HERO_BADGE_BEFORE = "NSW underquoting changes start 17 November 2026.";
export const HERO_BADGE_NOW = "NSW underquoting changes are now in force.";

const CHECK =
  "RealComply checks advertising against the estimate on file, and you still have the final say.";

export const HERO_LEAD_BEFORE = `From 17 November, every residential ad needs a price, and it can't sit below your estimate. ${CHECK}`;

export const HERO_LEAD_NOW = `Every residential ad needs a price, and it can't sit below your estimate. ${CHECK}`;

export function heroBadge(now: Date = new Date()): string {
  return reformsInForce(now) ? HERO_BADGE_NOW : HERO_BADGE_BEFORE;
}

export function heroLead(now: Date = new Date()): string {
  return reformsInForce(now) ? HERO_LEAD_NOW : HERO_LEAD_BEFORE;
}
