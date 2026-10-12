import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderEmailHtml, renderEmailText, type EmailDocument } from "./layout";
import { buildSignoffRequestEmail } from "./signoff-request";
import { buildPriceStatementRequestEmail } from "./price-statement-request";
import { holderDocument } from "./licence-reminders";
import { earlyAccessAcknowledgementHtml, earlyAccessAcknowledgementText } from "./early-access-ack";

// Code review fixes, part C (12 Oct 2026): what someone types into the app
// goes into an email as plain text, never as markup. Finding 7: an agency
// named with an <a href=...> in it planted a working link in the footer of
// the sign-off email the licensee receives. Built from made-up data only;
// nothing is sent.

const PLANTED = 'Harbour Realty <a href="https://evil.example/login">Sign in again</a>';
const IMG = '<img src="https://evil.example/pixel.gif">';

/** Every link and image the HTML would show. */
const tags = (html: string) => html.match(/<(a|img)\b[^>]*>/g) ?? [];

describe("typed text in an email footer", () => {
  it("the sign-off email: a planted link in the agency or agent name is shown as text, not a link", () => {
    const m = buildSignoffRequestEmail({
      agentName: IMG,
      agencyName: PLANTED,
      propertyAddress: "1 Test St, Exampleville",
      url: "https://www.realcomply.com.au/signoff/tok",
      expiresAt: "26 Oct 2026",
      agreementDate: null,
      espLow: null,
      espHigh: null,
    });

    assert.deepEqual(
      tags(m.html).filter((t) => t.includes("evil.example")),
      [],
      "no planted link or image anywhere in the email",
    );
    assert.ok(m.html.includes("Harbour Realty &lt;a href=&quot;https://evil.example/login&quot;&gt;Sign in again&lt;/a&gt;"));
    assert.ok(m.html.includes("&lt;img src=&quot;https://evil.example/pixel.gif&quot;&gt;"));
    // The plain-text version shows the name exactly as it was typed.
    assert.ok(m.text.includes(`Sent by ${PLANTED} through RealComply, the compliance system ${IMG} uses`));
  });

  it("the price statement email: the same, and the names are no longer cut down to make them safe", () => {
    const m = buildPriceStatementRequestEmail({
      agentName: "Sam <Lead> Agent",
      agencyName: PLANTED,
      propertyAddress: "1 Test St, Exampleville",
      url: "https://www.realcomply.com.au/approve/tok",
      expiresAt: "26 Oct 2026",
      priceStatement: "Guide $750,000",
      espLow: 750000,
      espHigh: 790000,
    });

    assert.deepEqual(tags(m.html).filter((t) => t.includes("evil.example")), []);
    assert.ok(m.html.includes("Sam &lt;Lead&gt; Agent"), "shown as typed, brackets and all");
    assert.ok(m.text.includes("the compliance system Sam <Lead> Agent uses"));
  });

  it("any footer line: markup is escaped, so nothing but RealComply's own links can appear there", () => {
    const doc: EmailDocument = {
      preheader: "p",
      sections: [],
      footer: ['Tom & Jerry <b>Realty</b> "quoted"', ["Reach us:", { text: "Help <now>", href: 'https://x.test/?a=1&b="2"' }]],
    };
    const html = renderEmailHtml(doc);

    assert.ok(html.includes("Tom &amp; Jerry &lt;b&gt;Realty&lt;/b&gt; &quot;quoted&quot;"));
    assert.ok(html.includes('Reach us: <a href="https://x.test/?a=1&amp;b=&quot;2&quot;" style="color:#8a9a93">Help &lt;now&gt;</a>'));
    assert.equal(tags(html).length, 1, "the one link the email itself offers");

    const text = renderEmailText(doc);
    assert.ok(text.endsWith('---\nTom & Jerry <b>Realty</b> "quoted"\nReach us: Help <now>: https://x.test/?a=1&b="2"'));
  });
});

describe("RealComply's own footer links", () => {
  it("still work in HTML, and now give their address in the plain-text version", () => {
    const doc = holderDocument(
      {
        kind: "profile",
        profileId: "00000000-0000-4000-8000-000000000001",
        holderName: "Alex Holder",
        holderEmail: "alex@example.test",
        credential: "Class 2 agent's licence",
        licenceNumber: "123",
        expiry: "2026-11-11",
      },
      30,
    );

    assert.ok(
      renderEmailHtml(doc).includes(
        '<a href="https://www.realcomply.com.au/dashboard/registers" style="color:#8a9a93">See the register any time</a>',
      ),
    );
    assert.ok(renderEmailText(doc).includes("See the register any time: https://www.realcomply.com.au/dashboard/registers"));
  });

  describe("the early access acknowledgement's unsubscribe link", () => {
    const before = process.env.EMAIL_UNSUBSCRIBE_SECRET;
    afterEach(() => {
      if (before === undefined) delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
      else process.env.EMAIL_UNSUBSCRIBE_SECRET = before;
    });

    it("is a link in HTML, and the plain-text version now carries the address too", () => {
      process.env.EMAIL_UNSUBSCRIBE_SECRET = "test-secret";
      const html = earlyAccessAcknowledgementHtml("sam@example.test", "Sam");
      const text = earlyAccessAcknowledgementText("sam@example.test", "Sam");

      assert.match(html, /<a href="https:\/\/[^"]*\/unsubscribe\?e=sam%40example\.test&amp;t=[0-9a-f]{64}"[^>]*>Unsubscribe<\/a>/);
      assert.match(text, /registered for early access at realcomply\.com\.au\.\nUnsubscribe: https:\/\/\S+\/unsubscribe\?e=sam%40example\.test&t=[0-9a-f]{64}$/);
    });

    it("without the secret: the reply instruction, and no link", () => {
      delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
      const html = earlyAccessAcknowledgementHtml("sam@example.test", "Sam");

      assert.ok(html.includes("reply to this email with UNSUBSCRIBE"));
      assert.equal(tags(html).length, 0);
    });
  });
});
