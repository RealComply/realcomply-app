import { StripeApiError, intervalFromLookupKey, planFromLookupKey } from "./stripe";
import type { TrialEmailResult, TrialEndingInput } from "@/lib/email/trial-ending";

// What to do with customer.subscription.trial_will_end — Terms v.4 cl 2.10(b):
// a reminder three days before the trial expires, naming the date the first
// payment will be taken and the amount of it.
//
// The decision lives here, apart from the webhook route, with Stripe, Supabase
// and the mailer passed in. The route wires in the real ones; the tests pass
// stand-ins, which is the only way to exercise "Stripe refused the preview"
// without a Stripe account in that state.
//
// WHEN THIS THROWS, AND WHEN IT MUST NOT. A throw becomes a 500, and a 500
// makes Stripe retry for days. That is right only when nothing has been sent
// and a retry could succeed — the mail provider being down, say. It is wrong
// for anything Stripe will answer the same way every time: before this
// existed, a subscription with no default card made the invoice preview fail,
// the handler threw, and Stripe retried for three days while the subscriber
// got nothing. So a failed preview never throws. The reminder goes without the
// amount instead.

export type TrialSubscription = {
  id: string;
  status: string;
  customer: string;
  trial_end: number | null;
  cancel_at_period_end?: boolean;
  /** Epoch seconds. Set when the subscriber picked a cancellation date. */
  cancel_at?: number | null;
  metadata?: Record<string, string> | null;
  items?: { data?: Array<{ price?: { lookup_key?: string | null } | null }> } | null;
};

export type TrialReminderDeps = {
  /** Stripe's preview of the first invoice. Throws when Stripe refuses it. */
  previewFirstInvoice: (subscriptionId: string) => Promise<{ amount_due: number; currency: string }>;
  agencyIdForCustomer: (customerId: string | null) => Promise<string | null>;
  sendTrialEndingEmail: (input: TrialEndingInput) => Promise<TrialEmailResult>;
  now?: () => number;
};

export type TrialReminderOutcome =
  | "sent"
  | "sent_without_amount"
  | "skipped_cancelling"
  | "skipped_not_trialing"
  | "skipped_unpriceable"
  | "skipped_no_agency"
  | "skipped_by_agency";

/**
 * Will this subscription end at (or before) the end of its trial, so that no
 * first payment is ever taken? Then a reminder about that payment would be
 * false, and nothing is sent.
 *
 * cancel_at counts only when it falls on or before trial_end. A cancellation
 * date after the trial means the first payment still happens, and the terms
 * still promise the reminder.
 */
export function willCancelAtTrialEnd(subscription: TrialSubscription): boolean {
  if (subscription.cancel_at_period_end) return true;
  const { cancel_at, trial_end } = subscription;
  return cancel_at != null && trial_end != null && cancel_at <= trial_end;
}

export async function handleTrialWillEnd(
  subscription: TrialSubscription,
  deps: TrialReminderDeps,
): Promise<TrialReminderOutcome> {
  const now = deps.now?.() ?? Date.now();

  if (willCancelAtTrialEnd(subscription)) {
    console.log(
      `Stripe webhook: trial_will_end for ${subscription.id} — set to cancel at trial end, nothing will be charged, no reminder sent.`,
    );
    return "skipped_cancelling";
  }

  const lookupKey = subscription.items?.data?.[0]?.price?.lookup_key ?? null;
  const plan = lookupKey ? planFromLookupKey(lookupKey) : null;
  const interval = lookupKey ? intervalFromLookupKey(lookupKey) : null;

  if (!plan || !interval || !subscription.trial_end) {
    console.error(
      "Stripe webhook: trial_will_end for",
      subscription.id,
      "has no recognisable plan or trial end (lookup key",
      lookupKey,
      ", trial_end",
      subscription.trial_end,
      ") — no reminder sent.",
    );
    return "skipped_unpriceable";
  }

  // Stripe also fires this event when a trial is ended early. That
  // subscription is already paying, so "your trial ends in three days" is false.
  if (subscription.status !== "trialing" || subscription.trial_end * 1000 <= now) {
    console.log("Stripe webhook: trial_will_end for", subscription.id, "— trial already over, no reminder.");
    return "skipped_not_trialing";
  }

  // The amount as Stripe will actually raise it, not the list price: checkout
  // allows promotion codes, so PLANS can be the wrong figure.
  let amountCents: number | null = null;
  try {
    const preview = await deps.previewFirstInvoice(subscription.id);
    if (preview.currency !== "aud" || preview.amount_due <= 0) {
      console.error(
        "Stripe webhook: trial_will_end for",
        subscription.id,
        "previews",
        preview.amount_due,
        preview.currency,
        "— no reminder sent.",
      );
      return "skipped_unpriceable";
    }
    amountCents = preview.amount_due;
  } catch (e) {
    const code = e instanceof StripeApiError ? (e.code ?? `http_${e.status}`) : "no_stripe_code";
    console.error(
      `Stripe webhook: trial_will_end for ${subscription.id} — invoice preview failed (Stripe code ${code}), sending the reminder without the amount.`,
    );
  }

  const agencyId = subscription.metadata?.agency_id ?? (await deps.agencyIdForCustomer(subscription.customer));
  if (!agencyId) {
    console.error("Stripe webhook: trial_will_end — no agency matches", subscription.id);
    return "skipped_no_agency";
  }

  const result = await deps.sendTrialEndingEmail({
    agencyId,
    plan,
    interval,
    amountCents,
    trialEnd: new Date(subscription.trial_end * 1000),
  });

  // Nothing went out, so a retry cannot duplicate it — throw for the 500.
  if (result === "send_failed") {
    throw new Error(`trial reminder for agency ${agencyId} was not sent (mail provider failed)`);
  }
  if (result === "skipped") return "skipped_by_agency";
  return amountCents === null ? "sent_without_amount" : "sent";
}
