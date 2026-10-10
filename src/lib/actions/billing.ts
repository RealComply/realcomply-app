"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuthContext } from "@/lib/actions/compliance";
import { PLANS, TRIAL_DAYS, type Plan } from "@/lib/billing/entitlement";
import { isAccountHolder } from "@/lib/subscription-end/access";
import { priceIdFor, stripeRequest, type Interval } from "@/lib/billing/stripe";
import { checkStoredCustomer } from "@/lib/billing/customer";

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
//
// Widened to whoever pays (9-10 Oct 2026): the licensee in charge, the agent
// on their own plan, or the account holder. The same people the Billing page
// lets in. Starting checkout was widened on 9 Oct and the billing portal was
// not, so the person whose card it was could subscribe but never cancel.

export type BillingActionState = { error: string | null };


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
  const { supabase, profile, access } = await requireAuthContext();

  // The licensee in charge, or the account holder (whoever created the
  // agency). On an individual agent plan the account holder is the agent and
  // often not a licensee in charge, and since 9 Oct 2026 a new office cannot
  // use RealComply at all until this has run, so they must be able to. The
  // agent on their own plan also counts as the licensee (lib/access.ts), the
  // same rule the Billing page uses to let them in.
  if (!profile.is_licensee_in_charge && !access.actsAsLicensee && !(await isAccountHolder(supabase))) {
    return { error: "Only the licensee in charge or the account holder can set up billing for the agency." };
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
    // The stored customer is used only once Stripe confirms it is this
    // agency's (10 Oct 2026); see checkStoredCustomer. One Stripe no longer
    // has is replaced with a new one, which the database allows while there
    // is no subscription (0060). One made for another agency is never used.
    let customerId = agency.stripe_customer_id;
    let staleId: string | null = null;
    if (customerId) {
      const stored = await checkStoredCustomer(customerId, agency.id);
      if (stored === "not-ours") {
        console.error(`startCheckout: agency ${agency.id} holds a Stripe customer made for another agency.`);
        return {
          error: "Couldn't start checkout. We've logged it. Email admin@realcomply.com.au and we'll sort it out.",
        };
      }
      if (stored === "gone") {
        staleId = customerId;
        customerId = null;
      }
    }

    // Stripe's redirect back can beat its webhook, and until the webhook
    // lands stripe_subscription_id above is still empty. A second press in
    // that gap started a second checkout on the same customer: two trials,
    // then two charges (10 Oct 2026). Stripe already knows, so ask it.
    if (customerId && (await hasLiveSubscription(customerId))) {
      return {
        error:
          "Stripe already has a subscription for this agency and is still confirming it. Reload this page in a minute, and email admin@realcomply.com.au if it doesn't clear.",
      };
    }

    const priceId = await priceIdFor(plan, interval);
    customerId ??= await createCustomer(supabase, agency, profile.email, staleId);

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
      //
      // MANAGED PAYMENTS, EXPLICITLY OFF. 9 Sep 2026, and it is the one place
      // this integration overrides an account-level default on purpose.
      //
      // Managed Payments is Stripe's merchant-of-record product: Stripe becomes
      // the seller to the customer, calculates and remits that customer's local
      // sales tax, and charges more for doing it. Stripe turns it on by DEFAULT
      // for new accounts, and it refuses any line item whose product carries no
      // tax_code — which is what broke checkout with "the product tax code is
      // missing" and cost an afternoon.
      //
      // We do not want it. Adam, 9 Sep 2026: "GST is the same across every
      // client." An Australian company selling to Australian agencies, prices
      // already tax_behavior: inclusive, GST handled by the business. What
      // merchant-of-record sells is cross-border tax handling we have no use
      // for. There is also an unanswered question about whether it supports
      // BECS Direct Debit, and BECS with its $3.50 fee cap is a large part of
      // why Stripe was chosen for the office tiers.
      //
      // WHY IN CODE RATHER THAN THE DASHBOARD SWITCH. The dashboard was the
      // first plan and the setting reads "not set up" on an account that has
      // never accepted the Managed Payments terms — so there is nothing to
      // turn off, while the default still applies to the session. Setting it
      // here is unambiguous, and it is also the only version that survives the
      // move to live: the live account carries the same default, and the first
      // real customer's checkout would have failed exactly as ours did.
      "managed_payments[enabled]": "false",
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
  const { supabase, profile, access } = await requireAuthContext();

  // Same rule as the Billing page (10 Oct 2026). Licensee only left the agent
  // on their own plan, and an office founder who is not the licensee, with a
  // subscription they had started and no way to cancel it or change the card.
  if (!access.actsAsLicensee && !(await isAccountHolder(supabase))) {
    return { error: "Only the licensee in charge or the account holder can manage billing." };
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
    // Stripe is asked whose customer this is before its billing page opens
    // (10 Oct 2026). Anyone in the office can read the id on the row, so on
    // its own it does not show the customer is this agency's, and the portal
    // can cancel a subscription, change the card and show the invoices.
    const stored = await checkStoredCustomer(customerId, profile.agency_id);
    if (stored === "gone") {
      return {
        error: "Stripe no longer has this account's billing details. Email admin@realcomply.com.au and we'll sort it out.",
      };
    }
    if (stored === "not-ours") {
      console.error(`openBillingPortal: agency ${profile.agency_id} holds a Stripe customer made for another agency.`);
      return { error: "Couldn't open the billing page. We've logged it. Email admin@realcomply.com.au." };
    }

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
  /** A stored id Stripe no longer has, which this one replaces. */
  replacing: string | null = null,
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
  //
  // THROUGH set_agency_stripe_customer, NOT AN UPDATE (10 Oct 2026). The
  // update was refused every time: the billing-column guard (0044, 0054)
  // lets nobody but a platform admin change stripe_customer_id, and the
  // error was never read, so every attempt made a new customer. The function
  // records it while the agency has no subscription yet (replacing any id
  // stored before, so one Stripe no longer has can be swapped out), keeps
  // the one already there once a subscription exists, and refuses an id
  // another agency holds. It hands back what is now on the row. Until it has
  // run in the database this logs and goes on as before.
  //
  // If it hands back a dead id we asked it to replace, this checkout still
  // goes ahead on the new customer.
  const { data, error } = await supabase.rpc("set_agency_stripe_customer", { p_customer_id: customer.id });
  if (error) {
    console.error("createCustomer could not record the Stripe customer:", error.message);
    return customer.id;
  }
  if (replacing && data === replacing) {
    console.error("createCustomer could not replace a Stripe customer that no longer exists.");
    return customer.id;
  }
  return typeof data === "string" && data ? data : customer.id;
}

/**
 * Whether the Stripe customer already has a subscription that is running:
 * trialing, active, behind on payment, or paused. A cancelled or expired one
 * does not count, so an agency can subscribe again.
 */
async function hasLiveSubscription(customerId: string): Promise<boolean> {
  const list = await stripeRequest<{ data?: Array<{ status?: string }> }>(
    "GET",
    `/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=20`,
  );
  return (list.data ?? []).some((sub) =>
    ["trialing", "active", "past_due", "unpaid", "paused"].includes(sub.status ?? ""),
  );
}

// ── The RealComply master switch ────────────────────────────────────────
//
// Adam, 9 Sep 2026: "Am I going to have to do this every time I want to test
// it? Is there a way we can make it accessible from my account only? Let's
// call my account the RealComply Master account."
//
// Putting an agency on a trial to test checkout, and back to free afterwards,
// was two SQL scripts pasted into the database console. Fine once, wrong as a
// routine — and the same manual dance would be how a real design partner got
// comped later, on a live account, at the point where a mistake costs money.
//
// PLATFORM ADMIN, NOT LICENSEE. Setting a plan or comping an account is not an
// agency-level act, and the check here is the whole reason the flag exists.
// Migration 0044 also puts a trigger on the table, so this is enforced in the
// database as well as here: a licensee who found their way to the Supabase
// client directly still cannot write these columns.
//
// The flag is granted in SQL and deliberately has no interface. A screen that
// can promote someone to platform admin is a screen that can be tricked into
// promoting someone to platform admin.
export async function setAgencyBillingAsMaster(
  _prev: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const { supabase, profile } = await requireAuthContext();

  if (profile.is_platform_admin !== true) {
    return { error: "Only a RealComply master account can change a plan here." };
  }

  const mode = String(formData.get("mode") ?? "");
  const plan = String(formData.get("plan") ?? "office_1");

  if (!(plan in PLANS)) {
    return { error: "That isn't a plan." };
  }

  // Whichever agency the master is signed in to. Cross-agency comping needs an
  // agency picker and there is exactly one agency today; building the picker
  // now would be designing against an imagined second customer.
  const agencyId = profile.agency_id;

  if (mode === "trial") {
    const { error } = await supabase
      .from("agencies")
      .update({
        status: "trialing",
        plan,
        trial_ends_at: new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString(),
      })
      .eq("id", agencyId);
    if (error) {
      console.error("setAgencyBillingAsMaster trial failed:", error.message);
      return { error: "Couldn't put this agency on a trial." };
    }
  } else if (mode === "free") {
    // Clearing the Stripe ids is the half that gets forgotten by hand. A
    // sandbox customer id left on a row points at nothing once the account is
    // live, and it is the first thing anyone will read and believe when
    // billing misbehaves.
    const { error } = await supabase
      .from("agencies")
      .update({
        status: "comped",
        plan,
        trial_ends_at: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        comped_by: profile.id,
        comped_reason: String(formData.get("reason") ?? "").trim() || "Design partner",
        comped_until: null,
      })
      .eq("id", agencyId);
    if (error) {
      console.error("setAgencyBillingAsMaster free failed:", error.message);
      return { error: "Couldn't put this agency back to a free account." };
    }
  } else {
    return { error: "Choose what to set it to." };
  }

  // The whole dashboard, not just Billing (10 Oct 2026): the switch is also on
  // the start-your-trial page, which the layout shows in place of any page,
  // and that has to lift (or appear) wherever the admin is.
  revalidatePath("/dashboard", "layout");
  return { error: null };
}
