import { PLANS, type Plan } from "@/lib/billing/entitlement";
import type { Interval } from "@/lib/billing/stripe";
import { money, perWord, priceCents } from "@/lib/billing/plan-change";
import { formatAuDate } from "@/lib/format-date";

// The customer's email when their plan moves down by itself (Adam, 6 Nov
// 2026; Terms cl 7.2). To the billing email Stripe has for the office. Plain
// words, built here with no network so each line is tested.

export function movedDownEmail(input: {
  officeName: string;
  fromPlan: Plan;
  toPlan: Plan;
  interval: Interval;
  listingCount: number;
  /** The billing date the cheaper price starts (ISO). */
  billingDate: string;
}): { subject: string; text: string } {
  const office = input.officeName.trim() || "Your office";
  const to = PLANS[input.toPlan].name;
  const per = perWord(input.interval);
  const listings = `${input.listingCount} ${input.listingCount === 1 ? "listing" : "listings"}`;
  return {
    subject: `Your RealComply plan is now ${to}`,
    text: [
      "Hello,",
      "",
      `${office} added ${listings} in the last 12 months, which fits ${to}. So from ${formatAuDate(input.billingDate)}, your plan is ${to} at ${money(priceCents(input.toPlan, input.interval))} a ${per} (GST included), instead of ${PLANS[input.fromPlan].name}.`,
      "",
      "Nothing else changes. Your listings, records and team stay exactly as they are. You can see your plan and listings on Billing.",
      "",
      "RealComply",
    ].join("\n"),
  };
}
