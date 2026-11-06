import { intervalFromLookupKey, planFromLookupKey, stripeRequest, type Interval } from "./stripe";
import type { Plan } from "./entitlement";

// The Stripe side of self-serve plan changes (Adam, 6 Nov 2026). Over the
// same plain fetch as the rest of billing (stripe.ts), with the request
// function passed in so the calls can be checked without Stripe.
//
// Stripe is asked, never assumed: the change page reads the subscription as
// Stripe has it now, the amount shown is Stripe's own preview, and the same
// preview is asked again, for the same moment (proration_date), before
// anything is charged. If the two differ, nothing is charged.

export type StripeRequest = typeof stripeRequest;

type RawPrice = { id?: string; lookup_key?: string | null } | null | undefined;

type RawSubscription = {
  id: string;
  status: string;
  customer: string;
  livemode?: boolean;
  trial_end?: number | null;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  schedule?: string | { id?: string } | null;
  current_period_end?: number | null;
  items?: { data?: Array<{ id?: string; price?: RawPrice; current_period_end?: number | null }> } | null;
};

export type SubscriptionView = {
  id: string;
  status: string;
  customer: string;
  livemode: boolean;
  itemId: string;
  priceId: string;
  plan: Plan;
  interval: Interval;
  /** When the current billing period ends: the next billing date (ISO). */
  periodEnd: string;
  /** When the free trial ends (ISO), if it hasn't. */
  trialEnd: string | null;
  /** Booked to end (at the period end, or on a date). */
  endsAt: string | null;
  /** A schedule is attached: a change booked for the next billing date. */
  scheduleId: string | null;
};

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/**
 * Stripe's subscription, in the few facts a plan change needs. Null when it
 * has more than one item or a price the app doesn't know: not something to
 * change from a self-serve page.
 */
export function subscriptionViewFrom(raw: RawSubscription, now: Date = new Date()): SubscriptionView | null {
  const items = raw.items?.data ?? [];
  if (items.length !== 1) return null;
  const item = items[0];
  const lookupKey = item.price?.lookup_key ?? null;
  const plan = lookupKey ? planFromLookupKey(lookupKey) : null;
  const interval = lookupKey ? intervalFromLookupKey(lookupKey) : null;
  // Since 2025 the period sits on the item; older versions had it on the subscription.
  const periodEnd = item.current_period_end ?? raw.current_period_end ?? null;
  if (!item.id || !item.price?.id || !plan || !interval || !periodEnd) return null;
  const trialEnd =
    raw.status === "trialing" && raw.trial_end && raw.trial_end * 1000 > now.getTime() ? iso(raw.trial_end) : null;
  const endsAt = raw.cancel_at_period_end ? iso(periodEnd) : raw.cancel_at ? iso(raw.cancel_at) : null;
  const schedule = typeof raw.schedule === "string" ? raw.schedule : (raw.schedule?.id ?? null);
  return {
    id: raw.id,
    status: raw.status,
    customer: raw.customer,
    livemode: raw.livemode === true,
    itemId: item.id,
    priceId: item.price.id,
    plan,
    interval,
    periodEnd: iso(periodEnd),
    trialEnd,
    endsAt,
    scheduleId: schedule,
  };
}

export async function readSubscription(
  id: string,
  request: StripeRequest = stripeRequest,
): Promise<SubscriptionView | null> {
  const raw = await request<RawSubscription>("GET", `/subscriptions/${encodeURIComponent(id)}`);
  return subscriptionViewFrom(raw);
}

/** What changing to this price now would charge today, in cents (Stripe's own preview). */
export async function previewNow(
  sub: SubscriptionView,
  priceId: string,
  prorationDate: number,
  request: StripeRequest = stripeRequest,
): Promise<number> {
  const preview = await request<{ amount_due?: number }>("POST", "/invoices/create_preview", {
    customer: sub.customer,
    subscription: sub.id,
    "subscription_details[items][0][id]": sub.itemId,
    "subscription_details[items][0][price]": priceId,
    "subscription_details[proration_behavior]": "always_invoice",
    "subscription_details[proration_date]": String(prorationDate),
  });
  return Math.max(0, preview.amount_due ?? 0);
}

export type AppliedNow = { invoiceId: string | null; amountPaidCents: number };

/**
 * The change, now. With prorate, the difference is invoiced and paid
 * straight away, and if the card can't pay it nothing changes
 * (error_if_incomplete). Without (the free trial), the price simply changes.
 */
export async function applyNow(
  sub: SubscriptionView,
  priceId: string,
  opts: { prorate: boolean; prorationDate: number; agencyId: string },
  request: StripeRequest = stripeRequest,
): Promise<AppliedNow> {
  const params: Record<string, string> = {
    "items[0][id]": sub.itemId,
    "items[0][price]": priceId,
    proration_behavior: opts.prorate ? "always_invoice" : "none",
    "metadata[agency_id]": opts.agencyId,
    "expand[0]": "latest_invoice",
  };
  if (opts.prorate) {
    params.proration_date = String(opts.prorationDate);
    params.payment_behavior = "error_if_incomplete";
  }
  const updated = await request<{ latest_invoice?: { id?: string; amount_paid?: number } | string | null }>(
    "POST",
    `/subscriptions/${encodeURIComponent(sub.id)}`,
    params,
  );
  const invoice = typeof updated.latest_invoice === "object" ? updated.latest_invoice : null;
  return {
    invoiceId: opts.prorate ? (invoice?.id ?? null) : null,
    amountPaidCents: opts.prorate ? Math.max(0, invoice?.amount_paid ?? 0) : 0,
  };
}

type RawSchedule = {
  id: string;
  phases?: Array<{ start_date?: number; end_date?: number; items?: Array<{ price?: string | { id?: string } }> }>;
};

/**
 * Books a change for the next billing date: a schedule made from the
 * subscription, its current phase left as it is, then the new price from the
 * end of it. Released afterwards, so the subscription carries on by itself.
 * Any schedule already attached is released first (one booked change at a time).
 */
export async function scheduleNext(
  sub: SubscriptionView,
  currentPriceId: string,
  nextPriceId: string,
  nextInterval: Interval,
  request: StripeRequest = stripeRequest,
): Promise<string> {
  if (sub.scheduleId) await releaseSchedule(sub.scheduleId, request);
  const made = await request<RawSchedule>("POST", "/subscription_schedules", { from_subscription: sub.id });
  const phase = made.phases?.[0];
  if (!phase?.start_date || !phase.end_date) {
    await releaseSchedule(made.id, request);
    throw new Error(`Stripe schedule ${made.id} has no current phase dates.`);
  }
  try {
    await request("POST", `/subscription_schedules/${encodeURIComponent(made.id)}`, {
      end_behavior: "release",
      "phases[0][start_date]": String(phase.start_date),
      "phases[0][end_date]": String(phase.end_date),
      "phases[0][items][0][price]": currentPriceId,
      "phases[0][items][0][quantity]": "1",
      "phases[1][items][0][price]": nextPriceId,
      "phases[1][items][0][quantity]": "1",
      "phases[1][duration][interval]": nextInterval === "annual" ? "year" : "month",
      "phases[1][duration][interval_count]": "1",
      "phases[1][proration_behavior]": "none",
      "metadata[realcomply]": "plan_change",
    });
  } catch (e) {
    // Never leave a half-made schedule on someone's subscription.
    await releaseSchedule(made.id, request).catch(() => undefined);
    throw e;
  }
  return made.id;
}

/** Takes a booked change off: the subscription carries on as it is. */
export async function releaseSchedule(scheduleId: string, request: StripeRequest = stripeRequest): Promise<void> {
  await request("POST", `/subscription_schedules/${encodeURIComponent(scheduleId)}/release`, {});
}

/** What a booked change will make the subscription, and when. Null when it isn't a plain one-change schedule. */
export async function bookedChange(
  scheduleId: string,
  request: StripeRequest = stripeRequest,
): Promise<{ plan: Plan; interval: Interval; at: string } | null> {
  const schedule = await request<{
    phases?: Array<{ start_date?: number; items?: Array<{ price?: RawPrice | string }> }>;
  }>("GET", `/subscription_schedules/${encodeURIComponent(scheduleId)}?expand[]=phases.items.price`);
  const last = schedule.phases?.[schedule.phases.length - 1];
  const price = last?.items?.[0]?.price;
  const key = price && typeof price === "object" ? (price.lookup_key ?? null) : null;
  const plan = key ? planFromLookupKey(key) : null;
  const interval = key ? intervalFromLookupKey(key) : null;
  if (!plan || !interval || !last?.start_date || (schedule.phases?.length ?? 0) < 2) return null;
  return { plan, interval, at: iso(last.start_date) };
}

/** A card refusal, in words. Null for anything else. */
export function declinedMessage(error: unknown): string | null {
  const e = error as { status?: number; code?: string | null; message?: string } | null;
  if (!e) return null;
  if (e.status === 402 || e.code === "card_declined" || /card was declined|insufficient funds/i.test(e.message ?? "")) {
    return "Your card was declined, so nothing has changed. Update it in Manage billing, then try again.";
  }
  if (e.code === "authentication_required" || /requires.*authentication/i.test(e.message ?? "")) {
    return "Your bank wants to confirm this payment, so nothing has changed. Update your card in Manage billing, then try again.";
  }
  return null;
}
