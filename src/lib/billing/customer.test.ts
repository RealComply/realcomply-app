import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { checkStoredCustomer } from "./customer";

// The stored customer id is used for checkout or the billing portal only when
// Stripe says it is this agency's. fetch stands in for Stripe.

function stripeAnswers(status: number, body: unknown) {
  mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
});

afterEach(() => mock.restoreAll());

describe("checkStoredCustomer", () => {
  it("is ours when the customer was made for this agency", async () => {
    stripeAnswers(200, { id: "cus_A", object: "customer", metadata: { agency_id: "agency-1" } });
    assert.equal(await checkStoredCustomer("cus_A", "agency-1"), "ours");
  });

  it("is not ours when it names another agency, so another office's billing never opens", async () => {
    stripeAnswers(200, { id: "cus_A", object: "customer", metadata: { agency_id: "agency-2" } });
    assert.equal(await checkStoredCustomer("cus_A", "agency-1"), "not-ours");
  });

  it("is not ours when it carries no agency at all", async () => {
    stripeAnswers(200, { id: "cus_A", object: "customer", metadata: {} });
    assert.equal(await checkStoredCustomer("cus_A", "agency-1"), "not-ours");
  });

  it("is gone when Stripe has no such customer (a sandbox id once the keys are live)", async () => {
    stripeAnswers(404, {
      error: { type: "invalid_request_error", code: "resource_missing", message: "No such customer: 'cus_A'" },
    });
    assert.equal(await checkStoredCustomer("cus_A", "agency-1"), "gone");
  });

  it("is gone when the customer was deleted", async () => {
    stripeAnswers(200, { id: "cus_A", object: "customer", deleted: true });
    assert.equal(await checkStoredCustomer("cus_A", "agency-1"), "gone");
  });

  it("throws any other refusal for the caller to handle", async () => {
    stripeAnswers(401, { error: { type: "invalid_request_error", message: "Invalid API Key provided" } });
    await assert.rejects(checkStoredCustomer("cus_A", "agency-1"));
  });
});
