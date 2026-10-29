import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EARLY_ACCESS_SUBJECT,
  earlyAccessAcknowledgementHtml,
  earlyAccessAcknowledgementText,
} from "@/lib/email/early-access-ack";

// The email someone gets when they join on the website (Adam, 29 Oct 2026).

describe("the welcome email on joining", () => {
  it("is Adam's wording, word for word", () => {
    assert.equal(EARLY_ACCESS_SUBJECT, "Welcome to RealComply");
    const text = earlyAccessAcknowledgementText("sam@example.test", "Sam");
    assert.ok(
      text.includes(
        [
          "Hi Sam,",
          "",
          "Thanks for joining RealComply. Your set-up link is on its way shortly, and then your 14-day free trial begins.",
          "",
          "Any questions, just reply here.",
          "",
          "The RealComply team",
        ].join("\n"),
      ),
      text,
    );
  });

  it("keeps the standing footer and says why they got it", () => {
    for (const part of [
      earlyAccessAcknowledgementText("sam@example.test", "Sam"),
      earlyAccessAcknowledgementHtml("sam@example.test", "Sam"),
    ]) {
      assert.ok(
        part.includes(
          "RealComply provides diligence support. It is not legal advice, and the licensee remains responsible for decisions and sign-off.",
        ),
      );
      assert.ok(part.includes("receiving this because you joined RealComply at realcomply.com.au."));
    }
  });

  it("never says early access, and has no em dash", () => {
    for (const part of [
      earlyAccessAcknowledgementText("sam@example.test", "Sam"),
      earlyAccessAcknowledgementHtml("sam@example.test", "Sam"),
    ]) {
      assert.doesNotMatch(part, /early access|on the list/i);
      assert.ok(!part.includes("—"));
    }
  });

  it("greets 'Hi there,' when there is no first name", () => {
    assert.ok(earlyAccessAcknowledgementText("sam@example.test", "  ").includes("Hi there,"));
  });
});
