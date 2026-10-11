import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSendBackEmail } from "./send-back";
import { buildSignoffRequestEmail } from "./signoff-request";

const base = {
  agentName: "Sam",
  licenseeName: "Pat Lee",
  propertyAddress: "23 Test Street, Testville NSW 2000",
  url: "https://www.realcomply.com.au/dashboard/abc",
  cards: [
    { label: "Selling agency agreement", stageLabel: "Listing set-up", note: "Agreement date is wrong", mayBeBreach: false },
    { label: "Estimated selling price", stageLabel: "Listing set-up", note: "Range too wide", mayBeBreach: true },
  ],
};

describe("send-back email to the agent", () => {
  it("names the licensee, the listing and every flagged card with its note", () => {
    const m = buildSendBackEmail(base);
    assert.equal(m.subject, "Changes needed before sign-off: 23 Test Street, Testville NSW 2000");
    for (const part of [m.text, m.html]) {
      assert.match(part, /Pat Lee reviewed the file for 23 Test Street/);
      assert.match(part, /2 cards need changing/);
      assert.match(part, /Agreement date is wrong/);
      assert.match(part, /Range too wide/);
      assert.match(part, /sign the file again/);
      assert.match(part, /breach register/);
    }
  });

  it("puts typed text in as plain text", () => {
    const m = buildSendBackEmail({
      ...base,
      cards: [{ label: "x", stageLabel: "y", note: '<a href="https://evil.example">click</a>', mayBeBreach: false }],
    });
    assert.doesNotMatch(m.html, /<a href="https:\/\/evil/);
    assert.match(m.html, /&lt;a href=/);
  });

  it("leaves out the breach line when nothing was flagged as one", () => {
    const m = buildSendBackEmail({ ...base, cards: [base.cards[0]] });
    assert.doesNotMatch(m.text, /breach register/);
    assert.match(m.text, /One card needs changing/);
  });
});

describe("sign-off request email to the licensee", () => {
  const req = {
    agentName: "Sam",
    agencyName: "Comply Real Estate",
    propertyAddress: "23 Test Street",
    url: "https://www.realcomply.com.au/signoff/tok",
    expiresAt: "10 November 2026",
    agreementDate: null,
    espLow: null,
    espHigh: null,
  };

  it("tells an outside licensee they review the full file, and can send it back", () => {
    const m = buildSignoffRequestEmail(req);
    assert.match(m.text, /opens the full file to review/);
    assert.match(m.text, /send it back to Sam/);
    assert.match(m.text, /Review the file: https:\/\/www\.realcomply\.com\.au\/signoff\/tok/);
    assert.match(m.text, /This link is for you only and expires on 10 November 2026\. If you weren't expecting it, reply to this email and let us know\./);
  });

});
