import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { needsTrialStart, TRIAL_DAYS } from "./entitlement";

// Adam, 9 Oct 2026: a new office starts on a 14-day trial with card details
// taken at sign-up (Terms v.4 cl 4.3). Comped is only ever set by hand.
describe("the free trial", () => {
  it("is 14 days", () => {
    assert.equal(TRIAL_DAYS, 14);
  });

  it("has to be started by a new office with no card yet", () => {
    assert.equal(needsTrialStart({ status: "trialing", stripe_subscription_id: null }), true);
  });

  it("is under way once Stripe has taken the card", () => {
    assert.equal(needsTrialStart({ status: "trialing", stripe_subscription_id: "sub_123" }), false);
  });

  it("never stops a paying, comped or ended agency", () => {
    for (const status of ["active", "comped", "past_due", "canceled"]) {
      assert.equal(needsTrialStart({ status, stripe_subscription_id: null }), false, status);
    }
  });
});
