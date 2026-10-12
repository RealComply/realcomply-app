import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { POST } from "./route";

// Code review fixes, part A (12 Oct 2026): every Stripe message is checked
// against Stripe as it stands now, and only a message about the office's
// current subscription counts.
//
// A signed message goes in; fetch stands in for Stripe and for the agencies
// table, so what is asserted is what the office's row ends up as. The office
// and its subscriptions are made up for these tests. Never Cass Property.

const SECRET = "whsec_test";
const AGENCY = "agency-throwaway";
const CUSTOMER = "cus_throwaway";

const env: Record<string, string> = {
  STRIPE_WEBHOOK_SECRET: SECRET,
  STRIPE_SECRET_KEY: "sk_test_x",
  NEXT_PUBLIC_SUPABASE_URL: "https://db.test",
  SUPABASE_SERVICE_ROLE_KEY: "service_key",
  EMAIL_PROVIDER: "resend",
  EMAIL_FROM: "RealComply <noreply@realcomply.com.au>",
  RESEND_API_KEY: "re_test",
};

type Subscription = {
  id: string;
  status: string;
  customer: string;
  created: number;
  trial_end: number | null;
  cancel_at_period_end: boolean;
  cancel_at: number | null;
  metadata: Record<string, string>;
  items: { data: Array<{ price: { lookup_key: string } }> };
};

type AgencyRow = {
  id: string;
  name: string;
  status: string | null;
  plan: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  trial_ends_at: string | null;
  ended_at: string | null;
};

const DAY = 86_400;
const NOW = Math.floor(Date.now() / 1000);

function subscription(id: string, status: string, createdDaysAgo: number): Subscription {
  return {
    id,
    status,
    customer: CUSTOMER,
    created: NOW - createdDaysAgo * DAY,
    trial_end: null,
    cancel_at_period_end: false,
    cancel_at: null,
    metadata: { agency_id: AGENCY },
    items: { data: [{ price: { lookup_key: "office_1_monthly" } }] },
  };
}

// Stripe, as it stands now.
let stripe: Map<string, Subscription>;
// The office's row in agencies.
let agency: AgencyRow;
// Every write that set the office's billing (status and subscription).
let billingWrites: Array<Record<string, unknown>>;
let stripeReads: string[];
// Runs once, straight after the handler reads the office's row.
let afterAgencyRead: (() => void) | null;
// Runs on each read of a subscription from Stripe, with the read's number.
let onStripeRead: ((id: string, n: number) => void) | null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** PostgREST's filters as the client sends them: id=eq.x, status=neq.comped, x=is.null. */
function matches(row: Record<string, unknown>, params: URLSearchParams): boolean {
  for (const [column, filter] of params) {
    if (column === "select") continue;
    const value = row[column];
    if (filter === "is.null") {
      if (value !== null) return false;
    } else if (filter.startsWith("eq.")) {
      if (value !== filter.slice(3)) return false;
    } else if (filter.startsWith("neq.")) {
      // SQL: null <> 'x' is not true, so a null row is not matched.
      if (value === null || value === filter.slice(4)) return false;
    } else {
      throw new Error(`filter not understood by the test: ${column}=${filter}`);
    }
  }
  return true;
}

/** agencies_track_end (0054), for an agency that is not protected. */
function trackEnd(row: AgencyRow, before: string | null) {
  if (row.status === "canceled" && before !== "canceled") {
    row.ended_at ??= new Date().toISOString();
  } else if (row.status === "trialing" || row.status === "active" || row.status === "comped") {
    row.ended_at = null;
  }
}

function stub() {
  mock.method(globalThis, "fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";

    if (url.host === "api.stripe.com") {
      const m = url.pathname.match(/^\/v1\/subscriptions\/([^/]+)$/);
      if (m && method === "GET") {
        const id = decodeURIComponent(m[1]);
        stripeReads.push(id);
        onStripeRead?.(id, stripeReads.filter((r) => r === id).length);
        const sub = stripe.get(id);
        return sub
          ? json(structuredClone(sub))
          : json({ error: { type: "invalid_request_error", code: "resource_missing", message: `No such subscription: '${id}'` } }, 404);
      }
      throw new Error(`unexpected Stripe call in test: ${method} ${url.pathname}`);
    }

    if (url.host === "db.test" && url.pathname === "/rest/v1/agencies") {
      const rows = [agency].filter((r) => matches(r as unknown as Record<string, unknown>, url.searchParams));
      if (method === "GET") {
        const out = rows.map((r) => ({ ...r }));
        const after = afterAgencyRead;
        afterAgencyRead = null;
        after?.();
        return json(out);
      }
      if (method === "PATCH") {
        const patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
        for (const row of rows) {
          const before = row.status;
          Object.assign(row, patch);
          trackEnd(row, before);
        }
        if (rows.length > 0 && ("status" in patch || "stripe_subscription_id" in patch)) billingWrites.push(patch);
        return json(rows.map((r) => ({ id: r.id })));
      }
    }

    // On the way through, the day 0 email and the early access welcome look
    // for people and send mail. Nobody is there to send to.
    if (url.host === "db.test") return json([]);
    if (url.host === "api.resend.com") return json({ id: "email_1" });

    throw new Error(`unexpected fetch in test: ${method} ${url}`);
  });
}

function signed(type: string, object: Record<string, unknown>): Request {
  const body = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
  return new Request("https://www.realcomply.com.au/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": `t=${t},v1=${v1}` },
    body,
  });
}

/** A subscription message carrying the copy of the subscription it was sent with. */
const subscriptionMessage = (type: string, copy: Subscription) => POST(signed(type, copy as unknown as Record<string, unknown>));

/** A completed checkout for the given subscription. */
const checkoutMessage = (subscriptionId: string) =>
  POST(
    signed("checkout.session.completed", {
      client_reference_id: AGENCY,
      customer: CUSTOMER,
      subscription: subscriptionId,
    }),
  );

const ENDED_AT = "2026-10-01T05:00:00.000Z";

beforeEach(() => {
  stripe = new Map();
  billingWrites = [];
  stripeReads = [];
  afterAgencyRead = null;
  onStripeRead = null;
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  mock.method(console, "log", () => {});
  mock.method(console, "info", () => {});
  mock.method(console, "error", () => {});
  stub();
});

afterEach(() => mock.restoreAll());

describe("Stripe webhook: Stripe is asked, the message is not believed", () => {
  it("an old 'active' message replayed after the cancellation: the office stays ended", async () => {
    stripe.set("sub_throwaway", subscription("sub_throwaway", "canceled", 40));
    agency = {
      id: AGENCY,
      name: "Throwaway Test Realty",
      status: "canceled",
      plan: "office_1",
      stripe_customer_id: CUSTOMER,
      stripe_subscription_id: "sub_throwaway",
      trial_ends_at: null,
      ended_at: ENDED_AT,
    };

    // What Stripe sent before the cancellation, arriving again afterwards:
    // "updated", active and booked to cancel, then the checkout that started it.
    const old = { ...subscription("sub_throwaway", "active", 40), cancel_at_period_end: true };
    const r1 = await subscriptionMessage("customer.subscription.updated", old);
    const r2 = await subscriptionMessage("customer.subscription.created", subscription("sub_throwaway", "active", 40));
    const r3 = await checkoutMessage("sub_throwaway");

    for (const r of [r1, r2, r3]) assert.equal(r.status, 200);
    assert.equal(agency.status, "canceled");
    assert.equal(agency.ended_at, ENDED_AT, "the 14 days still run from the real end");
    assert.equal(agency.stripe_subscription_id, "sub_throwaway");
    assert.ok(
      billingWrites.every((w) => w.status === "canceled"),
      `nothing but "canceled" was written: ${JSON.stringify(billingWrites)}`,
    );
    assert.ok(stripeReads.includes("sub_throwaway"), "Stripe was asked");
  });

  it("a message about an old subscription changes nothing", async () => {
    stripe.set("sub_throwaway_old", subscription("sub_throwaway_old", "canceled", 60));
    stripe.set("sub_throwaway_new", subscription("sub_throwaway_new", "active", 5));
    agency = {
      id: AGENCY,
      name: "Throwaway Test Realty",
      status: "active",
      plan: "office_1",
      stripe_customer_id: CUSTOMER,
      stripe_subscription_id: "sub_throwaway_new",
      trial_ends_at: null,
      ended_at: null,
    };
    const before = { ...agency };

    // Every kind of message about the old one, whatever its copy says.
    const responses = [
      await subscriptionMessage("customer.subscription.updated", subscription("sub_throwaway_old", "active", 60)),
      await subscriptionMessage("customer.subscription.updated", subscription("sub_throwaway_old", "past_due", 60)),
      await subscriptionMessage("customer.subscription.deleted", subscription("sub_throwaway_old", "canceled", 60)),
      await checkoutMessage("sub_throwaway_old"),
    ];

    for (const r of responses) assert.equal(r.status, 200);
    assert.deepEqual(agency, before);
    assert.deepEqual(billingWrites, []);
  });

  it("an older subscription Stripe still runs never replaces the newer one, even by a replayed checkout", async () => {
    stripe.set("sub_throwaway_old", subscription("sub_throwaway_old", "active", 60));
    stripe.set("sub_throwaway_new", subscription("sub_throwaway_new", "active", 5));
    agency = {
      id: AGENCY,
      name: "Throwaway Test Realty",
      status: "active",
      plan: "office_1",
      stripe_customer_id: CUSTOMER,
      stripe_subscription_id: "sub_throwaway_new",
      trial_ends_at: null,
      ended_at: null,
    };

    assert.equal((await checkoutMessage("sub_throwaway_old")).status, 200);
    assert.equal((await subscriptionMessage("customer.subscription.updated", subscription("sub_throwaway_old", "active", 60))).status, 200);

    assert.equal(agency.stripe_subscription_id, "sub_throwaway_new");
    assert.deepEqual(billingWrites, []);
  });

  it("the later cancellation is honoured, and a replay of the earlier 'active' after it changes nothing", async () => {
    stripe.set("sub_throwaway", subscription("sub_throwaway", "active", 20));
    agency = {
      id: AGENCY,
      name: "Throwaway Test Realty",
      status: "active",
      plan: "office_1",
      stripe_customer_id: CUSTOMER,
      stripe_subscription_id: "sub_throwaway",
      trial_ends_at: null,
      ended_at: null,
    };
    const earlier = subscription("sub_throwaway", "active", 20);
    assert.equal((await subscriptionMessage("customer.subscription.updated", earlier)).status, 200);
    assert.equal(agency.status, "active");

    // The subscriber cancels and the period runs out.
    stripe.set("sub_throwaway", subscription("sub_throwaway", "canceled", 20));
    assert.equal((await subscriptionMessage("customer.subscription.deleted", subscription("sub_throwaway", "canceled", 20))).status, 200);

    assert.equal(agency.status, "canceled");
    assert.ok(agency.ended_at, "the 14 days have started");
    const endedAt = agency.ended_at;

    // The earlier message again, late.
    assert.equal((await subscriptionMessage("customer.subscription.updated", earlier)).status, 200);
    assert.equal(agency.status, "canceled");
    assert.equal(agency.ended_at, endedAt);
  });

  it("a cancellation message that arrives before the update it follows: Stripe's answer wins both times", async () => {
    // Stripe already has it cancelled; the "deleted" lands, then the
    // "updated (active, cancelling)" that was sent before it.
    stripe.set("sub_throwaway", subscription("sub_throwaway", "canceled", 20));
    agency = {
      id: AGENCY,
      name: "Throwaway Test Realty",
      status: "active",
      plan: "office_1",
      stripe_customer_id: CUSTOMER,
      stripe_subscription_id: "sub_throwaway",
      trial_ends_at: null,
      ended_at: null,
    };

    await subscriptionMessage("customer.subscription.deleted", subscription("sub_throwaway", "canceled", 20));
    await subscriptionMessage("customer.subscription.updated", {
      ...subscription("sub_throwaway", "active", 20),
      cancel_at_period_end: true,
    });

    assert.equal(agency.status, "canceled");
    assert.ok(agency.ended_at);
  });

  it("reactivating through checkout still works: the newer subscription takes over", async () => {
    stripe.set("sub_throwaway_old", subscription("sub_throwaway_old", "canceled", 40));
    stripe.set("sub_throwaway_new", subscription("sub_throwaway_new", "active", 0));
    agency = {
      id: AGENCY,
      name: "Throwaway Test Realty",
      status: "canceled",
      plan: "office_1",
      stripe_customer_id: CUSTOMER,
      stripe_subscription_id: "sub_throwaway_old",
      trial_ends_at: null,
      ended_at: ENDED_AT,
    };

    // Stripe's "created" can arrive before the checkout. It waits for it.
    await subscriptionMessage("customer.subscription.created", subscription("sub_throwaway_new", "active", 0));
    assert.equal(agency.stripe_subscription_id, "sub_throwaway_old");

    assert.equal((await checkoutMessage("sub_throwaway_new")).status, 200);
    assert.equal(agency.stripe_subscription_id, "sub_throwaway_new");
    assert.equal(agency.status, "active");
    assert.equal(agency.ended_at, null);

    // And the old one's late messages now change nothing.
    await subscriptionMessage("customer.subscription.deleted", subscription("sub_throwaway_old", "canceled", 40));
    assert.equal(agency.stripe_subscription_id, "sub_throwaway_new");
    assert.equal(agency.status, "active");
  });

  it("a new office's first checkout sets its subscription", async () => {
    stripe.set("sub_throwaway", { ...subscription("sub_throwaway", "trialing", 0), trial_end: NOW + 14 * DAY });
    agency = {
      id: AGENCY,
      name: "Throwaway Test Realty",
      status: "trialing",
      plan: "office_1",
      stripe_customer_id: CUSTOMER,
      stripe_subscription_id: null,
      trial_ends_at: null,
      ended_at: null,
    };

    assert.equal((await checkoutMessage("sub_throwaway")).status, 200);
    assert.equal(agency.stripe_subscription_id, "sub_throwaway");
    assert.equal(agency.status, "trialing");
    assert.equal(agency.trial_ends_at, new Date((NOW + 14 * DAY) * 1000).toISOString());
  });

  it("a replayed checkout for a subscription that has ended does not give an office without one that subscription", async () => {
    stripe.set("sub_throwaway", subscription("sub_throwaway", "canceled", 40));
    agency = {
      id: AGENCY,
      name: "Throwaway Test Realty",
      status: "trialing",
      plan: "office_1",
      stripe_customer_id: CUSTOMER,
      stripe_subscription_id: null,
      trial_ends_at: null,
      ended_at: null,
    };
    const before = { ...agency };

    assert.equal((await checkoutMessage("sub_throwaway")).status, 200);
    assert.deepEqual(agency, before);
  });

  it("a free (comped) office is left alone by its old subscription's messages", async () => {
    // Switched to free by hand: the Stripe ids were cleared, and the old
    // subscription was not cancelled in Stripe.
    stripe.set("sub_throwaway", subscription("sub_throwaway", "past_due", 40));
    agency = {
      id: AGENCY,
      name: "Throwaway Test Realty",
      status: "comped",
      plan: "office_1",
      stripe_customer_id: null,
      stripe_subscription_id: null,
      trial_ends_at: null,
      ended_at: null,
    };
    const before = { ...agency };

    await subscriptionMessage("customer.subscription.updated", subscription("sub_throwaway", "past_due", 40));
    await subscriptionMessage("customer.subscription.deleted", subscription("sub_throwaway", "canceled", 40));
    await checkoutMessage("sub_throwaway");

    assert.deepEqual(agency, before);
    assert.deepEqual(billingWrites, []);
  });

  it("Stripe has no such subscription: 200, and nothing is written", async () => {
    agency = {
      id: AGENCY,
      name: "Throwaway Test Realty",
      status: "active",
      plan: "office_1",
      stripe_customer_id: CUSTOMER,
      stripe_subscription_id: "sub_throwaway",
      trial_ends_at: null,
      ended_at: null,
    };

    const r = await subscriptionMessage("customer.subscription.deleted", subscription("sub_throwaway_unknown", "canceled", 1));

    assert.equal(r.status, 200);
    assert.deepEqual(billingWrites, []);
  });

  it("the office's subscription changes while the message is handled: nothing is written, and Stripe sends it again (500)", async () => {
    stripe.set("sub_throwaway", subscription("sub_throwaway", "canceled", 20));
    agency = {
      id: AGENCY,
      name: "Throwaway Test Realty",
      status: "active",
      plan: "office_1",
      stripe_customer_id: CUSTOMER,
      stripe_subscription_id: "sub_throwaway",
      trial_ends_at: null,
      ended_at: null,
    };
    // A person switches the office to free between the read and the write.
    afterAgencyRead = () => Object.assign(agency, { status: "comped", stripe_subscription_id: null, stripe_customer_id: null });

    const r = await subscriptionMessage("customer.subscription.deleted", subscription("sub_throwaway", "canceled", 20));

    assert.equal(r.status, 500);
    assert.equal(agency.status, "comped");
    assert.deepEqual(billingWrites, []);
  });

  it("Stripe moves on while the message is being recorded: what Stripe says last is what stays", async () => {
    stripe.set("sub_throwaway", subscription("sub_throwaway", "active", 20));
    agency = {
      id: AGENCY,
      name: "Throwaway Test Realty",
      status: "active",
      plan: "office_1",
      stripe_customer_id: CUSTOMER,
      stripe_subscription_id: "sub_throwaway",
      trial_ends_at: null,
      ended_at: null,
    };
    // The subscription ends just after Stripe is first asked.
    onStripeRead = (id, n) => {
      if (n === 1) stripe.set(id, subscription(id, "canceled", 20));
    };

    const r = await subscriptionMessage("customer.subscription.updated", subscription("sub_throwaway", "active", 20));

    assert.equal(r.status, 200);
    assert.equal(agency.status, "canceled");
    assert.ok(agency.ended_at);
  });
});
