import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  billingStatusFor,
  planFromLookupKey,
  stripeRequest,
  verifyStripeSignature,
} from "@/lib/billing/stripe";
import { sendTrialEndingEmail } from "@/lib/email/trial-ending";
import { handleTrialWillEnd, willCancelAtTrialEnd, type TrialSubscription } from "@/lib/billing/trial-reminder";
import type { Plan } from "@/lib/billing/entitlement";
import { sendEndedEmail } from "@/lib/subscription-end/emails";

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
      const subscription = event.data.object as StripeSubscription;

      // CANCELLING A FREE TRIAL ENDS IT NOW (Adam, 8 Oct 2026): "If during
      // the free period they cancel, then access should be cut off
      // immediately. They aren't paying for it."
      //
      // Stripe's cancel screen cannot tell a trial from a paid plan, and paid
      // monthly subscribers keep access to the end of the month they paid
      // for (Terms v.4). So the screen books every cancellation for the end
      // of the period, and a trial that has been booked to cancel is ended
      // here instead. Stripe then sends customer.subscription.deleted, the
      // agency ends, and its 14 days on the records page start (DPA cl 4.8).
      if (subscription.status === "trialing" && willCancelAtTrialEnd(subscription as unknown as TrialSubscription)) {
        try {
          await stripeRequest("DELETE", `/subscriptions/${subscription.id}`);
          return;
        } catch (e) {
          // Already cancelled (a replayed event, say), or Stripe refused.
          // Fall through and record what Stripe says rather than failing the
          // event, which would only make Stripe retry it.
          console.error("Stripe webhook: could not end cancelled trial", subscription.id, e instanceof Error ? e.message : e);
        }
      }

      await applySubscription(subscription, null);
      return;
    }

    // The trial reminder. Stripe fires this three days before the trial ends,
    // which is exactly what Terms v.4 cl 2.10(b) promises the subscriber — so
    // unlike the cases above, this one is a contractual obligation rather than
    // a state update. See src/lib/email/trial-ending.ts.
    case "customer.subscription.trial_will_end": {
      await sendTrialReminder(event.data.object as TrialSubscription);
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

  // The subscription has ended. The database has just set ended_at (0054),
  // unless the agency is protected, in which case this sends nothing. The
  // day 0 email goes now rather than at the next daily run; if it fails, the
  // daily run sends it. Never thrown: a 500 here would make Stripe retry an
  // update that has already succeeded.
  if (update.status === "canceled") {
    try {
      await sendEndedEmail(supabase, agencyId, "day0");
    } catch (e) {
      console.error("Stripe webhook: day 0 email failed", agencyId, e instanceof Error ? e.message : e);
    }
  }
}

/**
 * Terms v.4 cl 2.10(b). The decision is in src/lib/billing/trial-reminder.ts,
 * which says when this may throw (only when nothing was sent and a retry could
 * help) and when it must not (Stripe refusing the invoice preview).
 */
async function sendTrialReminder(subscription: TrialSubscription): Promise<void> {
  const supabase = createServiceClient();
  await handleTrialWillEnd(subscription, {
    previewFirstInvoice: (subscriptionId) =>
      stripeRequest<{ amount_due: number; currency: string }>("POST", "/invoices/create_preview", {
        subscription: subscriptionId,
      }),
    agencyIdForCustomer: (customerId) => agencyIdForCustomer(supabase, customerId),
    sendTrialEndingEmail,
  });
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
