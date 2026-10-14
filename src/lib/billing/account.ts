import type { SupabaseClient } from "@supabase/supabase-js";
import type { Access } from "@/lib/access";
import { isAccountHolder } from "@/lib/subscription-end/access";
import type { BillingStatus } from "./entitlement";
import { intervalFromLookupKey, stripeRequest, type Interval } from "./stripe";

// Who pays, and what Stripe holds for them (brief, 14 Oct 2026; mockup
// approved by Adam). One source for the sidebar Billing page and the Account
// page in the profile menu: the same rule decides who gets either, and the
// same action opens Stripe's billing page from both.
//
// Card, invoices and cancelling all happen on Stripe's own page, as they did
// from Billing. Cancelling there is what starts the subscription-end process
// (the webhook: a trial ends now, a paid plan at the end of its period, then
// 14 days on the records page). Nothing here cancels anything itself.

/**
 * Whoever pays: the licensee in charge, the agent on their own plan (who acts
 * as the licensee for their own account), or the person who set the office
 * up. The Billing page, the Account page and opening Stripe's billing page
 * all ask this.
 */
export async function mayManageBilling(supabase: SupabaseClient, access: Pick<Access, "actsAsLicensee">): Promise<boolean> {
  return access.actsAsLicensee || (await isAccountHolder(supabase));
}

export type AccountStatus = "Trial" | "Active" | "Payment failed" | "Cancelling" | "Free account" | "Ended";

/**
 * The status shown on the Account page. The office's record says trial,
 * active, behind on payment, free or ended; only Stripe knows a plan has been
 * booked to end, which is "Cancelling".
 */
export function accountStatus(status: BillingStatus, cancelling: boolean): AccountStatus {
  switch (status) {
    case "trialing":
      return cancelling ? "Cancelling" : "Trial";
    case "active":
      return cancelling ? "Cancelling" : "Active";
    case "past_due":
      return "Payment failed";
    case "comped":
      return "Free account";
    case "canceled":
      return "Ended";
  }
}

export type Card = { kind: "card"; brand: string; last4: string } | { kind: "bank"; last4: string };

export type StripeBillingDetails = {
  interval: Interval | null;
  /** When the next payment is taken: the end of the period now running. */
  nextPaymentAt: string | null;
  /** When the plan ends, once it has been booked to end. Null otherwise. */
  endsAt: string | null;
  trialEndsAt: string | null;
  card: Card | null;
};

/** The parts of a Stripe subscription read here, with the payment method expanded. */
export type SubscriptionForAccount = {
  id: string;
  customer: string | { id: string; invoice_settings?: { default_payment_method?: PaymentMethod | string | null } | null };
  metadata?: Record<string, string> | null;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  trial_end?: number | null;
  current_period_end?: number | null;
  default_payment_method?: PaymentMethod | string | null;
  items?: {
    data?: Array<{
      current_period_end?: number | null;
      price?: { lookup_key?: string | null; recurring?: { interval?: string | null } | null } | null;
    }>;
  };
};

type PaymentMethod = {
  type?: string;
  card?: { brand?: string | null; last4?: string | null } | null;
  au_becs_debit?: { last4?: string | null } | null;
};

const iso = (seconds: number | null | undefined): string | null =>
  typeof seconds === "number" && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;

function cardFrom(pm: PaymentMethod | string | null | undefined): Card | null {
  if (!pm || typeof pm === "string") return null;
  if (pm.card?.last4) return { kind: "card", brand: pm.card.brand ?? "card", last4: pm.card.last4 };
  if (pm.au_becs_debit?.last4) return { kind: "bank", last4: pm.au_becs_debit.last4 };
  return null;
}

/**
 * What the Account page shows from Stripe's copy of the subscription. Null
 * when the subscription isn't this office's: its customer is not the one on
 * the office's record, or it names another office.
 */
export function billingDetailsFrom(
  sub: SubscriptionForAccount,
  expected: { customerId: string | null; agencyId: string },
): StripeBillingDetails | null {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!expected.customerId || customerId !== expected.customerId) return null;
  if (sub.metadata?.agency_id && sub.metadata.agency_id !== expected.agencyId) return null;

  const item = sub.items?.data?.[0];
  const lookupKey = item?.price?.lookup_key ?? null;
  const recurring = item?.price?.recurring?.interval ?? null;
  const interval: Interval | null =
    (lookupKey ? intervalFromLookupKey(lookupKey) : null) ??
    (recurring === "month" ? "monthly" : recurring === "year" ? "annual" : null);

  // On newer Stripe API versions the period lives on the subscription's
  // item rather than the subscription; either is read.
  const periodEnd = iso(sub.current_period_end ?? item?.current_period_end ?? null);
  const endsAt = iso(sub.cancel_at ?? null) ?? (sub.cancel_at_period_end ? periodEnd : null);

  const customerDefault =
    typeof sub.customer === "string" ? null : (sub.customer?.invoice_settings?.default_payment_method ?? null);

  return {
    interval,
    nextPaymentAt: endsAt ? null : periodEnd,
    endsAt,
    trialEndsAt: iso(sub.trial_end ?? null),
    // The subscription's own card first, then the customer's default: Stripe
    // charges the first of these it finds.
    card: cardFrom(sub.default_payment_method) ?? cardFrom(customerDefault),
  };
}

/**
 * Stripe's copy of the office's subscription, for the Account page. Null when
 * there isn't one, it isn't this office's, or Stripe can't be reached: the
 * page then shows what the office's record says and nothing from Stripe.
 * Never throws.
 */
export async function stripeBillingDetails(
  subscriptionId: string | null | undefined,
  expected: { customerId: string | null; agencyId: string },
): Promise<StripeBillingDetails | null> {
  if (!subscriptionId) return null;
  try {
    const sub = await stripeRequest<SubscriptionForAccount>(
      "GET",
      `/subscriptions/${encodeURIComponent(subscriptionId)}?expand%5B%5D=default_payment_method&expand%5B%5D=customer.invoice_settings.default_payment_method`,
    );
    return billingDetailsFrom(sub, expected);
  } catch (e) {
    console.error("stripeBillingDetails failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** "Visa ending 4242", "Bank account ending 6789". */
export function cardLabel(card: Card): string {
  if (card.kind === "bank") return `Bank account ending ${card.last4}`;
  return `${brandName(card.brand)} ending ${card.last4}`;
}

function brandName(brand: string): string {
  const names: Record<string, string> = {
    visa: "Visa",
    mastercard: "Mastercard",
    amex: "American Express",
    diners: "Diners Club",
    discover: "Discover",
    jcb: "JCB",
    unionpay: "UnionPay",
    eftpos_au: "eftpos",
  };
  return names[brand] ?? "Card";
}

// ── Stripe's billing page ─────────────────────────────────────────────────

/**
 * Which part of Stripe's billing page to open. "home" is the whole page
 * (invoices and receipts, and everything else); "update_card" and "cancel"
 * open straight onto those screens.
 */
export type PortalFlow = "home" | "update_card" | "cancel";

export function portalFlowFrom(value: unknown): PortalFlow {
  return value === "update_card" || value === "cancel" ? value : "home";
}

/** Where Stripe sends them back to: the page they came from. */
export function portalReturnPath(value: unknown): "/dashboard/account" | "/dashboard/billing" {
  return value === "account" ? "/dashboard/account" : "/dashboard/billing";
}

/**
 * The fields for Stripe's billing portal session. Cancelling needs the
 * subscription, and without one opens the whole page instead, where there is
 * nothing to cancel.
 */
export function portalSessionParams(opts: {
  customerId: string;
  returnUrl: string;
  flow: PortalFlow;
  subscriptionId: string | null;
}): Record<string, string> {
  const params: Record<string, string> = { customer: opts.customerId, return_url: opts.returnUrl };
  const back = {
    "flow_data[after_completion][type]": "redirect",
    "flow_data[after_completion][redirect][return_url]": opts.returnUrl,
  };
  if (opts.flow === "update_card") {
    return { ...params, "flow_data[type]": "payment_method_update", ...back };
  }
  if (opts.flow === "cancel" && opts.subscriptionId) {
    return {
      ...params,
      "flow_data[type]": "subscription_cancel",
      "flow_data[subscription_cancel][subscription]": opts.subscriptionId,
      ...back,
    };
  }
  return params;
}
