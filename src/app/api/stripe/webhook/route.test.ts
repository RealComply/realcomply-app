import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { POST } from "./route";

// The trial_will_end case end to end: a signed webhook in, a status code out.
// fetch stands in for Stripe, Supabase and Resend, so the status codes Stripe
// would see are the ones asserted.

const SECRET = "whsec_test";

const env: Record<string, string> = {
  STRIPE_WEBHOOK_SECRET: SECRET,
  STRIPE_SECRET_KEY: "sk_test_x",
  NEXT_PUBLIC_SUPABASE_URL: "https://db.test",
  SUPABASE_SERVICE_ROLE_KEY: "service_key",
  EMAIL_PROVIDER: "resend",
  EMAIL_FROM: "RealComply <noreply@realcomply.com.au>",
  RESEND_API_KEY: "re_test",
};

type Behaviour = {
  preview: "ok" | "no_upcoming_invoice";
  resend: "ok" | "down";
};

let calls: string[];
let emails: Array<{ subject: string; text: string }>;

function stub(behaviour: Behaviour) {
  mock.method(globalThis, "fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

    if (url.startsWith("https://api.stripe.com/v1/invoices/create_preview")) {
      return behaviour.preview === "ok"
        ? json({ amount_due: 24_900, currency: "aud" })
        : json(
            {
              error: {
                type: "invalid_request_error",
                code: "invoice_upcoming_none",
                message: "No upcoming invoices for customer: cus_test",
              },
            },
            400,
          );
    }
    if (url.startsWith("https://db.test/rest/v1/agencies")) {
      return json({ id: "agency-1", name: "Hornsby Realty", stripe_customer_id: "cus_test", status: "trialing" });
    }
    if (url.startsWith("https://db.test/rest/v1/profiles")) {
      return json({ email: "licensee@example.com" });
    }
    if (url.startsWith("https://api.resend.com/emails")) {
      if (behaviour.resend === "down") return new Response("upstream unavailable", { status: 503 });
      emails.push(JSON.parse(String(init?.body)));
      return json({ id: "email_1" });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
}

function signedEvent(subscription: Record<string, unknown>): Request {
  const body = JSON.stringify({
    id: "evt_test",
    type: "customer.subscription.trial_will_end",
    data: { object: subscription },
  });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
  return new Request("https://www.realcomply.com.au/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": `t=${t},v1=${v1}` },
    body,
  });
}

function trialingSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_test",
    status: "trialing",
    customer: "cus_test",
    trial_end: Math.floor(Date.now() / 1000) + 3 * 86_400,
    cancel_at_period_end: false,
    cancel_at: null,
    metadata: { agency_id: "agency-1" },
    items: { data: [{ price: { lookup_key: "office_1_monthly" } }] },
    ...overrides,
  };
}

beforeEach(() => {
  calls = [];
  emails = [];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  mock.method(console, "log", () => {});
  mock.method(console, "error", () => {});
});

afterEach(() => mock.restoreAll());

describe("POST /api/stripe/webhook — customer.subscription.trial_will_end", () => {
  it("normal: 200, and the email names the amount", async () => {
    stub({ preview: "ok", resend: "ok" });

    const response = await POST(signedEvent(trialingSubscription()));

    assert.equal(response.status, 200);
    assert.equal(emails.length, 1);
    assert.match(emails[0].subject, /first payment \$249/);
  });

  it("cancelling at trial end: 200, Stripe never asked for a preview, no email", async () => {
    stub({ preview: "no_upcoming_invoice", resend: "ok" });

    const response = await POST(signedEvent(trialingSubscription({ cancel_at_period_end: true })));

    assert.equal(response.status, 200);
    assert.equal(calls.filter((u) => u.includes("api.stripe.com")).length, 0);
    assert.equal(emails.length, 0);
  });

  it("preview refused (no upcoming invoice): 200, not 500, and the email goes without an amount", async () => {
    stub({ preview: "no_upcoming_invoice", resend: "ok" });

    const response = await POST(signedEvent(trialingSubscription()));

    assert.equal(response.status, 200);
    assert.equal(emails.length, 1);
    assert.match(emails[0].text, /your plan will start on/);
    assert.doesNotMatch(emails[0].subject + emails[0].text, /\$\d/);
  });

  it("mail provider down: 500, so Stripe retries", async () => {
    stub({ preview: "ok", resend: "down" });

    const response = await POST(signedEvent(trialingSubscription()));

    assert.equal(response.status, 500);
  });
});
