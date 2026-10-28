import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReopenRequestEmail } from "@/lib/email/reopen-request";

const input = {
  licenseeName: "Lee",
  requesterName: "Ana Agent",
  propertyAddress: "1 Reopen St, Testville (made up)",
  cardTitle: "Final sale price",
  stageLabel: "Settled",
  reason: "Settlement price was <$1 more> than recorded",
  url: "https://example.invalid/dashboard/p1#card-f0",
};

describe("the request to reopen email", () => {
  it("names the file, the card, who asked and why", () => {
    const { subject, text } = buildReopenRequestEmail(input);
    assert.equal(subject, "Request to reopen a signed-off file: 1 Reopen St, Testville (made up)");
    assert.match(text, /Ana Agent asked you to reopen a card on the file for 1 Reopen St, Testville \(made up\)/);
    assert.match(text, /Final sale price/);
    assert.match(text, /Settlement price was <\$1 more> than recorded/);
    assert.match(text, /cancels your sign-off, which is kept on record/);
    assert.match(text, /https:\/\/example\.invalid\/dashboard\/p1#card-f0/);
  });

  it("puts the reason in the HTML as text, never as markup", () => {
    const { html } = buildReopenRequestEmail(input);
    assert.ok(html.includes("Settlement price was &lt;$1 more&gt; than recorded"));
    assert.ok(!html.includes("<$1 more>"));
  });

  it("has no em dashes, the shared footer line included", () => {
    const { text, html } = buildReopenRequestEmail(input);
    assert.ok(!text.includes("\u2014"));
    assert.ok(!html.includes("\u2014"));
  });
});
