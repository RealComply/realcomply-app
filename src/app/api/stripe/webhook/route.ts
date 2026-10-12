import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  billingStatusFor,
  planFromLookupKey,
  StripeApiError,
  stripeRequest,
  verifyStripeSignature,
} from "@/lib/billing/stripe";
import { sendTrialEndingEmail } from "@/lib/email/trial-ending";
import { handleTrialWillEnd, willCancelAtTrialEnd } from "@/lib/billing/trial-reminder";
import type { Plan } from "@/lib/billing/entitlement";
import { sendEndedEmail } from "@/lib/subscription-end/emails";
import { sendEarlyAccessWelcome } from "@/lib/early-access/welcome";

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
  /** Epoch seconds. Tells which of two subscriptions is the newer. */
  created: number;
  trial_end: number | null;
  cancel_at_period_end?: boolean;
  /** Epoch seconds. Set when the subscriber picked a cancellation date. */
  cancel_at?: number | null;
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

// STRIPE IS ASKED; THE MESSAGE IS NOT BELIEVED (code review fixes, part A,
// 12 Oct 2026). A message only says that something may have changed. Every
// one, of every kind, is answered by fetching the subscription from Stripe as
// it stands now, and only that is written. A message that arrives late, twice
// or out of order therefore writes what is true now, which is already there:
// an old "active" replayed after the cancellation finds the subscription
// cancelled, and the office stays ended.
//
// And a message only counts if it is about the office's current subscription
// (whyNotCurrent). A newer subscription is never replaced by an older one.
async function handle(event: StripeEvent): Promise<void> {
  switch (event.type) {
    // The first event of a new subscription, and the only one that carries the
    // agency id — we put it there as client_reference_id, because at this
    // point Stripe has no other way of knowing who the customer is to us. It
    // is also the only message that can give an office a new subscription.
    case "checkout.session.completed": {
      const session = event.data.object as StripeCheckoutSession;
      if (!session.subscription) return;

      const subscription = await subscriptionNow(session.subscription);
      if (!subscription) return;
      await applySubscription(subscription, {
        agencyIdFromSession: session.client_reference_id ?? null,
        fromCheckout: true,
      });
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = await subscriptionNow((event.data.object as { id?: string }).id);
      if (!subscription) return;
      await applySubscription(subscription, { agencyIdFromSession: null, fromCheckout: false });
      return;
    }

    // The trial reminder. Stripe fires this three days before the trial ends,
    // which is exactly what Terms v.4 cl 2.10(b) promises the subscriber — so
    // unlike the cases above, this one is a contractual obligation rather than
    // a state update. See src/lib/email/trial-ending.ts.
    case "customer.subscription.trial_will_end": {
      const subscription = await subscriptionNow((event.data.object as { id?: string }).id);
      if (!subscription) return;
      await sendTrialReminder(subscription);
      return;
    }

    default:
      return;
  }
}

/**
 * The subscription as Stripe has it now. Null when Stripe has no such
 * subscription (a sandbox message sent to the live endpoint, say): asking
 * again would get the same answer, so the message is acknowledged and dropped
 * rather than retried for days. Any other failure throws, and Stripe retries.
 */
async function subscriptionNow(id: string | null | undefined): Promise<StripeSubscription | null> {
  if (!id) return null;
  try {
    return await stripeRequest<StripeSubscription>("GET", `/subscriptions/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof StripeApiError && e.status === 404) {
      console.error("Stripe webhook: Stripe has no subscription", id, "— message ignored.");
      return null;
    }
    throw e;
  }
}

type AgencyBilling = { status: string | null; stripe_subscription_id: string | null };

/**
 * Null when the message is about this office's current subscription and may
 * be acted on; otherwise the reason it is left alone, for the log.
 *
 *  - A free (comped) office is set by hand and only a person changes it. A
 *    Stripe subscription it had before is not cancelled by the switch, and
 *    its messages must not make the office past due or ended (finding 13).
 *    The billing page never offers a comped office a checkout.
 *  - The subscription on file is the current one. A message about any other
 *    is ignored (finding 4), with one exception:
 *  - a completed checkout gives the office the subscription it started, when
 *    the office has none on file or the one on file is older. A checkout
 *    whose subscription has already ended, replayed later, changes nothing.
 */
async function whyNotCurrent(
  agency: AgencyBilling,
  subscription: StripeSubscription,
  fromCheckout: boolean,
): Promise<string | null> {
  // No status reads as comped, as it does in entitlement.ts.
  if ((agency.status ?? "comped") === "comped") return "the office is free (comped), which only a person changes";

  const onFile = agency.stripe_subscription_id;
  if (onFile === subscription.id) return null;

  if (!fromCheckout) {
    return onFile ? `it is not the office's subscription (${onFile} is)` : "the office has no subscription on file yet";
  }
  if (subscription.status === "canceled" || subscription.status === "incomplete_expired") {
    return "the checkout's subscription has already ended";
  }
  if (onFile) {
    const current = await subscriptionNow(onFile);
    if (current && current.created >= subscription.created) return `the office's subscription ${onFile} is newer`;
  }
  return null;
}

async function applySubscription(
  first: StripeSubscription,
  opts: { agencyIdFromSession: string | null; fromCheckout: boolean },
): Promise<void> {
  const supabase = createServiceClient();

  // Three ways to find the agency, in order of reliability: the id we attached
  // at checkout, the id we copied onto the subscription's metadata, and the
  // customer we recorded when they first subscribed.
  const agencyId =
    opts.agencyIdFromSession ??
    first.metadata?.agency_id ??
    (await agencyIdForCustomer(supabase, first.customer));

  if (!agencyId) {
    console.error("Stripe webhook: no agency matches subscription", first.id);
    return;
  }

  const agency = await readAgencyBilling(supabase, agencyId);
  if (!agency) {
    console.error("Stripe webhook: agency", agencyId, "not found for subscription", first.id);
    return;
  }

  const refusal = await whyNotCurrent(agency, first, opts.fromCheckout);
  if (refusal) {
    console.log(`Stripe webhook: ${first.id} left alone for agency ${agencyId}: ${refusal}.`);
    return;
  }

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
  if (!opts.fromCheckout && first.status === "trialing" && willCancelAtTrialEnd(first)) {
    try {
      await stripeRequest("DELETE", `/subscriptions/${first.id}`);
      return;
    } catch (e) {
      // Already cancelled (a replayed event, say), or Stripe refused.
      // Fall through and record what Stripe says rather than failing the
      // event, which would only make Stripe retry it.
      console.error("Stripe webhook: could not end cancelled trial", first.id, e instanceof Error ? e.message : e);
    }
  }

  // Written, then Stripe is asked once more. Two messages handled at the same
  // moment can each read Stripe and then write in the other order; whichever
  // finishes last has read Stripe after its own write, and writes again if
  // Stripe has moved on. The write only lands while the office's subscription
  // is still the one read above (writeIfStillCurrent).
  let onFile = agency.stripe_subscription_id;
  let update = billingUpdateFor(first);
  for (let round = 1; ; round++) {
    await writeIfStillCurrent(supabase, agencyId, onFile, update);
    onFile = first.id;

    const again = await subscriptionNow(first.id);
    if (!again) break;
    const next = billingUpdateFor(again);
    if (JSON.stringify(next) === JSON.stringify(update)) break;
    if (round === 3) throw new Error(`subscription ${first.id} kept changing while it was being recorded`);
    update = next;
  }

  // Only write the plan when Stripe actually told us one. A subscription whose
  // price carries no lookup key means someone built a price by hand in the
  // dashboard instead of running the script; overwriting a good plan with a
  // guess would be worse than leaving it and shouting.
  if (!("plan" in update)) {
    console.error(
      "Stripe webhook: subscription",
      first.id,
      "has no recognisable lookup key",
      first.items?.data?.[0]?.price?.lookup_key ?? null,
      "— plan left unchanged.",
    );
  }

  // The card is in and the trial has started: the moment someone from the
  // early access list gets their welcome (Adam, 11 Oct 2026), and only from
  // checkout, so a later renewal never sends one. Once only, switched off
  // unless EARLY_ACCESS_WELCOME_EMAIL=on, and never throws. See
  // lib/early-access/welcome.ts.
  if (opts.fromCheckout && (update.status === "trialing" || update.status === "active")) {
    const outcome = await sendEarlyAccessWelcome(supabase, agencyId);
    if (outcome !== "not_early_access") console.info("early access welcome:", outcome, agencyId);
  }

  // The subscription has ended. The database has just set ended_at (0054),
  // unless the agency is protected, in which case this sends nothing. The
  // day 0 email goes now rather than at the next daily run; if it fails, the
  // daily run sends it. It goes once: a repeat of this message finds it sent.
  // Never thrown: a 500 here would make Stripe retry an update that has
  // already succeeded.
  if (update.status === "canceled") {
    try {
      await sendEndedEmail(supabase, agencyId, "day0");
    } catch (e) {
      console.error("Stripe webhook: day 0 email failed", agencyId, e instanceof Error ? e.message : e);
    }
  }
}

/** What Stripe's copy of the subscription means for the agency row. */
function billingUpdateFor(subscription: StripeSubscription): Record<string, unknown> {
  const update: Record<string, unknown> = {
    status: billingStatusFor(subscription.status),
    stripe_customer_id: subscription.customer,
    stripe_subscription_id: subscription.id,
    trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
  };
  const lookupKey = subscription.items?.data?.[0]?.price?.lookup_key ?? null;
  const plan: Plan | null = lookupKey ? planFromLookupKey(lookupKey) : null;
  if (plan) update.plan = plan;
  return update;
}

/**
 * The update, only while the office's subscription on file is still `onFile`
 * and the office is not comped. If either changed since it was read (another
 * message, or a person switching the office to free), nothing is written and
 * this throws: Stripe sends the message again, and it is judged afresh.
 */
async function writeIfStillCurrent(
  supabase: ReturnType<typeof createServiceClient>,
  agencyId: string,
  onFile: string | null,
  update: Record<string, unknown>,
): Promise<void> {
  const query = supabase.from("agencies").update(update).eq("id", agencyId).neq("status", "comped");
  const { data, error } = await (onFile
    ? query.eq("stripe_subscription_id", onFile)
    : query.is("stripe_subscription_id", null)
  ).select("id");
  if (error) {
    throw new Error(`agencies update failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error(`agency ${agencyId} changed while a Stripe message was being handled; Stripe will send it again`);
  }
}

async function readAgencyBilling(
  supabase: ReturnType<typeof createServiceClient>,
  agencyId: string,
): Promise<AgencyBilling | null> {
  const { data, error } = await supabase
    .from("agencies")
    .select("status, stripe_subscription_id")
    .eq("id", agencyId)
    .maybeSingle();
  // A read that fails is not "no agency": throw, and Stripe retries.
  if (error) throw new Error(`agencies read failed: ${error.message}`);
  return (data as AgencyBilling | null) ?? null;
}

/**
 * Terms v.4 cl 2.10(b). The decision is in src/lib/billing/trial-reminder.ts,
 * which says when this may throw (only when nothing was sent and a retry could
 * help) and when it must not (Stripe refusing the invoice preview). Sent only
 * for the office's current subscription, as Stripe has it now.
 */
async function sendTrialReminder(subscription: StripeSubscription): Promise<void> {
  const supabase = createServiceClient();
  const agencyId = subscription.metadata?.agency_id ?? (await agencyIdForCustomer(supabase, subscription.customer));
  const agency = agencyId ? await readAgencyBilling(supabase, agencyId) : null;
  if (agency) {
    const refusal = await whyNotCurrent(agency, subscription, false);
    if (refusal) {
      console.log(`Stripe webhook: trial_will_end for ${subscription.id} — no reminder: ${refusal}.`);
      return;
    }
  }
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
