import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { keptPlanEmail, planChangeEmail, sendPlanChangeAlert } from "./plan-change-alert";

const base = {
  officeName: "Made Up Realty",
  changedBy: "Cass Example",
  fromPlan: "agent_1" as const,
  fromInterval: "monthly" as const,
  toPlan: "office_1" as const,
  toInterval: "monthly" as const,
  timing: "now" as const,
  effectiveAt: "2026-11-06T08:00:00Z",
  amountTodayCents: 5918,
  ongoingCents: 24900,
  licensee: null,
  customer: "cus_TEST",
  livemode: false,
  at: "2026-11-06T08:00:00Z",
};

describe("Adam's email for every plan change (mockup note 6)", () => {
  it("says the office, from, to, when, what was charged and who", () => {
    const email = planChangeEmail(base);
    assert.equal(email.subject, "Plan change: Made Up Realty, Agent 1 to Office 1");
    assert.equal(
      email.text,
      [
        "Made Up Realty changed plan.",
        "",
        "Office: Made Up Realty",
        "From: Agent 1, monthly",
        "To: Office 1, monthly",
        "When: Now",
        "Charged today: $59.18 (GST included)",
        "New price: $249.00 a month",
        "Changed by: Cass Example, 6 Nov 2026, 7:00 pm (Sydney)",
        "",
        "In Stripe: https://dashboard.stripe.com/test/customers/cus_TEST",
      ].join("\n"),
    );
  });

  it("a change from the next billing date says so, and charges nothing today", () => {
    const email = planChangeEmail({
      ...base,
      fromPlan: "office_3",
      toPlan: "office_2",
      timing: "next_billing_date",
      effectiveAt: "2026-11-18T09:00:00Z",
      amountTodayCents: 0,
      ongoingCents: 34900,
      livemode: true,
    });
    assert.match(email.text, /When: From 18 November 2026 \(the next billing date\)/);
    assert.match(email.text, /Charged today: \$0\.00/);
    assert.match(email.text, /dashboard\.stripe\.com\/customers\/cus_TEST/);
  });

  it("names the licensee for an agent moving to an office plan", () => {
    const self = planChangeEmail({ ...base, licensee: { answer: "self", name: null, email: null } });
    assert.match(self.text, /Licensee in charge: Cass Example \(said "I am"\)/);
    const other = planChangeEmail({
      ...base,
      licensee: { answer: "someone_else", name: "Lee Licensee", email: "lee@example.invalid" },
    });
    assert.match(
      other.text,
      /Licensee in charge: Lee Licensee \(lee@example\.invalid\)\. Confirm email sent; Cass Example keeps the office side until they approve\./,
    );
  });

  it("carries anything to put right", () => {
    const email = planChangeEmail({ ...base, problem: "The licensee answer wasn't recorded." });
    assert.match(email.text, /To check: The licensee answer wasn't recorded\./);
  });

  it("keeping a plan instead of a booked change is told too", () => {
    const email = keptPlanEmail({
      officeName: "Made Up Realty",
      keptBy: "Cass Example",
      plan: "office_3",
      interval: "monthly",
      cancelledPlan: "office_2",
      cancelledInterval: "monthly",
      at: "2026-11-06T08:00:00Z",
    });
    assert.equal(email.subject, "Plan change cancelled: Made Up Realty stays on Office 3");
    assert.match(email.text, /Change taken off: Office 2, monthly/);
  });

  it("goes to admin@realcomply.com.au and never throws", async () => {
    let to: unknown = null;
    assert.equal(
      await sendPlanChangeAlert({ subject: "s", text: "t" }, async (input) => ((to = input.to), true)),
      true,
    );
    assert.equal(to, "admin@realcomply.com.au");
    assert.equal(
      await sendPlanChangeAlert({ subject: "s", text: "t" }, async () => {
        throw new Error("down");
      }),
      false,
    );
  });
});
