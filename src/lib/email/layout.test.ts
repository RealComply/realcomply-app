import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DILIGENCE_LINE, renderEmailHtml, renderEmailText, type EmailDocument } from "@/lib/email/layout";

describe("the shared diligence line", () => {
  it("has no em dash, and ends on its own sentence", () => {
    assert.ok(!DILIGENCE_LINE.includes("—"));
    assert.ok(DILIGENCE_LINE.endsWith("doesn't replace your own judgement. You decide."));
  });

  it("reaches the email footer as it is written", () => {
    const doc: EmailDocument = { preheader: "Test", sections: [], footer: [DILIGENCE_LINE] };
    assert.ok(renderEmailText(doc).includes(DILIGENCE_LINE));
    assert.ok(renderEmailHtml(doc).includes(DILIGENCE_LINE));
  });
});
