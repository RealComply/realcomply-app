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
    { itemKey: "a3", label: "Selling agency agreement", stageLabel: "Listing set-up", note: "Agreement date is wrong", mayBeBreach: false },
    { itemKey: "a4", label: "Estimated selling price", stageLabel: "Listing set-up", note: "Range too wide", mayBeBreach: true },
  ],
  priceStatementByEmail: false,
};

const priceStatement = {
  itemKey: "b4",
  label: "Licensee approved the price statement before publication",
  stageLabel: "Pre-market",
  note: "That is not the advertised price",
  mayBeBreach: false,
};

const RESEND = "Send the price statement to your licensee again from this card. Their approval clears this note.";

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
      cards: [{ itemKey: "a3", label: "x", stageLabel: "y", note: '<a href="https://evil.example">click</a>', mayBeBreach: false }],
    });
    assert.doesNotMatch(m.html, /<a href="https:\/\/evil/);
    assert.match(m.html, /&lt;a href=/);
  });

  it("leaves out the breach line when nothing was flagged as one", () => {
    const m = buildSendBackEmail({ ...base, cards: [base.cards[0]] });
    assert.doesNotMatch(m.text, /breach register/);
    assert.match(m.text, /One card needs changing/);
  });

  it("tells the agent to mark each card done when nothing goes by email", () => {
    const m = buildSendBackEmail(base);
    assert.match(m.text, /Each card is back to not done\. Fix it and mark it done as usual\. When every card is done/);
    assert.ok(!m.text.includes(RESEND));
  });

  // Nobody signed in can mark b4 done when it goes by email (0066), so the
  // email can't tell the agent to, any more than the card can (review, 11 Oct 2026).
  it("sends the agent to the price statement's card when it goes by email and is the only card", () => {
    const m = buildSendBackEmail({ ...base, cards: [priceStatement], priceStatementByEmail: true });
    for (const part of [m.text, m.html]) {
      assert.ok(part.includes(`That is not the advertised price. ${RESEND}`));
      assert.match(part, /The price statement is back to not done\. Send it to your licensee again from its card/);
      assert.match(part, /sign the file again/);
      assert.doesNotMatch(part, /mark it done as usual/);
    }
  });

  it("keeps the usual words for the other cards, and makes the price statement the exception", () => {
    const m = buildSendBackEmail({ ...base, cards: [...base.cards, priceStatement], priceStatementByEmail: true });
    for (const part of [m.text, m.html]) {
      assert.match(part, /3 cards need changing/);
      assert.match(part, /Fix it and mark it done as usual, except the price statement: send that to your licensee again/);
      // Only on the price statement's own row.
      assert.equal(part.split(RESEND).length - 1, 1);
      assert.ok(part.includes(`That is not the advertised price. ${RESEND}`));
    }
    assert.match(m.text, /Range too wide \(Flagged as a possible breach\.\)\n/);
  });

  it("leaves a note that already ends a sentence as it is", () => {
    const m = buildSendBackEmail({
      ...base,
      cards: [{ ...priceStatement, note: "Is that the advertised price?" }],
      priceStatementByEmail: true,
    });
    assert.ok(m.text.includes(`Is that the advertised price? ${RESEND}`));
  });

  it("ends a note that closes on a bracket or quote mark, not a full stop", () => {
    for (const note of ["Use the range (not a single figure)", 'Change it to "Guide $750,000"']) {
      const m = buildSendBackEmail({
        ...base,
        cards: [{ ...priceStatement, note }],
        priceStatementByEmail: true,
      });
      assert.ok(m.text.includes(`${note}. ${RESEND}`), note);
    }
    const quoted = buildSendBackEmail({
      ...base,
      cards: [{ ...priceStatement, note: 'It said "Guide $750,000."' }],
      priceStatementByEmail: true,
    });
    assert.ok(quoted.text.includes(`It said "Guide $750,000." ${RESEND}`));
  });

  it("puts the line after the breach flag on a price statement flagged as one", () => {
    const m = buildSendBackEmail({
      ...base,
      cards: [{ ...priceStatement, mayBeBreach: true }],
      priceStatementByEmail: true,
    });
    assert.ok(m.text.includes(`That is not the advertised price (Flagged as a possible breach.) ${RESEND}`));
    assert.match(m.text, /breach register/);
  });

  it("keeps the usual words on the price statement when the licensee approves it in the app", () => {
    const m = buildSendBackEmail({ ...base, cards: [priceStatement], priceStatementByEmail: false });
    assert.ok(!m.text.includes(RESEND));
    assert.match(m.text, /Fix it and mark it done as usual\. When every card is done/);
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
