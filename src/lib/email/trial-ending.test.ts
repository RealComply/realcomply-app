import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { trialEndingMessage } from "./trial-ending";

// 15 Oct 2026 09:00 UTC, which is 8pm Thursday in Sydney.
const base = {
  agencyName: "Hornsby Realty",
  plan: "office_1" as const,
  interval: "monthly" as const,
  trialEnd: new Date(Date.UTC(2026, 9, 15, 9)),
};

describe("trialEndingMessage", () => {
  it("with the amount: names the payment date and the amount", () => {
    const m = trialEndingMessage({ ...base, amountCents: 24_900 });

    assert.equal(m.subject, "Your RealComply trial ends Thursday 15 October 2026 — first payment $249");
    assert.match(m.text, /\$249 on Thursday 15 October 2026/);
    assert.match(m.text, /first payment will be taken that day/);
  });

  it("without the amount: says the plan will start on the date, and names no figure", () => {
    const m = trialEndingMessage({ ...base, amountCents: null });

    assert.match(m.subject, /your plan will start on Thursday 15 October 2026/);
    assert.match(m.text, /your plan will start on Thursday 15 October 2026/);
    assert.doesNotMatch(m.subject + m.text + m.html, /\$\d/, "no dollar amount anywhere");
    assert.doesNotMatch(m.text, /Charged to the card you entered/);
  });
});
