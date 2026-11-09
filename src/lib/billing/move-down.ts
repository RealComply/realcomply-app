import { PLANS, impliedTierFor, planFamily, type Plan } from "./entitlement";

// Moving down automatically (Adam, 6 Nov 2026; Terms cl 7.2: "if a
// Subscribers listings sit below the package they are subscribed for they
// will only be charged for the appropriate package, based on the listings").
//
// THE RULE, as Adam confirmed it:
//   - Never in a subscription's first 12 months: a new office has almost no
//     listings in its last 12 months yet.
//   - After that, at each billing date (a yearly plan: at its renewal), just
//     before Stripe takes the payment: if the listings added in the last 12
//     months fit a cheaper plan on the same ladder, that payment is at the
//     cheaper plan, and they're on it from then.
//   - No refunds. Earlier payments stay as they were.
//   - Never across ladders: an office never becomes an agent plan by itself.
// Moving up is its own job (Terms cl 7.3 and 7.4: notice, and they can say no).

/** A billing date this close (or closer) is checked by today's run. The run is daily; 26 hours leaves room either side. */
export const DUE_WITHIN_HOURS = 26;

export type MoveDown =
  | { kind: "move"; to: Plan }
  | { kind: "stay"; why: "not_due" | "first_year" | "fits" | "unknown_start" };

/** Twelve calendar months after the start (UTC). */
export function firstYearEnds(startedAt: string): Date {
  const end = new Date(startedAt);
  end.setUTCMonth(end.getUTCMonth() + 12);
  return end;
}

/** Whether today's run looks at this billing date, and whether it's past the first 12 months. Listings aren't needed yet. */
export function moveDownDue(input: { periodEnd: string; startedAt: string | null; now: Date }): MoveDown | null {
  const until = new Date(input.periodEnd).getTime() - input.now.getTime();
  if (until <= 0 || until > DUE_WITHIN_HOURS * 3_600_000) return { kind: "stay", why: "not_due" };
  if (!input.startedAt) return { kind: "stay", why: "unknown_start" };
  // A day's grace: a billing date on the first anniversary counts.
  if (new Date(input.periodEnd).getTime() < firstYearEnds(input.startedAt).getTime() - 86_400_000) {
    return { kind: "stay", why: "first_year" };
  }
  return null;
}

/** The cheaper plan on the same ladder that the listings fit, or stay. */
export function moveDownFor(input: {
  plan: Plan;
  listingCount: number;
  periodEnd: string;
  startedAt: string | null;
  now: Date;
}): MoveDown {
  const due = moveDownDue(input);
  if (due) return due;
  const fits = impliedTierFor(input.listingCount, planFamily(input.plan));
  if (PLANS[fits].price < PLANS[input.plan].price) return { kind: "move", to: fits };
  return { kind: "stay", why: "fits" };
}
