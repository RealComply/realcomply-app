import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildInvitationEmail, buildWelcomeEmail, welcomeSubject } from "./early-access-invite";
import { withSenderName } from "./send";

const base = "https://www.realcomply.com.au";
const invite = (over: Partial<Parameters<typeof buildInvitationEmail>[0]> = {}) =>
  buildInvitationEmail({
    firstName: "sam",
    inviteUrl: `${base}/signup?founder=abc123`,
    unsubscribeUrl: `${base}/unsubscribe?e=sam%40x.com&t=tok`,
    base,
    ...over,
  });

describe("invitation email", () => {
  it("uses the approved subject and wording, with their first name", () => {
    const m = invite();
    assert.equal(m.subject, "Your invitation to RealComply");
    for (const part of [m.text, m.html]) {
      assert.match(part, /Hi Sam,/);
      assert.match(part, /Thank you for registering for early access to RealComply\. Your invitation is ready\./);
      assert.match(part, /RealComply follows a NSW sales file from listing set-up to settled\./);
      assert.match(part, /This link is just for you and works once\. It expires in 60 days\./);
      assert.match(part, /Questions\? Reply to this email\./);
      assert.match(part, /ABN 61 700 934 792/);
    }
    assert.match(m.text, /Set up your office: https:\/\/www\.realcomply\.com\.au\/signup\?founder=abc123/);
    assert.match(m.html, /href="https:\/\/www\.realcomply\.com\.au\/signup\?founder=abc123"/);
    assert.match(m.html, /background:#0b7d50/);
  });

  it('says "Hi there," with no first name', () => {
    assert.match(invite({ firstName: null }).text, /^Hi there,/);
    assert.match(invite({ firstName: "  " }).text, /^Hi there,/);
  });

  it("has a working unsubscribe link, or only the reply instruction when there is no secret", () => {
    const withLink = invite();
    assert.match(withLink.html, /<a href="https:\/\/www\.realcomply\.com\.au\/unsubscribe\?e=sam%40x\.com&amp;t=tok"[^>]*>unsubscribe here<\/a>/);
    assert.match(withLink.text, /reply "unsubscribe" or unsubscribe here <https:\/\/www\.realcomply\.com\.au\/unsubscribe/);

    const noLink = invite({ unsubscribeUrl: null });
    assert.doesNotMatch(noLink.html + noLink.text, /unsubscribe here/);
    assert.match(noLink.text, /To stop these emails, reply "unsubscribe"\.$/m);
  });

  it("escapes a name typed into the landing page form", () => {
    const m = invite({ firstName: '<img src=x onerror="alert(1)">' });
    assert.doesNotMatch(m.html, /<img src=x/);
    assert.match(m.html, /&lt;img src=x/);
  });

  it("contains no em dashes", () => {
    const m = invite();
    assert.doesNotMatch(m.subject + m.text + m.html, /—/);
  });
});

describe("welcome email", () => {
  it("uses the approved subject and wording, and links the picture to Getting started", () => {
    const m = buildWelcomeEmail({ firstName: "Priya", base });
    assert.equal(m.subject, "Welcome to RealComply, Priya");
    for (const part of [m.text, m.html]) {
      assert.match(part, /Welcome aboard\. Your office is all set up, and we're really glad to have you with us\./);
      assert.match(part, /Grab a coffee\. It takes less than four minutes\./);
      assert.match(part, /Click New listing at the top of any page\./);
      assert.match(part, /We read every one and we're always happy to help\./);
      assert.match(part, /Warm regards,/);
    }
    assert.match(m.html, /href="https:\/\/www\.realcomply\.com\.au\/dashboard\/getting-started"/);
    assert.match(m.html, /<img src="https:\/\/www\.realcomply\.com\.au\/email-video\.png"[^>]*alt="[^"]+"/);
    assert.match(m.html, /For licensees/);
    assert.match(m.html, /3 min 40/);
    assert.doesNotMatch(m.html + m.text, /unsubscribe/i, "the welcome footer has no unsubscribe line");
    assert.doesNotMatch(m.subject + m.text + m.html, /—/);
  });

  it("works without a first name", () => {
    assert.equal(welcomeSubject(null), "Welcome to RealComply");
    assert.match(buildWelcomeEmail({ firstName: null, base }).text, /^Hi there,/);
  });
});

describe("withSenderName", () => {
  it("keeps the configured address and shows RealComply", () => {
    assert.equal(withSenderName("noreply@realcomply.com.au", "RealComply"), '"RealComply" <noreply@realcomply.com.au>');
    assert.equal(
      withSenderName("RealComply Notifications <noreply@realcomply.com.au>", "RealComply"),
      '"RealComply" <noreply@realcomply.com.au>',
    );
  });
});
