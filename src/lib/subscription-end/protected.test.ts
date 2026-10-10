import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isProtectedAgency, protectionReason } from "./protected";

// The brief's hard requirement: Cass Property, Comply Real Estate, comped
// agencies and the platform owner's agency are never picked up, whatever
// Stripe says. Each case below is an agency in exactly the state that would
// otherwise be deleted: cancelled, with nothing else protecting it.

const CASS = "b4763dfb-b33e-43bb-94ca-702a7e989a27";
const COMPLY = "2972edd0-7995-4946-803b-064d2a50baee";
const THROWAWAY = "11111111-2222-3333-4444-555555555555";

const cancelled = { status: "canceled", comped_by: null, hasPlatformAdmin: false };

describe("protected agencies", () => {
  it("never picks up Cass Property, even cancelled with nothing else set", () => {
    assert.equal(isProtectedAgency({ id: CASS, ...cancelled }), true);
  });

  it("never picks up Comply Real Estate, even cancelled with no comped_by", () => {
    assert.equal(isProtectedAgency({ id: COMPLY, ...cancelled }), true);
  });

  it("never picks up an agency comped by an admin, even after Stripe cancels it", () => {
    assert.equal(isProtectedAgency({ id: THROWAWAY, ...cancelled, comped_by: "admin-profile" }), true);
  });

  it("never picks up an agency whose status is comped", () => {
    assert.equal(isProtectedAgency({ id: THROWAWAY, ...cancelled, status: "comped" }), true);
  });

  it("never picks up the platform owner's agency", () => {
    assert.equal(isProtectedAgency({ id: THROWAWAY, ...cancelled, hasPlatformAdmin: true }), true);
  });

  it("does pick up an ordinary cancelled agency", () => {
    assert.equal(isProtectedAgency({ id: THROWAWAY, ...cancelled }), false);
    assert.equal(protectionReason({ id: THROWAWAY, ...cancelled }), null);
  });
});
