"use server";

import { redirect } from "next/navigation";
import { requireAuthContext } from "@/lib/actions/compliance";
import { PLANS, type Plan } from "@/lib/billing/entitlement";
import { priceIdFor, stripeRequest, type Interval } from "@/lib/billing/stripe";

// Starting and managing a subscription.
//
// Both actions end in a redirect to a page Stripe hosts. That is the whole
// design: card numbers and bank details never touch this application, never
// cross our network, and never appear in a log. It also means there is no
// payment form to build, no PCI surface to defend, and no place for a mistake
// here to cost someone their card details.
//
// LICENSEE ONLY, both. This is the agency's money and the agency's contract,
// and the licensee in charge is the person who answers for both. An agent
// finding a "start subscription" button on a page they can see is a support
// call at best.

export type BillingActionState = { error: string | null };

const TRIAL_DAYS = 30;

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.realcomply.com.au";
}

function isPlan(value: string): value is Plan {
  return value in PLANS;
}

/**
 * Sends the licensee to Stripe's hosted checkout for the plan they picked.
 *
 * The Stripe customer is created once and kept on the agency row. Creating a
 * second one for the same agency is the classic way to end up with two
 * subscriptions, two invoices and a customer who is charged twice — so the
 * existing id is always reused when there is one.
 */
export async function startCheckout(
  _prev: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const { supabase, profile } = await requireAuthContext();

  if (!profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can set up billing for the agency." };
  }

  const planValue = String(formData.get("plan") ?? "");
  const intervalValue = String(formData.get("interval") ?? "monthly");

  if (!isPlan(planValue)) {
    return { error: "Choose a plan first." };
  }
  if (intervalValue !== "monthly" && intervalValue !== "annual") {
    return { error: "Choose monthly or annual." };
  }
  const plan: Plan = planValue;
  const interval: Interval = intervalValue;

  const { data: agencyRow } = await supabase
    .from("agencies")
    .select("id, name, stripe_customer_id, stripe_subscription_id")
    .eq("id", profile.agency_id)
    .maybeSingle();

  const agency = agencyRow as {
    id: string;
    name: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
  } | null;

  if (!agency) {
    return { error: "Couldn't find your agency. Try reloading the page." };
  }

  if (agency.stripe_subscription_id) {
    return {
      error: "This agency already has a subscription. Use Manage billing to change or cancel it.",
    };
  }

  let checkoutUrl: string;

  try {
    const priceId = await priceIdFor(plan, interval);
    const customerId = agency.stripe_customer_id ?? (await createCustomer(supabase, agency, profile.email));

    const session = await stripeRequest<{ url?: string | null }>("POST", "/checkout/sessions", {
      mode: "subscription",
      customer: customerId,
      // How the webhook knows whose subscription this is. Stripe has no other
      // way of connecting a customer it has just created to an agency row.
      client_reference_id: agency.id,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      "subscription_data[trial_period_days]": String(TRIAL_DAYS),
      // Belt and braces with client_reference_id above: that only appears on
      // the checkout event, while this rides on every subscription event for
      // the life of the subscription.
      "subscription_data[metadata][agency_id]": agency.id,
      // Deliberately not set: payment_method_types. Left alone, Stripe offers
      // whatever is enabled in the dashboard — so the day BECS Direct Debit is
      // switched on there, it appears here with no deploy. Naming the methods
      // in code would mean checkout breaking today, because BECS is not on yet.
      allow_promotion_codes: "true",
      success_url: `${siteUrl()}/dashboard/billing?started=1`,
      cancel_url: `${siteUrl()}/dashboard/billing?cancelled=1`,
    });

    if (!session.url) {
      return { error: "Stripe didn't return a checkout page. Try again in a moment." };
    }
    checkoutUrl = session.url;
  } catch (e) {
    // The price cross-check in priceIdFor throws here when Stripe's amount
    // disagrees with the advertised one. That is deliberately loud and
    // deliberately fatal — see the reasoning there.
    console.error("startCheckout failed:", e instanceof Error ? e.message : e);
    return { error: "Couldn't start checkout. We've logged it — try again, and tell us if it persists." };
  }

  // Outside the try. redirect() works by throwing, and catching it would turn
  // a successful redirect into the error message above.
  redirect(checkoutUrl);
}

/**
 * Stripe's own billing portal: change card, switch plan, see invoices, cancel.
 *
 * Everything in here would otherwise be a screen to build and maintain, and
 * each of those screens would be a place to get someone's money wrong.
 */
// Both parameters are unused and both must exist: this is driven by
// useActionState, which always calls its action with (previousState, payload).
// The portal takes no input — everything it needs is on the agency row.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function openBillingPortal(_prev: BillingActionState, _formData: FormData): Promise<BillingActionState> {
  const { supabase, profile } = await requireAuthContext();

  if (!profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can manage billing." };
  }

  const { data: agencyRow } = await supabase
    .from("agencies")
    .select("stripe_customer_id")
    .eq("id", profile.agency_id)
    .maybeSingle();

  const customerId = (agencyRow as { stripe_customer_id?: string | null } | null)?.stripe_customer_id;
  if (!customerId) {
    return { error: "There's no subscription on this account yet." };
  }

  let portalUrl: string;
  try {
    const session = await stripeRequest<{ url?: string | null }>("POST", "/billing_portal/sessions", {
      customer: customerId,
      return_url: `${siteUrl()}/dashboard/billing`,
    });
    if (!session.url) {
      return { error: "Stripe didn't return a billing page. Try again in a moment." };
    }
    portalUrl = session.url;
  } catch (e) {
    console.error("openBillingPortal failed:", e instanceof Error ? e.message : e);
    return { error: "Couldn't open the billing page. Try again in a moment." };
  }

  redirect(portalUrl);
}

async function createCustomer(
  supabase: Awaited<ReturnType<typeof requireAuthContext>>["supabase"],
  agency: { id: string; name: string },
  email: string,
): Promise<string> {
  const customer = await stripeRequest<{ id: string }>("POST", "/customers", {
    name: agency.name,
    email,
    "metadata[agency_id]": agency.id,
  });

  // Written back immediately, before checkout is even offered. If this row
  // update were left until the webhook, a licensee who started checkout and
  // abandoned it would get a fresh Stripe customer on every attempt, and the
  // dashboard would fill with duplicates of the same agency.
  await supabase.from("agencies").update({ stripe_customer_id: customer.id }).eq("id", agency.id);

  return customer.id;
}
