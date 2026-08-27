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

export type Plan = "agent" | "office_1" | "office_2" | "office_3" | "office_4" | "office_5";
export type BillingStatus = "trialing" | "active" | "past_due" | "canceled" | "comped";

export type PlanSpec = {
  plan: Plan;
  name: string;
  /** GST-inclusive monthly price in whole dollars, as advertised. */
  price: number;
  /** Listings a year this tier covers. Null for the agent plan, which is one person. */
  maxListings: number | null;
  /** Agency-level compliance: registers, trust accounts, SG manual, training, team. */
  officeCompliance: boolean;
  blurb: string;
};

// The ladder, in one place. Prices are GST inclusive per the pricing doc —
// quoting anything else to an Australian small business is the wrong number.
//
// KEEP IN SYNC with office_tier_for() in migration 0036 and with the two
// pricing cards on the public landing page (search "Straightforward pricing").
// Three copies is two too many; the database one is authoritative for deciding
// a tier, this one is for showing it, and the landing page shows entry prices
// only.
export const PLANS: Record<Plan, PlanSpec> = {
  agent: {
    plan: "agent",
    name: "Agent",
    price: 99,
    maxListings: null,
    officeCompliance: false,
    blurb: "One agent, their own listings.",
  },
  office_1: { plan: "office_1", name: "Office 1", price: 249, maxListings: 50, officeCompliance: true, blurb: "Up to 50 listings a year." },
  office_2: { plan: "office_2", name: "Office 2", price: 349, maxListings: 150, officeCompliance: true, blurb: "51 to 150 listings a year." },
  office_3: { plan: "office_3", name: "Office 3", price: 549, maxListings: 250, officeCompliance: true, blurb: "151 to 250 listings a year." },
  office_4: { plan: "office_4", name: "Office 4", price: 749, maxListings: 400, officeCompliance: true, blurb: "251 to 400 listings a year." },
  office_5: { plan: "office_5", name: "Office 5", price: 1049, maxListings: null, officeCompliance: true, blurb: "More than 400 listings a year." },
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
  /** The tier that listing count implies, which may be above the current plan. */
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
    impliedTier: impliedTierFor(listingCount),
    approachingLimit: cap != null && listingCount >= Math.floor(cap * WARN_AT) && listingCount <= cap,
    overLimit: cap != null && listingCount > cap,
  };
}

/** Mirrors office_tier_for() in 0036. The database decides; this shows. */
export function impliedTierFor(listings: number): Plan {
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
