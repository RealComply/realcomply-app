import { PLANS, annualPrice, planFamily, type Plan } from "./entitlement";
import type { Interval } from "./stripe";

// Self-serve plan changes (mockup signed off by Adam, 6 Nov 2026). The rules,
// with no network or database, so every case is tested (plan-change.test.ts).
//
// WHEN A CHANGE TAKES EFFECT
//   - Up (a dearer plan on the same ladder, or an agent plan to an office
//     plan): now. Stripe charges the difference for the rest of the billing
//     period, then the new price.
//   - Down (a cheaper plan, or an office plan to an agent plan): from the next
//     billing date. They keep what they paid for until then.
//   - Monthly to yearly, or yearly to monthly: from the next billing date, so
//     nobody is charged twice or refunded in odd amounts. Up and a switch
//     together: the plan now, the switch from the next billing date.
//   - During the free trial nothing has been paid: any change is now, and the
//     first payment at the end of the trial is the new price.
//
// WHAT CAN'T BE PICKED, and why (shown greyed, with the reason)
//   - A plan whose band is below the listings already used in the last 12
//     months.
//   - An agent plan, while the office has more than one person.
//   - Below the starting plan in its first 12 months: a hook only, not
//     switched on (startingFloor is always null for now; the starting plan
//     job, merge held for the terms, switches it on).

export type PlanChoice = { plan: Plan; interval: Interval };

export type Direction = "up" | "down" | "same";

/** Where one plan sits against another. Agent to office is up, office to agent is down. */
export function planDirection(from: Plan, to: Plan): Direction {
  if (from === to) return "same";
  const fromFamily = planFamily(from);
  const toFamily = planFamily(to);
  if (fromFamily !== toFamily) return toFamily === "office" ? "up" : "down";
  return PLANS[to].price > PLANS[from].price ? "up" : "down";
}

export type ChangeTiming = "now" | "next_billing_date" | "now_then_next";

export type ChangeDecision =
  | { kind: "none" }
  | {
      kind: "change";
      timing: ChangeTiming;
      /** What the subscription becomes now. Null when nothing changes until the next billing date. */
      now: PlanChoice | null;
      /** Charge the difference for the rest of the period now (false during the free trial). */
      prorate: boolean;
      /** What it becomes from the next billing date. Null when nothing more changes then. */
      next: PlanChoice | null;
      direction: Direction;
    };

export function decideChange(input: { from: PlanChoice; to: PlanChoice; trialing: boolean }): ChangeDecision {
  const { from, to } = input;
  if (from.plan === to.plan && from.interval === to.interval) return { kind: "none" };
  const direction = planDirection(from.plan, to.plan);
  if (input.trialing) {
    return { kind: "change", timing: "now", now: to, prorate: false, next: null, direction };
  }
  if (direction === "down" || direction === "same") {
    return { kind: "change", timing: "next_billing_date", now: null, prorate: false, next: to, direction };
  }
  if (from.interval === to.interval) {
    return { kind: "change", timing: "now", now: to, prorate: true, next: null, direction };
  }
  return {
    kind: "change",
    timing: "now_then_next",
    now: { plan: to.plan, interval: from.interval },
    prorate: true,
    next: to,
    direction,
  };
}

/** Moving from an agent plan to an office plan: the licensee question is asked. */
export function isAgentToOffice(from: Plan, to: Plan): boolean {
  return planFamily(from) === "agent" && planFamily(to) === "office";
}

/** Moving from an office plan to an agent plan. */
export function isOfficeToAgent(from: Plan, to: Plan): boolean {
  return planFamily(from) === "office" && planFamily(to) === "agent";
}

/** GST-inclusive price for the interval, in whole dollars. */
export function priceFor(plan: Plan, interval: Interval): number {
  return interval === "annual" ? annualPrice(plan) : PLANS[plan].price;
}

export function priceCents(plan: Plan, interval: Interval): number {
  return priceFor(plan, interval) * 100;
}

const LADDERS: Record<"agent" | "office", Plan[]> = {
  agent: ["agent_1", "agent_2", "agent_3"],
  office: ["office_1", "office_2", "office_3", "office_4", "office_5"],
};

/** "Up to 25 listings a year", "26 to 60 listings a year", "61 or more listings a year". */
export function bandLine(plan: Plan): string {
  const ladder = LADDERS[planFamily(plan)];
  const at = ladder.indexOf(plan);
  const max = PLANS[plan].maxListings;
  const below = at > 0 ? PLANS[ladder[at - 1]].maxListings : null;
  if (below === null) return `Up to ${max} listings a year`;
  if (max === null) return `${below + 1} or more listings a year`;
  return `${below + 1} to ${max} listings a year`;
}

export type StartingFloor = { plan: Plan; until: string } | null;

/**
 * The starting plan's 12-month floor (mockup, row "Not available until …").
 * A hook only: always null until the starting plan job switches it on.
 */
export function startingFloor(): StartingFloor {
  return null;
}

export type LadderRow = {
  plan: Plan;
  name: string;
  /** For the interval shown, whole dollars, GST included. */
  price: number;
  band: string;
  /** The plan and interval they're on now. */
  current: boolean;
  /** Can be picked. Never the current one. */
  available: boolean;
  /** Why it can't be picked. Null when it can, or when it's the current plan. */
  reason: string | null;
};

const FLOOR_DATE = (iso: string) =>
  new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Australia/Sydney",
  });

export function ladderRows(input: {
  current: PlanChoice;
  /** The interval being shown (the Monthly or Yearly switch). */
  interval: Interval;
  /** Listings in the last 12 months (agency_listing_count). */
  listingCount: number;
  /** Active people in the office, the payer included. */
  activePeople: number;
  floor?: StartingFloor;
}): { agent: LadderRow[]; office: LadderRow[] } {
  const row = (plan: Plan): LadderRow => {
    const spec = PLANS[plan];
    const current = plan === input.current.plan && input.interval === input.current.interval;
    let reason: string | null = null;
    if (!current) {
      if (spec.maxListings !== null && input.listingCount > spec.maxListings) {
        reason = `Not available: you've listed ${input.listingCount} properties in the last 12 months.`;
      } else if (
        planFamily(plan) === "agent" &&
        planFamily(input.current.plan) === "office" &&
        input.activePeople > 1
      ) {
        reason = `Not available: an agent plan is for one person, and your office has ${input.activePeople} people.`;
      } else if (
        input.floor &&
        planFamily(plan) === planFamily(input.floor.plan) &&
        PLANS[plan].price < PLANS[input.floor.plan].price
      ) {
        reason = `Not available until ${FLOOR_DATE(input.floor.until)}: your starting plan holds for 12 months.`;
      }
    }
    return {
      plan,
      name: spec.name,
      price: priceFor(plan, input.interval),
      band: bandLine(plan),
      current,
      available: !current && reason === null,
      reason,
    };
  };
  return { agent: LADDERS.agent.map(row), office: LADDERS.office.map(row) };
}

/** The reason a picked plan can't be had, or null. The server asks this again before charging. */
export function unavailableReason(input: Parameters<typeof ladderRows>[0], plan: Plan): string | null {
  const rows = ladderRows(input);
  const found = [...rows.agent, ...rows.office].find((r) => r.plan === plan);
  if (!found) return "Choose a plan.";
  if (found.current) return "That's your plan already.";
  return found.reason;
}

// ── Words ────────────────────────────────────────────────────────────────

/** "$59.18". Always two decimal places: what someone is charged is never rounded on screen. */
export function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "$249" or "$1,049": whole-dollar prices on the ladder. */
export function wholeDollars(dollars: number): string {
  return `$${dollars.toLocaleString("en-AU")}`;
}

export function intervalWord(interval: Interval): "monthly" | "yearly" {
  return interval === "annual" ? "yearly" : "monthly";
}

export function perWord(interval: Interval): "month" | "year" {
  return interval === "annual" ? "year" : "month";
}

/** Whole days from now to the end of the period, rounded up. Never below 1. */
export function daysLeft(periodEnd: string, now: Date): number {
  return Math.max(1, Math.ceil((new Date(periodEnd).getTime() - now.getTime()) / 86_400_000));
}

/** The pay button. */
export function confirmButtonLabel(input: {
  timing: ChangeTiming;
  todayCents: number;
  planName: string;
  effectiveDate: string;
}): string {
  if (input.timing === "next_billing_date") return `Move to ${input.planName} on ${input.effectiveDate}`;
  if (input.todayCents > 0) return `Pay ${money(input.todayCents)} and move to ${input.planName}`;
  return `Move to ${input.planName}`;
}

/** What "Provides access to" lists, for an agent moving to an office plan (the mockup's words). */
export const OFFICE_ACCESS_LINES = [
  "Team: invite agents, assistants, an office manager and property managers",
  "Registers: complaints, gifts, breaches, insurance and the trust account",
  "Office profile and the office's supervision guidelines",
  "Your listings, CPD and records stay exactly as they are",
];

/** The line on Billing once a change has gone through or been booked. */
export function doneLine(input: {
  timing: ChangeTiming;
  fromName: string;
  toName: string;
  toOffice: boolean;
  fromAgent: boolean;
  effectiveDate: string;
  ongoingCents: number;
  interval: Interval;
  /** The billing date the next payment falls on (the end of the current period). */
  nextPaymentDate: string;
}): { title: string; body: string } {
  if (input.timing === "next_billing_date") {
    return {
      title: `Your plan changes to ${input.toName} on ${input.effectiveDate}.`,
      body: `You stay on ${input.fromName} until then. From that date it's ${money(input.ongoingCents)} a ${perWord(input.interval)}.`,
    };
  }
  const ready = input.toOffice && input.fromAgent ? " Your team, registers and office profile are ready." : "";
  const next =
    input.timing === "now_then_next"
      ? ` From ${input.effectiveDate} it's ${money(input.ongoingCents)} a ${perWord(input.interval)}.`
      : ` Next payment ${money(input.ongoingCents)} on ${input.nextPaymentDate}.`;
  return { title: `You're on ${input.toName}.`, body: [ready.trim(), next.trim()].filter(Boolean).join(" ") };
}

export type PayRow = { label: string; value: string; total?: boolean };

/**
 * "What you'll pay" on the confirm step (mockup step 3), worded for each kind
 * of change. Dates are passed in already formatted.
 */
export function paySummaryRows(input: {
  decision: Extract<ChangeDecision, { kind: "change" }>;
  to: PlanChoice;
  current: PlanChoice;
  todayCents: number;
  /** The next billing date, formatted. */
  periodEnd: string;
  /** The free trial's end, formatted, while on trial. */
  trialEnd: string | null;
  /** Whole days left in the current period. */
  daysLeft: number;
}): PayRow[] {
  const { decision, to } = input;
  const name = PLANS[to.plan].name;
  const price = (interval: Interval) => money(priceCents(to.plan, interval));
  if (decision.timing === "next_billing_date") {
    return [
      { label: `${name}, ${intervalWord(to.interval)}`, value: price(to.interval) },
      { label: "Today", value: money(0) },
      { label: `From ${input.periodEnd}, each ${perWord(to.interval)}`, value: price(to.interval), total: true },
    ];
  }
  if (!decision.prorate) {
    return [
      { label: `${name}, ${intervalWord(to.interval)}`, value: price(to.interval) },
      { label: "Today, during your free trial", value: money(0) },
      {
        label: `From ${input.trialEnd ?? input.periodEnd}, when your free trial ends, each ${perWord(to.interval)}`,
        value: price(to.interval),
        total: true,
      },
    ];
  }
  const nowInterval = decision.now?.interval ?? input.current.interval;
  const ongoing = decision.next ?? decision.now ?? to;
  return [
    { label: `${name}, ${intervalWord(nowInterval)}`, value: price(nowInterval) },
    {
      label: `Today: the difference for the ${input.daysLeft} ${input.daysLeft === 1 ? "day" : "days"} left this ${perWord(input.current.interval)}`,
      value: money(input.todayCents),
    },
    {
      label:
        decision.timing === "now_then_next"
          ? `From ${input.periodEnd}, ${intervalWord(ongoing.interval)}, each ${perWord(ongoing.interval)}`
          : `From ${input.periodEnd}, each ${perWord(ongoing.interval)}`,
      value: price(ongoing.interval),
      total: true,
    },
  ];
}
