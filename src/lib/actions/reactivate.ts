"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { priceIdFor, stripeRequest } from "@/lib/billing/stripe";
import type { Plan } from "@/lib/billing/entitlement";
import type { Profile } from "@/lib/types";
import { endedStateFor } from "@/lib/subscription-end/access";

// Reactivate subscription, from the records page (brief, item 2): back
// through Stripe, and everything returns as it was, straight away.
//
// Stripe cannot restart a cancelled subscription, so this starts a new one
// for the same customer on the same price the old one was on (monthly stays
// monthly, annual stays annual). No trial: the terms allow one trial only.
// When Stripe confirms it, the webhook sets the agency active and the
// database clears ended_at (0054). The write block lifts with it, because it
// reads ended_at at the moment of every write.
//
// Not through requireAuthContext, which sends an ended agency back to the
// records page: this is the one action an ended agency must be able to take.
// Licensee in charge or account holder only, the same two people who can use
// the records page.

export type ReactivateState = { error: string | null };

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.realcomply.com.au";
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function reactivateSubscription(_prev: ReactivateState, _formData: FormData): Promise<ReactivateState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profileRow } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profileRow) redirect("/login");
  const profile = profileRow as Profile;

  const state = await endedStateFor(supabase, profile);
  if (!state) redirect("/dashboard/home");
  if (!state.mayUseRecords) {
    return { error: "Only the licensee in charge or the account holder can reactivate the subscription." };
  }

  const { data: agencyRow } = await supabase
    .from("agencies")
    .select("id, plan, stripe_customer_id, stripe_subscription_id")
    .eq("id", state.agencyId)
    .maybeSingle();
  const agency = agencyRow as {
    id: string;
    plan: Plan;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
  } | null;

  if (!agency?.stripe_customer_id) {
    return { error: "We couldn't find this agency's billing account. Email admin@realcomply.com.au and we'll reactivate it for you." };
  }

  let checkoutUrl: string;
  try {
    // The price the old subscription was on, so nothing changes but the dates.
    let priceId: string | null = null;
    if (agency.stripe_subscription_id) {
      const old = await stripeRequest<{ items?: { data?: Array<{ price?: { id?: string } | null }> } }>(
        "GET",
        `/subscriptions/${agency.stripe_subscription_id}`,
      );
      priceId = old.items?.data?.[0]?.price?.id ?? null;
    }
    priceId ??= await priceIdFor(agency.plan, "monthly");

    const session = await stripeRequest<{ url?: string | null }>("POST", "/checkout/sessions", {
      mode: "subscription",
      customer: agency.stripe_customer_id,
      client_reference_id: agency.id,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      "subscription_data[metadata][agency_id]": agency.id,
      // Same reason as startCheckout in lib/actions/billing.ts.
      "managed_payments[enabled]": "false",
      allow_promotion_codes: "true",
      success_url: `${siteUrl()}/dashboard/records?reactivated=1`,
      cancel_url: `${siteUrl()}/dashboard/records`,
    });
    if (!session.url) return { error: "Stripe didn't return a checkout page. Try again in a moment." };
    checkoutUrl = session.url;
  } catch (e) {
    console.error("reactivateSubscription failed:", e instanceof Error ? e.message : e);
    return { error: "Couldn't start reactivation. We've logged it. Try again, or email admin@realcomply.com.au." };
  }

  // Outside the try: redirect() works by throwing.
  redirect(checkoutUrl);
}
