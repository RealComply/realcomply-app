import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cancellationEmail, cancelledStage, stripeCustomerLink, type CancelledOffice } from "@/lib/email/cancellation-alert";

// The email Adam gets when an office cancels (brief, 3 Nov 2026). Made-up office.

const office: CancelledOffice = {
  name: "Throwaway Test Realty",
  plan: "agent_1",
  createdAt: "2026-10-20T01:30:00Z",
  licenseeName: "Lee Throwaway",
  licenseeEmail: "lee@example.invalid",
};
// 2 Nov 2026, 3:27 pm in Sydney (AEDT, UTC+11).
const CANCELLED = Date.UTC(2026, 10, 2, 4, 27) / 1000;
const TRIAL_END = Date.UTC(2026, 10, 3, 1, 30) / 1000;

describe("the cancellation email", () => {
  it("says who, what plan, when, at what stage, and why, in plain lines", () => {
    const { subject, text } = cancellationEmail(office, {
      id: "sub_x",
      customer: "cus_x",
      livemode: true,
      trial_end: TRIAL_END,
      canceled_at: CANCELLED,
      ended_at: CANCELLED + 2,
      cancellation_details: { feedback: "switched_service", comment: null, reason: "cancellation_requested" },
    });
    assert.equal(subject, "Cancelled: Throwaway Test Realty");
    assert.equal(
      text,
      [
        "Throwaway Test Realty has cancelled RealComply.",
        "",
        "Office: Throwaway Test Realty",
        "Licensee: Lee Throwaway (lee@example.invalid)",
        "Plan: agent_1",
        "Signed up: 20 October 2026",
        "Cancelled: 2 Nov 2026, 3:27 pm (Sydney)",
        "Trial end: 3 November 2026",
        "When: During the free trial",
        "",
        "Reason they gave: I found an alternative",
        "",
        "In Stripe: https://dashboard.stripe.com/customers/cus_x",
      ].join("\n"),
    );
    assert.ok(!/[—–]/.test(text), "no dashes");
  });

  it("what they typed, with or without an option picked; 'None given' when neither", () => {
    const base = { id: "s", customer: "c", trial_end: TRIAL_END, canceled_at: CANCELLED };
    const both = cancellationEmail(office, { ...base, cancellation_details: { feedback: "other", comment: "We need ACT too (made up)." } }).text;
    assert.ok(both.includes("Reason they gave: Other reason\nTheir words: \"We need ACT too (made up).\""), both);
    const typedOnly = cancellationEmail(office, { ...base, cancellation_details: { comment: "  Too busy (made up).  " } }).text;
    assert.ok(typedOnly.includes('Reason they gave: "Too busy (made up)."') && !typedOnly.includes("Their words"), typedOnly);
    const none = cancellationEmail(office, { ...base, cancellation_details: { feedback: null, comment: "" } }).text;
    assert.ok(none.includes("Reason they gave: None given"), none);
    const absent = cancellationEmail(office, base).text;
    assert.ok(absent.includes("Reason they gave: None given"), absent);
  });

  it("a paid month booked to cancel says when access ended too; a failed payment says Stripe ended it", () => {
    const text = cancellationEmail(office, {
      id: "s",
      customer: "c",
      trial_end: TRIAL_END,
      canceled_at: TRIAL_END + 5 * 86_400,
      ended_at: TRIAL_END + 30 * 86_400,
      cancellation_details: { reason: "payment_failed" },
    }).text;
    assert.ok(text.includes("When: After the free trial, while paying"), text);
    assert.ok(/Access ended: 3 Dec 2026, /.test(text), text);
    assert.ok(text.includes("Stripe ended it because a payment failed."), text);
  });

  it("nothing recorded about the licensee or the plan says so, never a blank", () => {
    const text = cancellationEmail(
      { name: "  ", plan: null, createdAt: null, licenseeName: null, licenseeEmail: "only@example.invalid" },
      { id: "s", customer: "c", trial_end: null },
    ).text;
    assert.ok(text.startsWith("An office has cancelled RealComply."), text);
    assert.ok(text.includes("Licensee: only@example.invalid"), text);
    assert.ok(text.includes("Plan: Not recorded") && text.includes("Signed up: Not recorded"), text);
    assert.ok(text.includes("Cancelled: Not recorded") && text.includes("Trial end: No free trial"), text);
  });
});

describe("the stage it was cancelled at", () => {
  it("during the trial, at its end (no card), after it, or with no trial at all", () => {
    assert.equal(cancelledStage({ trial_end: TRIAL_END, canceled_at: TRIAL_END - 3600 }), "During the free trial");
    assert.equal(cancelledStage({ trial_end: TRIAL_END, canceled_at: TRIAL_END }), "When the free trial ended");
    assert.equal(cancelledStage({ trial_end: TRIAL_END, canceled_at: TRIAL_END + 30 }), "When the free trial ended");
    assert.equal(cancelledStage({ trial_end: TRIAL_END, canceled_at: TRIAL_END + 86_400 }), "After the free trial, while paying");
    assert.equal(cancelledStage({ trial_end: null, canceled_at: CANCELLED }), "No free trial, while paying");
    assert.equal(cancelledStage({ trial_end: TRIAL_END, ended_at: TRIAL_END - 7200 }), "During the free trial");
  });
});

describe("the link to the customer in Stripe", () => {
  it("live, or the test dashboard for a test-mode subscription", () => {
    assert.equal(stripeCustomerLink({ customer: "cus_1", livemode: true }), "https://dashboard.stripe.com/customers/cus_1");
    assert.equal(stripeCustomerLink({ customer: "cus_1", livemode: false }), "https://dashboard.stripe.com/test/customers/cus_1");
    assert.equal(stripeCustomerLink({ customer: "cus_1" }), "https://dashboard.stripe.com/customers/cus_1");
  });
});
