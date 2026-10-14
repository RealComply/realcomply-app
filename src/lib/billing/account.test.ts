import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  accountStatus,
  billingDetailsFrom,
  cardLabel,
  mayManageBilling,
  portalFlowFrom,
  portalReturnPath,
  portalSessionParams,
  type SubscriptionForAccount,
} from "./account";

// The Account page and the Billing page (brief, 14 Oct 2026): who pays, the
// status shown, what is read from Stripe, and which screen of Stripe's
// billing page opens.

const asHolder = (holder: boolean) =>
  ({ rpc: async () => ({ data: holder, error: null }) }) as unknown as SupabaseClient;

describe("mayManageBilling", () => {
  it("is the licensee in charge, or the agent on their own plan (both act as licensee)", async () => {
    assert.equal(await mayManageBilling(asHolder(false), { actsAsLicensee: true }), true);
  });

  it("is the person who set the office up, though not the licensee", async () => {
    assert.equal(await mayManageBilling(asHolder(true), { actsAsLicensee: false }), true);
  });

  it("is never an agent or assistant in someone else's office", async () => {
    assert.equal(await mayManageBilling(asHolder(false), { actsAsLicensee: false }), false);
  });

  it("reads a failed check as no", async () => {
    const failing = { rpc: async () => ({ data: null, error: { message: "boom" } }) } as unknown as SupabaseClient;
    assert.equal(await mayManageBilling(failing, { actsAsLicensee: false }), false);
  });
});

describe("accountStatus", () => {
  it("names the four states in the brief", () => {
    assert.equal(accountStatus("trialing", false), "Trial");
    assert.equal(accountStatus("active", false), "Active");
    assert.equal(accountStatus("past_due", false), "Payment failed");
    assert.equal(accountStatus("active", true), "Cancelling");
  });

  it("says Cancelling for a trial booked to end too, and leaves a payment failure as it is", () => {
    assert.equal(accountStatus("trialing", true), "Cancelling");
    assert.equal(accountStatus("past_due", true), "Payment failed");
  });

  it("covers a free account and an ended one", () => {
    assert.equal(accountStatus("comped", false), "Free account");
    assert.equal(accountStatus("canceled", false), "Ended");
  });
});

const T = (iso: string) => Math.floor(Date.parse(iso) / 1000);

function sub(over: Partial<SubscriptionForAccount> = {}): SubscriptionForAccount {
  return {
    id: "sub_1",
    customer: { id: "cus_1", invoice_settings: { default_payment_method: null } },
    metadata: { agency_id: "agency-1" },
    cancel_at_period_end: false,
    cancel_at: null,
    trial_end: null,
    default_payment_method: { type: "card", card: { brand: "visa", last4: "4242" } },
    items: {
      data: [
        {
          current_period_end: T("2026-11-14T00:00:00Z"),
          price: { lookup_key: "agent_1_monthly", recurring: { interval: "month" } },
        },
      ],
    },
    ...over,
  };
}

const ours = { customerId: "cus_1", agencyId: "agency-1" };

describe("billingDetailsFrom", () => {
  it("reads the period, the next payment and the card", () => {
    const d = billingDetailsFrom(sub(), ours);
    assert.deepEqual(d, {
      interval: "monthly",
      nextPaymentAt: "2026-11-14T00:00:00.000Z",
      endsAt: null,
      trialEndsAt: null,
      card: { kind: "card", brand: "visa", last4: "4242" },
    });
  });

  it("reads the period end from the subscription itself on older Stripe versions", () => {
    const d = billingDetailsFrom(sub({ current_period_end: T("2027-01-01T00:00:00Z"), items: { data: [{}] } }), ours);
    assert.equal(d?.nextPaymentAt, "2027-01-01T00:00:00.000Z");
    assert.equal(d?.interval, null);
  });

  it("takes the period from the price's interval when there is no lookup key", () => {
    const d = billingDetailsFrom(
      sub({ items: { data: [{ price: { lookup_key: null, recurring: { interval: "year" } } }] } }),
      ours,
    );
    assert.equal(d?.interval, "annual");
  });

  it("gives the end date, and no next payment, once the plan is booked to end", () => {
    const atPeriodEnd = billingDetailsFrom(sub({ cancel_at_period_end: true }), ours);
    assert.equal(atPeriodEnd?.endsAt, "2026-11-14T00:00:00.000Z");
    assert.equal(atPeriodEnd?.nextPaymentAt, null);

    const onADate = billingDetailsFrom(sub({ cancel_at: T("2026-12-01T00:00:00Z") }), ours);
    assert.equal(onADate?.endsAt, "2026-12-01T00:00:00.000Z");
  });

  it("falls back to the customer's default card, and reads a bank account", () => {
    const fromCustomer = billingDetailsFrom(
      sub({
        default_payment_method: null,
        customer: {
          id: "cus_1",
          invoice_settings: { default_payment_method: { type: "card", card: { brand: "mastercard", last4: "4444" } } },
        },
      }),
      ours,
    );
    assert.deepEqual(fromCustomer?.card, { kind: "card", brand: "mastercard", last4: "4444" });

    const bank = billingDetailsFrom(
      sub({ default_payment_method: { type: "au_becs_debit", au_becs_debit: { last4: "6789" } } }),
      ours,
    );
    assert.deepEqual(bank?.card, { kind: "bank", last4: "6789" });
  });

  it("has no card when Stripe gives only an id", () => {
    assert.equal(billingDetailsFrom(sub({ default_payment_method: "pm_1", customer: "cus_1" }), ours)?.card, null);
  });

  it("shows nothing for a subscription that isn't this office's", () => {
    assert.equal(billingDetailsFrom(sub({ customer: "cus_other" }), ours), null);
    assert.equal(billingDetailsFrom(sub({ metadata: { agency_id: "agency-2" } }), ours), null);
    assert.equal(billingDetailsFrom(sub(), { customerId: null, agencyId: "agency-1" }), null);
  });

  it("reads the trial end", () => {
    assert.equal(billingDetailsFrom(sub({ trial_end: T("2026-10-28T03:00:00Z") }), ours)?.trialEndsAt, "2026-10-28T03:00:00.000Z");
  });
});

describe("cardLabel", () => {
  it("reads as the mockup does", () => {
    assert.equal(cardLabel({ kind: "card", brand: "visa", last4: "4242" }), "Visa ending 4242");
    assert.equal(cardLabel({ kind: "card", brand: "amex", last4: "0005" }), "American Express ending 0005");
    assert.equal(cardLabel({ kind: "card", brand: "something_new", last4: "1111" }), "Card ending 1111");
    assert.equal(cardLabel({ kind: "bank", last4: "6789" }), "Bank account ending 6789");
  });
});

describe("Stripe's billing page", () => {
  const base = { customerId: "cus_1", returnUrl: "https://example.test/dashboard/account", subscriptionId: "sub_1" };

  it("opens the whole page for invoices and receipts", () => {
    assert.deepEqual(portalSessionParams({ ...base, flow: "home" }), {
      customer: "cus_1",
      return_url: "https://example.test/dashboard/account",
    });
  });

  it("opens straight onto the card for Update card, and comes back to Account", () => {
    const p = portalSessionParams({ ...base, flow: "update_card" });
    assert.equal(p["flow_data[type]"], "payment_method_update");
    assert.equal(p["flow_data[after_completion][redirect][return_url]"], base.returnUrl);
  });

  it("opens Stripe's own cancel screen for the office's subscription", () => {
    const p = portalSessionParams({ ...base, flow: "cancel" });
    assert.equal(p["flow_data[type]"], "subscription_cancel");
    assert.equal(p["flow_data[subscription_cancel][subscription]"], "sub_1");
  });

  it("opens the whole page when there is no subscription to cancel", () => {
    const p = portalSessionParams({ ...base, flow: "cancel", subscriptionId: null });
    assert.equal(p["flow_data[type]"], undefined);
  });

  it("only knows the three screens and the two pages to come back to", () => {
    assert.equal(portalFlowFrom("cancel"), "cancel");
    assert.equal(portalFlowFrom("update_card"), "update_card");
    assert.equal(portalFlowFrom("subscription_update"), "home");
    assert.equal(portalFlowFrom(null), "home");
    assert.equal(portalReturnPath("account"), "/dashboard/account");
    assert.equal(portalReturnPath("https://evil.test"), "/dashboard/billing");
    assert.equal(portalReturnPath(null), "/dashboard/billing");
  });
});
