import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildLicenseeConfirmEmail, licenseeConfirmSubject } from "./licensee-confirm";

// Builders only: nothing here sends an email.

describe("the email that asks a licensee address to confirm (Master, 4 Nov 2026)", () => {
  const url = "https://www.realcomply.com.au/licensee-confirm/00000000-0000-0000-0000-000000000000";
  const email = buildLicenseeConfirmEmail({ officeName: " Harbour Street Realty ", url });

  it("asks only whether they're the licensee in charge at the office", () => {
    assert.equal(email.subject, "Confirm you're the licensee in charge at Harbour Street Realty");
    assert.equal(licenseeConfirmSubject("Harbour Street Realty"), email.subject);
    assert.ok(email.text.includes("Confirm you're the licensee in charge at Harbour Street Realty"));
    assert.ok(email.html.includes("Harbour Street Realty"));
  });

  it("has one button, to the confirm link, in both parts", () => {
    assert.equal(email.html.split(url).length - 1, 1, "the link appears once in the HTML");
    assert.ok(email.text.includes(url));
    assert.ok(email.html.includes(">Confirm<"));
  });

  it("carries nothing from the office's records", () => {
    for (const word of ["listing", "sign off", "sign-off", "approve", "office manager", "complaint", "trust", "invite"]) {
      assert.ok(!email.text.toLowerCase().includes(word), word);
    }
  });

  it("has no em dashes", () => {
    assert.ok(!email.text.includes("—"));
    assert.ok(!email.subject.includes("—"));
  });
});
