import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTestMode } from "./stripe";

// The billing page's "Test mode" notice tells a subscriber nothing will be
// charged. It must never appear on a live key of either kind.
describe("isTestMode", () => {
  it("treats a live secret key as live", () => {
    assert.equal(isTestMode("sk_live_abc123"), false);
  });

  it("treats a live restricted key as live (production uses one)", () => {
    assert.equal(isTestMode("rk_live_abc123"), false);
  });

  it("treats test keys as test mode", () => {
    assert.equal(isTestMode("sk_test_abc123"), true);
    assert.equal(isTestMode("rk_test_abc123"), true);
  });

  it("does not mistake a key that merely contains 'live' for a live key", () => {
    assert.equal(isTestMode("sk_test_live_abc"), true);
  });
});
