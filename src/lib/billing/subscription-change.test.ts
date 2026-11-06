import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyNow,
  bookedChange,
  declinedMessage,
  previewNow,
  scheduleNext,
  subscriptionViewFrom,
  type StripeRequest,
  type SubscriptionView,
} from "./subscription-change";

// A stand-in for Stripe: records each call and answers from a script.
function fakeStripe(answers: Array<unknown | Error>) {
  const calls: Array<{ method: string; path: string; params?: Record<string, string | undefined> }> = [];
  const request = (async (method: string, path: string, params?: Record<string, string | undefined>) => {
    calls.push({ method, path, params });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return next ?? {};
  }) as unknown as StripeRequest;
  return { calls, request };
}

const raw = {
  id: "sub_1",
  status: "active",
  customer: "cus_1",
  livemode: false,
  trial_end: 1793154850,
  cancel_at_period_end: false,
  cancel_at: null,
  schedule: null,
  items: {
    data: [
      {
        id: "si_1",
        current_period_end: 1795833250,
        price: { id: "price_agent_1_m", lookup_key: "agent_1_monthly" },
      },
    ],
  },
};

const view: SubscriptionView = subscriptionViewFrom(raw, new Date("2026-11-06T00:00:00Z"))!;

describe("Stripe's subscription, as a plan change reads it", () => {
  it("takes the plan and interval from the price's lookup key, and the period from the item (API 2026)", () => {
    assert.deepEqual(view, {
      id: "sub_1",
      status: "active",
      customer: "cus_1",
      livemode: false,
      itemId: "si_1",
      priceId: "price_agent_1_m",
      plan: "agent_1",
      interval: "monthly",
      periodEnd: new Date(1795833250 * 1000).toISOString(),
      trialEnd: null,
      endsAt: null,
      scheduleId: null,
    });
  });

  it("knows a trial still running, a booked cancellation and a booked change", () => {
    const v = subscriptionViewFrom(
      { ...raw, status: "trialing", cancel_at_period_end: true, schedule: "sub_sched_1" },
      new Date("2026-10-01T00:00:00Z"),
    )!;
    assert.equal(v.trialEnd, new Date(1793154850 * 1000).toISOString());
    assert.equal(v.endsAt, new Date(1795833250 * 1000).toISOString());
    assert.equal(v.scheduleId, "sub_sched_1");
  });

  it("won't take a subscription it doesn't understand", () => {
    assert.equal(subscriptionViewFrom({ ...raw, items: { data: [] } }), null);
    assert.equal(
      subscriptionViewFrom({
        ...raw,
        items: { data: [{ id: "si_1", current_period_end: 1, price: { id: "p", lookup_key: "made_up" } }] },
      }),
      null,
    );
  });
});

describe("the calls to Stripe", () => {
  it("previews today's amount for the same moment it will charge", async () => {
    const stripe = fakeStripe([{ amount_due: 5918 }]);
    assert.equal(await previewNow(view, "price_office_1_m", 1793900000, stripe.request), 5918);
    assert.deepEqual(stripe.calls[0], {
      method: "POST",
      path: "/invoices/create_preview",
      params: {
        customer: "cus_1",
        subscription: "sub_1",
        "subscription_details[items][0][id]": "si_1",
        "subscription_details[items][0][price]": "price_office_1_m",
        "subscription_details[proration_behavior]": "always_invoice",
        "subscription_details[proration_date]": "1793900000",
      },
    });
  });

  it("an upgrade charges the difference now, and changes nothing if the card can't pay", async () => {
    const stripe = fakeStripe([{ latest_invoice: { id: "in_1", amount_paid: 5918 } }]);
    const applied = await applyNow(
      view,
      "price_office_1_m",
      { prorate: true, prorationDate: 1793900000, agencyId: "a1" },
      stripe.request,
    );
    assert.deepEqual(applied, { invoiceId: "in_1", amountPaidCents: 5918 });
    assert.equal(stripe.calls[0].path, "/subscriptions/sub_1");
    assert.equal(stripe.calls[0].params?.proration_behavior, "always_invoice");
    assert.equal(stripe.calls[0].params?.payment_behavior, "error_if_incomplete");
    assert.equal(stripe.calls[0].params?.proration_date, "1793900000");
    assert.equal(stripe.calls[0].params?.["items[0][price]"], "price_office_1_m");
  });

  it("during the trial the price simply changes, with nothing charged", async () => {
    const stripe = fakeStripe([{ latest_invoice: "in_old" }]);
    const applied = await applyNow(
      view,
      "price_office_1_m",
      { prorate: false, prorationDate: 0, agencyId: "a1" },
      stripe.request,
    );
    assert.deepEqual(applied, { invoiceId: null, amountPaidCents: 0 });
    assert.equal(stripe.calls[0].params?.proration_behavior, "none");
    assert.equal(stripe.calls[0].params?.payment_behavior, undefined);
  });

  it("a change from the next billing date is a schedule: the current phase as it is, then the new price, then released", async () => {
    const stripe = fakeStripe([{ id: "sub_sched_1", phases: [{ start_date: 1793154850, end_date: 1795833250 }] }, {}]);
    const id = await scheduleNext(view, "price_agent_1_m", "price_agent_1_y", "annual", stripe.request);
    assert.equal(id, "sub_sched_1");
    assert.deepEqual(stripe.calls[0], {
      method: "POST",
      path: "/subscription_schedules",
      params: { from_subscription: "sub_1" },
    });
    assert.deepEqual(stripe.calls[1].params, {
      end_behavior: "release",
      "phases[0][start_date]": "1793154850",
      "phases[0][end_date]": "1795833250",
      "phases[0][items][0][price]": "price_agent_1_m",
      "phases[0][items][0][quantity]": "1",
      "phases[1][items][0][price]": "price_agent_1_y",
      "phases[1][items][0][quantity]": "1",
      "phases[1][duration][interval]": "year",
      "phases[1][duration][interval_count]": "1",
      "phases[1][proration_behavior]": "none",
      "metadata[realcomply]": "plan_change",
    });
  });

  it("an earlier booked change is taken off first, and a half-made schedule never stays", async () => {
    const stripe = fakeStripe([
      {},
      { id: "sub_sched_2", phases: [{ start_date: 1, end_date: 2 }] },
      new Error("Stripe said no"),
      {},
    ]);
    await assert.rejects(
      scheduleNext({ ...view, scheduleId: "sub_sched_old" }, "p1", "p2", "monthly", stripe.request),
      /Stripe said no/,
    );
    assert.deepEqual(
      stripe.calls.map((c) => c.path),
      [
        "/subscription_schedules/sub_sched_old/release",
        "/subscription_schedules",
        "/subscription_schedules/sub_sched_2",
        "/subscription_schedules/sub_sched_2/release",
      ],
    );
  });

  it("reads a booked change back as a plan and a date", async () => {
    const stripe = fakeStripe([
      {
        phases: [
          { start_date: 1, items: [{ price: { lookup_key: "office_3_monthly" } }] },
          { start_date: 1795833250, items: [{ price: { lookup_key: "office_2_annual" } }] },
        ],
      },
    ]);
    assert.deepEqual(await bookedChange("sub_sched_1", stripe.request), {
      plan: "office_2",
      interval: "annual",
      at: new Date(1795833250 * 1000).toISOString(),
    });
  });

  it("says plainly when the card is declined", () => {
    assert.match(
      declinedMessage({ status: 402, code: "card_declined", message: "x" }) ?? "",
      /Your card was declined, so nothing has changed/,
    );
    assert.equal(declinedMessage(new Error("network")), null);
  });
});
