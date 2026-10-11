import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPriceStatementRequestEmail,
  priceStatementRequestDocument,
  type PriceStatementRequestEmail,
} from "./price-statement-request";

// Builders only: nothing here sends an email.

const base: PriceStatementRequestEmail = {
  agentName: "Sam Agent",
  agencyName: "Hornsby Realty",
  propertyAddress: "42 Landra Ave, Mount Colah",
  url: "https://www.realcomply.com.au/signoff/00000000-0000-0000-0000-000000000000",
  expiresAt: "11 November 2026",
  priceStatement: "Guide $750,000 – $790,000",
  espLow: 750000,
  espHigh: 790000,
};

describe("the price statement request email", () => {
  it("leads with the agent and the address, and does not name RealComply in the subject", () => {
    const { subject } = buildPriceStatementRequestEmail(base);
    assert.equal(subject, "Sam Agent has asked you to approve the price for 42 Landra Ave, Mount Colah");
    assert.ok(!subject.includes("RealComply"));
  });

  it("carries the price statement word for word, with the ESP on the file", () => {
    const { text } = buildPriceStatementRequestEmail(base);
    assert.ok(text.includes("“Guide $750,000 – $790,000”"));
    assert.ok(text.includes("Estimated selling price on the file: $750,000 to $790,000"));
    assert.ok(text.includes("expires on 11 November 2026"));
  });

  it("escapes what was typed, in the HTML", () => {
    const { html } = buildPriceStatementRequestEmail({
      ...base,
      priceStatement: "Offers over <b>$1m</b> & more",
      agencyName: "Smith <script>alert(1)</script> & Co",
    });
    assert.ok(html.includes("Offers over &lt;b&gt;$1m&lt;/b&gt; &amp; more"));
    assert.ok(!html.includes("<b>$1m</b>"));
    assert.ok(!html.includes("<script>"));
  });

  it("leaves the ESP line out when the file has none", () => {
    const doc = priceStatementRequestDocument({ ...base, espLow: null, espHigh: null });
    const rows = doc.sections.find((s) => s.kind === "rows");
    assert.ok(rows && rows.kind === "rows");
    assert.equal(rows.rows[0].detail, undefined);
    assert.ok(!buildPriceStatementRequestEmail({ ...base, espLow: null, espHigh: null }).text.includes("Estimated selling price"));
  });

  it("links the button to the request", () => {
    const doc = priceStatementRequestDocument(base);
    const button = doc.sections.find((s) => s.kind === "button");
    assert.ok(button && button.kind === "button");
    assert.equal(button.label, "Check and approve");
    assert.equal(button.href, base.url);
    assert.ok(buildPriceStatementRequestEmail(base).html.includes(`href="${base.url}"`));
  });
});
