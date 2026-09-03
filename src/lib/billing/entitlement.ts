import type { SupabaseClient } from "@supabase/supabase-js";

// What an agency is entitled to, answered in one place.
//
// THE ARCHITECTURAL POINT, from RealComply-pricing-and-billing-model.md:
// entitlement is a property of the agency, and Stripe is one of the things that
// writes to it — not the other way round. Nothing in the app asks Stripe
// anything. It reads two fields on the agency row, both of which work perfectly
// well when there is no Stripe account at all, when a webhook is missed, or
// when Stripe is having an outage.
//
// That is also what makes a comped account real rather than a 100% discount
// coupon. A coupon still demands a payment method, still generates $0 invoices
// and churn events, and pollutes revenue reporting permanently. `comped` is a
// status, and the advisers and design partners who hold it cannot be broken by
// anything happening at Stripe.
//
// The hard stop lives in the database (0036): two INSERT triggers refuse new
// listings and new compliance items when an agency is not current. Everything
// here is so the app can say so in advance, in English, rather than letting
// someone fill in a form and meet a Postgres exception.

export type Plan =
  | "agent_1"
  | "agent_2"
  | "agent_3"
  | "office_1"
  | "office_2"
  | "office_3"
  | "office_4"
  | "office_5";
export type BillingStatus = "trialing" | "active" | "past_due" | "canceled" | "comped";

// Two ladders, not one.
//
// Adam, 2 Sep 2026: "an agent doing 100 sales or more can afford to pay more
// than 99." The agent plan was a single uncapped $99, so the agent writing
// twelve listings a year and the one writing a hundred paid the same — the
// largest mispricing in the ladder, and it grew with exactly the customers
// worth keeping.
//
// The two ladders stay SEPARATE and nothing crosses between them
// automatically. An agent passing the top agent band stays on agent_3 rather
// than being moved onto an office plan: office plans carry office-level
// compliance and more than one user, so moving someone onto one is a
// conversation and a sale, not a charge that appears on their card.
export type PlanFamily = "agent" | "office";

export function planFamily(plan: Plan): PlanFamily {
  return plan.startsWith("agent") ? "agent" : "office";
}

export type PlanSpec = {
  plan: Plan;
  name: string;
  /** GST-inclusive monthly price in whole dollars, as advertised. */
  price: number;
  /** Listings a year this tier covers. Null at the top of a ladder, which is uncapped. */
  maxListings: number | null;
  /** Agency-level compliance: registers, trust accounts, SG manual, training, team. */
  officeCompliance: boolean;
  blurb: string;
};

// The ladder, in one place. Prices are GST inclusive per the pricing doc —
// quoting anything else to an Australian small business is the wrong number.
//
// KEEP IN SYNC with agent_tier_for() and office_tier_for() in migration 0040,
// with PLANS in scripts/stripe-setup.mjs, and with the two pricing cards on the
// public landing page (search "Straightforward pricing"). The database one is
// authoritative for deciding a tier, this one is for showing it, the script
// sets the price tags in Stripe, and the landing page shows entry prices only.
//
// Agent 3 lands on $249, the same as Office 1, and that is deliberate. At the
// point where an agent is writing enough business to pay office money, the
// office plan should be the obvious next step rather than something they are
// pushed away from by a price that undercuts it.
export const PLANS: Record<Plan, PlanSpec> = {
  agent_1: { plan: "agent_1", name: "Agent 1", price: 99, maxListings: 25, officeCompliance: false, blurb: "One agent, up to 25 listings per year." },
  agent_2: { plan: "agent_2", name: "Agent 2", price: 169, maxListings: 60, officeCompliance: false, blurb: "One agent, 26 to 60 listings per year." },
  agent_3: { plan: "agent_3", name: "Agent 3", price: 249, maxListings: null, officeCompliance: false, blurb: "One agent, more than 60 listings per year." },
  office_1: { plan: "office_1", name: "Office 1", price: 249, maxListings: 50, officeCompliance: true, blurb: "Up to 50 listings per year." },
  office_2: { plan: "office_2", name: "Office 2", price: 349, maxListings: 150, officeCompliance: true, blurb: "51 to 150 listings per year." },
  office_3: { plan: "office_3", name: "Office 3", price: 549, maxListings: 250, officeCompliance: true, blurb: "151 to 250 listings per year." },
  office_4: { plan: "office_4", name: "Office 4", price: 749, maxListings: 400, officeCompliance: true, blurb: "251 to 400 listings per year." },
  office_5: { plan: "office_5", name: "Office 5", price: 1049, maxListings: null, officeCompliance: true, blurb: "More than 400 listings per year." },
};

/** Two months free — the annual price, in whole dollars. */
export function annualPrice(plan: Plan): number {
  return PLANS[plan].price * 10;
}

export type Entitlement = {
  plan: Plan;
  spec: PlanSpec;
  status: BillingStatus;
  /** May they create new listings and record new compliance items? */
  mayWrite: boolean;
  /** True when they are read-only because of billing rather than anything else. */
  readOnly: boolean;
  /** Agency-level compliance — registers, trust, SG manual, training, team. */
  officeCompliance: boolean;
  trialEndsAt: string | null;
  /** Listings in the last rolling 365 days, excluding test-mode ones. */
  listingCount: number;
  /** The tier that listing count implies, which may be above the current plan. Same ladder, always. */
  impliedTier: Plan;
  /** True once they are within striking distance of the next tier. */
  approachingLimit: boolean;
  /** True when the count has already passed what the current plan covers. */
  overLimit: boolean;
};

// 80% of the band, per the pricing doc: "a warning at roughly 80% of the tier".
const WARN_AT = 0.8;

export async function entitlementFor(
  supabase: SupabaseClient,
  agencyId: string,
): Promise<Entitlement> {
  const [{ data: agencyRow }, { data: count }] = await Promise.all([
    supabase.from("agencies").select("plan, status, trial_ends_at, comped_until").eq("id", agencyId).maybeSingle(),
    supabase.rpc("agency_listing_count", { p_agency_id: agencyId }),
  ]);

  const agency = (agencyRow ?? {}) as {
    plan?: Plan;
    status?: BillingStatus;
    trial_ends_at?: string | null;
    comped_until?: string | null;
  };

  // Defaults matter here, and they default OPEN rather than closed.
  //
  // The opposite of the signups gate, deliberately. There, failing closed meant
  // a stranger did not get in. Here, failing closed would mean a paying agency
  // could not record a compliance obligation because a query hiccuped — and the
  // database triggers are the real enforcement anyway. This layer exists to
  // explain, not to police.
  const plan: Plan = agency.plan ?? "office_1";
  const status: BillingStatus = agency.status ?? "comped";

  const compExpired = status === "comped" && agency.comped_until != null && new Date(agency.comped_until) <= new Date();
  const mayWrite = (status === "trialing" || status === "active" || status === "comped") && !compExpired;

  const listingCount = typeof count === "number" ? count : 0;
  const spec = PLANS[plan];
  const cap = spec.maxListings;

  return {
    plan,
    spec,
    status,
    mayWrite,
    readOnly: !mayWrite,
    officeCompliance: spec.officeCompliance,
    trialEndsAt: agency.trial_ends_at ?? null,
    listingCount,
    impliedTier: impliedTierFor(listingCount, planFamily(plan)),
    approachingLimit: cap != null && listingCount >= Math.floor(cap * WARN_AT) && listingCount <= cap,
    overLimit: cap != null && listingCount > cap,
  };
}

/**
 * Mirrors agent_tier_for() and office_tier_for() in 0040. The database decides;
 * this shows.
 *
 * The family is passed in rather than worked out from the count, because the
 * count alone cannot tell the two ladders apart — 40 listings is Agent 2 for a
 * single agent and Office 1 for an office, and they are different prices for
 * different products.
 */
export function impliedTierFor(listings: number, family: PlanFamily): Plan {
  if (family === "agent") {
    if (listings <= 25) return "agent_1";
    if (listings <= 60) return "agent_2";
    return "agent_3";
  }
  if (listings <= 50) return "office_1";
  if (listings <= 150) return "office_2";
  if (listings <= 250) return "office_3";
  if (listings <= 400) return "office_4";
  return "office_5";
}

/**
 * What to tell someone who cannot currently add anything.
 *
 * Worded to be true and not to threaten. Their records are not gone, not
 * hidden, and not held hostage — that was the whole point of choosing
 * read-only over locked. A message that implies otherwise would make the
 * decision pointless.
 */
export function readOnlyMessage(status: BillingStatus): string {
  switch (status) {
    case "past_due":
      return "We couldn't take the last payment, so new listings and new records are paused. Everything already on file stays readable and you can export all of it.";
    case "canceled":
      return "This subscription has ended, so new listings and new records are paused. Everything already on file stays readable and you can export all of it at any time.";
    default:
      return "New listings and new records are paused on this account. Everything already on file stays readable and exportable.";
  }
}
