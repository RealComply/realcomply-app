import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  billingStatusFor,
  intervalFromLookupKey,
  planFromLookupKey,
  stripeRequest,
  verifyStripeSignature,
} from "@/lib/billing/stripe";
import { sendTrialEndingEmail } from "@/lib/email/trial-ending";
import type { Plan } from "@/lib/billing/entitlement";

// Stripe's side of the conversation.
//
// THE ARCHITECTURAL POINT, restated because this is the file most likely to be
// misread: entitlement is a property of the agency, and this route is one of
// the things that writes to it. Nothing in the app asks Stripe anything at
// render time. If this route were switched off tomorrow, every existing
// account would keep working exactly as it is — it would simply stop learning
// about changes.
//
// The service client is used here, and this is one of the few places that is
// correct. There is no logged-in user: the caller is Stripe. Its own file says
// never to reach it from "a request driven by end-user input", and this is not
// that — the request is accepted only after its signature is verified against
// a secret only Stripe and this deployment hold.
//
// SET STRIPE_WEBHOOK_SECRET. Without it every request is rejected, which is
// the right failure: an unverified request that can move an agency between
// plans is worse than no webhook at all.

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  // request.text(), never request.json(). The signature covers the exact bytes
  // Stripe sent, and parsing then re-encoding produces a different string that
  // will never match.
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!secret) {
    console.error("Stripe webhook rejected: STRIPE_WEBHOOK_SECRET is not set.");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  if (!verifyStripeSignature(rawBody, signature, secret)) {
    console.error("Stripe webhook rejected: bad signature.");
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return NextResponse.json({ error: "Unparseable body" }, { status: 400 });
  }

  try {
    await handle(event);
  } catch (e) {
    // A 500 tells Stripe to retry, which is what we want for a transient
    // failure — the database being briefly unreachable, say. The event is
    // replayable from the Stripe dashboard either way.
    console.error("Stripe webhook failed:", event.type, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  // Everything else gets a 200. An unhandled event type is not an error, and
  // returning anything else teaches Stripe to retry something we will keep
  // ignoring until it gives up and marks the endpoint unhealthy.
  return NextResponse.json({ received: true });
}

// ─────────────────────────────────────────────────────────────────────────

type StripeSubscription = {
  id: string;
  status: string;
  customer: string;
  trial_end: number | null;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string> | null;
  items?: { data?: Array<{ price?: { lookup_key?: string | null } | null }> } | null;
};

type StripeCheckoutSession = {
  client_reference_id?: string | null;
  customer?: string | null;
  subscription?: string | null;
};

type StripeEvent = {
  id: string;
  type: string;
  data: { object: unknown };
};

async function handle(event: StripeEvent): Promise<void> {
  switch (event.type) {
    // The first event of a new subscription, and the only one that carries the
    // agency id — we put it there as client_reference_id, because at this
    // point Stripe has no other way of knowing who the customer is to us.
    case "checkout.session.completed": {
      const session = event.data.object as StripeCheckoutSession;
      const agencyId = session.client_reference_id ?? null;
      if (!session.subscription) return;

      const subscription = await stripeRequest<StripeSubscription>(
        "GET",
        `/subscriptions/${session.subscription}`,
      );
      await applySubscription(subscription, agencyId);
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await applySubscription(event.data.object as StripeSubscription, null);
      return;
    }

    // The trial reminder. Stripe fires this three days before the trial ends,
    // which is exactly what Terms v.4 cl 2.10(b) promises the subscriber — so
    // unlike the cases above, this one is a contractual obligation rather than
    // a state update. See src/lib/email/trial-ending.ts.
    case "customer.subscription.trial_will_end": {
      await sendTrialReminder(event.data.object as StripeSubscription);
      return;
    }

    default:
      return;
  }
}

async function applySubscription(
  subscription: StripeSubscription,
  agencyIdFromSession: string | null,
): Promise<void> {
  const supabase = createServiceClient();

  // Three ways to find the agency, in order of reliability: the id we attached
  // at checkout, the id we copied onto the subscription's metadata, and the
  // customer we recorded when they first subscribed.
  const agencyId =
    agencyIdFromSession ??
    subscription.metadata?.agency_id ??
    (await agencyIdForCustomer(supabase, subscription.customer));

  if (!agencyId) {
    console.error("Stripe webhook: no agency matches subscription", subscription.id);
    return;
  }

  const { data: existing } = await supabase
    .from("agencies")
    .select("stripe_subscription_id")
    .eq("id", agencyId)
    .maybeSingle();

  // Guard against a stale event for a subscription this agency has moved off.
  // Webhooks arrive out of order often enough to matter, and the expensive
  // version of this bug is an old "deleted" event landing after a new
  // subscription and quietly making a paying agency read-only.
  const current = (existing as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id;
  if (current && current !== subscription.id && subscription.status === "canceled") {
    return;
  }

  const lookupKey = subscription.items?.data?.[0]?.price?.lookup_key ?? null;
  const plan: Plan | null = lookupKey ? planFromLookupKey(lookupKey) : null;

  const update: Record<string, unknown> = {
    status: billingStatusFor(subscription.status),
    stripe_customer_id: subscription.customer,
    stripe_subscription_id: subscription.id,
    trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
  };

  // Only write the plan when Stripe actually told us one. A subscription whose
  // price carries no lookup key means someone built a price by hand in the
  // dashboard instead of running the script; overwriting a good plan with a
  // guess would be worse than leaving it and shouting.
  if (plan) {
    update.plan = plan;
  } else {
    console.error(
      "Stripe webhook: subscription",
      subscription.id,
      "has no recognisable lookup key",
      lookupKey,
      "— plan left unchanged.",
    );
  }

  const { error } = await supabase.from("agencies").update(update).eq("id", agencyId);
  if (error) {
    throw new Error(`agencies update failed: ${error.message}`);
  }
}

/**
 * Terms v.4 cl 2.10(b): a reminder three days before the trial expires, naming
 * the date the first payment will be taken and the amount of it.
 *
 * WHY THIS ONE MAY NOT THROW. Everything else in this route throws on failure
 * so Stripe retries. Here that would be wrong in both directions: a retry
 * storm on a transient mail failure sends the same subscriber the same
 * reminder repeatedly, and a 500 on an event Stripe will not usefully replay
 * teaches it the endpoint is unhealthy. A missing reminder is a promise
 * broken once and visible in the logs; a duplicate is a promise broken
 * confusingly, several times, in the subscriber's inbox.
 *
 * So: log loudly, return, and let the 200 stand.
 *
 * The one exception is the Stripe call that prices the first invoice. It runs
 * before anything is sent, so a failure there cannot produce a duplicate —
 * letting it throw gets a retry, which is what a transient Stripe error wants.
 */
async function sendTrialReminder(subscription: StripeSubscription): Promise<void> {
  const lookupKey = subscription.items?.data?.[0]?.price?.lookup_key ?? null;
  const plan = lookupKey ? planFromLookupKey(lookupKey) : null;
  const interval = lookupKey ? intervalFromLookupKey(lookupKey) : null;

  // No guessing the amount. An email that names the wrong figure is worse
  // than one that never arrives, because the subscriber acts on it.
  if (!plan || !interval || !subscription.trial_end) {
    console.error(
      "Stripe webhook: trial_will_end for",
      subscription.id,
      "could not be priced (lookup key",
      lookupKey,
      ", trial_end",
      subscription.trial_end,
      ") — no reminder sent.",
    );
    return;
  }

  // Stripe also fires this event when a trial is ended early, and still fires
  // it for a subscription already set to cancel. Neither will be charged on
  // trial_end, so a reminder naming that date and amount would be false.
  if (
    subscription.status !== "trialing" ||
    subscription.cancel_at_period_end ||
    subscription.trial_end * 1000 <= Date.now()
  ) {
    console.log("Stripe webhook: trial_will_end for", subscription.id, "— not converting, no reminder.");
    return;
  }

  // The amount as Stripe will actually raise it, not the list price: checkout
  // allows promotion codes, so PLANS can be the wrong figure.
  const preview = await stripeRequest<{ amount_due: number; currency: string }>(
    "POST",
    "/invoices/create_preview",
    { subscription: subscription.id },
  );

  if (preview.currency !== "aud" || preview.amount_due <= 0) {
    console.error(
      "Stripe webhook: trial_will_end for",
      subscription.id,
      "previews",
      preview.amount_due,
      preview.currency,
      "— no reminder sent.",
    );
    return;
  }

  const supabase = createServiceClient();
  const agencyId =
    subscription.metadata?.agency_id ?? (await agencyIdForCustomer(supabase, subscription.customer));

  if (!agencyId) {
    console.error("Stripe webhook: trial_will_end — no agency matches", subscription.id);
    return;
  }

  try {
    const sent = await sendTrialEndingEmail({
      agencyId,
      plan,
      interval,
      amountCents: preview.amount_due,
      trialEnd: new Date(subscription.trial_end * 1000),
    });
    if (!sent) {
      console.error("Stripe webhook: trial reminder not sent for agency", agencyId);
    }
  } catch (e) {
    console.error("Stripe webhook: trial reminder threw for agency", agencyId, e);
  }
}

async function agencyIdForCustomer(
  supabase: ReturnType<typeof createServiceClient>,
  customerId: string | null,
): Promise<string | null> {
  if (!customerId) return null;
  const { data } = await supabase
    .from("agencies")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}
