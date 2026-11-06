import type { SupabaseClient } from "@supabase/supabase-js";
import type { Access } from "@/lib/access";
import type { Plan } from "@/lib/billing/entitlement";
import { stripeConfigured, type Interval } from "@/lib/billing/stripe";
import { bookedChange, readSubscription, type SubscriptionView } from "@/lib/billing/subscription-change";
import { isAccountHolder } from "@/lib/subscription-end/access";
import { createServiceClient } from "@/lib/supabase/service";
import { formatAuDate } from "@/lib/format-date";
import type { Profile } from "@/lib/types";

// What the Change plan pages need, read fresh each time (Adam, 6 Nov 2026).
// Unlike the rest of Billing, this asks Stripe: the amount someone is about
// to pay must be Stripe's, for the subscription as it is now.

export type PlanChangeAgency = {
  id: string;
  name: string;
  plan: Plan;
  status: string;
  licensee_name: string | null;
  licensee_email: string | null;
  stripe_subscription_id: string | null;
};

export type PlanChangeContext =
  | {
      state: "ready";
      agency: PlanChangeAgency;
      sub: SubscriptionView;
      listingCount: number;
      activePeople: number;
      /** A change already booked for the next billing date. */
      booked: { plan: Plan; interval: Interval; at: string } | null;
    }
  | { state: "blocked"; message: string };

/** Whoever pays: the licensee in charge, the agent on their own plan, or the account holder. */
export async function mayChangePlan(supabase: SupabaseClient, access: Access): Promise<boolean> {
  return access.actsAsLicensee || (await isAccountHolder(supabase));
}

export async function planChangeContext(supabase: SupabaseClient, profile: Profile): Promise<PlanChangeContext> {
  const { data } = await supabase
    .from("agencies")
    .select("id, name, plan, status, licensee_name, licensee_email, stripe_subscription_id")
    .eq("id", profile.agency_id)
    .maybeSingle();
  const agency = data as PlanChangeAgency | null;
  if (!agency) return { state: "blocked", message: "Couldn't find your agency. Try reloading the page." };
  if (agency.status === "comped") {
    return {
      state: "blocked",
      message:
        "This is a free account, so there's no plan to change here. Email admin@realcomply.com.au and we'll change it.",
    };
  }
  if (!agency.stripe_subscription_id) {
    return { state: "blocked", message: "There's no subscription yet. Choose a plan on Billing to start one." };
  }
  if (agency.status === "past_due") {
    return {
      state: "blocked",
      message: "We couldn't take the last payment. Update your card in Manage billing, then change plan.",
    };
  }
  if (agency.status === "canceled") return { state: "blocked", message: "This subscription has ended." };
  if (!stripeConfigured()) return { state: "blocked", message: "Billing isn't connected on this site." };

  let sub: SubscriptionView | null;
  try {
    sub = await readSubscription(agency.stripe_subscription_id);
  } catch (e) {
    console.error("plan change: couldn't read the subscription", agency.id, e instanceof Error ? e.message : e);
    return { state: "blocked", message: "We couldn't reach Stripe just now. Try again in a minute." };
  }
  if (!sub) {
    return {
      state: "blocked",
      message: "This subscription can't be changed here. Email admin@realcomply.com.au and we'll change it for you.",
    };
  }
  if (sub.endsAt) {
    return {
      state: "blocked",
      message: `Your subscription is set to end on ${formatAuDate(sub.endsAt)}. To change plan, keep your subscription in Manage billing first.`,
    };
  }
  if (sub.status !== "active" && sub.status !== "trialing") {
    return {
      state: "blocked",
      message: "We couldn't take the last payment. Update your card in Manage billing, then change plan.",
    };
  }

  const service = createServiceClient();
  const [{ data: count }, { count: people }, booked] = await Promise.all([
    supabase.rpc("agency_listing_count", { p_agency_id: agency.id }),
    service
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("agency_id", agency.id)
      .is("archived_at", null),
    sub.scheduleId ? bookedChange(sub.scheduleId).catch(() => null) : Promise.resolve(null),
  ]);

  return {
    state: "ready",
    agency,
    sub,
    listingCount: typeof count === "number" ? count : 0,
    activePeople: typeof people === "number" ? people : 1,
    booked,
  };
}
