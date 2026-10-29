import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COMMUNITY_GROUP_URL,
  buildInvitationEmail,
  buildPersonalInvitationEmail,
  buildWelcomeEmail,
  welcomeSubject,
} from "./early-access-invite";
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
  it("uses the approved subject and wording, with their first name, and never says early access", () => {
    const m = invite();
    assert.equal(m.subject, "Your RealComply set-up link");
    for (const part of [m.text, m.html]) {
      assert.match(part, /Hi Sam,/);
      assert.match(part, /Here's your set-up link\. Your 14-day free trial starts when you set up your office\./);
      assert.match(part, /This link is just for you and works once\. It expires in 60 days\./);
      assert.match(part, /Any questions, just reply here\./);
      assert.match(part, /You joined RealComply at realcomply\.com\.au\./);
      assert.match(part, /ABN 61 700 934 792/);
      assert.doesNotMatch(part, /early access|registered|invitation/i);
      assert.ok(!part.includes("\u2014"));
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

describe("personal invitation email", () => {
  const personal = (firstName: string | null = "dave") =>
    buildPersonalInvitationEmail({ firstName, inviteUrl: `${base}/signup?founder=def456`, base });

  it("uses the approved wording, signed by the team, and never says they registered", () => {
    const m = personal();
    assert.equal(m.subject, "Your invitation to RealComply");
    for (const part of [m.text, m.html]) {
      assert.match(part, /Hi Dave,/);
      assert.match(part, /We'd like to invite you to try RealComply\. Your invitation is ready\./);
      assert.match(part, /The RealComply team/);
      assert.match(part, /You were invited personally by the RealComply team\./);
      assert.doesNotMatch(part, /registered|early access|Adam/);
    }
    assert.match(m.text, /Set up your office: https:\/\/www\.realcomply\.com\.au\/signup\?founder=def456/);
    assert.match(m.text, /To stop these emails, reply "unsubscribe"\.$/m);
  });

  it('says "Hi there," with no first name, and has no em dashes', () => {
    const m = personal(null);
    assert.match(m.text, /^Hi there,/);
    assert.doesNotMatch(m.subject + m.text + m.html, /—/);
  });
});

describe("welcome email", () => {
  it("uses the approved subject and wording, and links the picture to Getting started", () => {
    const m = buildWelcomeEmail({ firstName: "Priya", base });
    assert.equal(m.subject, "Welcome to RealComply, Priya");
    for (const part of [m.text, m.html]) {
      assert.match(
        part,
        /Welcome aboard\. Your office is all set up, and we're really glad to have you with us\. We look forward to helping you keep on top of your compliance obligations\./,
      );
      assert.match(part, /Grab a coffee\. It takes less than four minutes\./);
      assert.match(part, /Click New listing at the top of any page\./);
      assert.match(part, /If anything's unclear or you get stuck, just reply to this email\. We're always happy to help\./);
      assert.doesNotMatch(part, /We read every one/);
      assert.match(part, /Warm regards,/);
    }
    assert.match(m.html, /href="https:\/\/www\.realcomply\.com\.au\/dashboard\/getting-started"/);
    assert.match(m.html, /<img src="https:\/\/www\.realcomply\.com\.au\/email-video\.png"[^>]*alt="[^"]+"/);
    assert.match(m.html, /For licensees/);
    assert.match(m.html, /3 min 40/);
    assert.doesNotMatch(m.html + m.text, /unsubscribe/i, "the welcome footer has no unsubscribe line");
    assert.doesNotMatch(m.subject + m.text + m.html, /—/);
  });

  // The community group (Adam, 12 Oct 2026): a light green box after the two
  // steps and before the help line, with an outlined button so it doesn't
  // compete with the main green one.
  it("invites them to the RealComply group, between the steps and the help line", () => {
    const m = buildWelcomeEmail({ firstName: "Priya", base });
    const heading = "Join other agents in the RealComply group";
    const text =
      "We've started a private Facebook group for agents and licensees who use RealComply in NSW. Ask how others handle a tricky file, share what's working, and hear about new features first. Only members can see what's posted.";

    for (const part of [m.text, m.html]) {
      const steps = part.indexOf("Drop in the agency agreement");
      const box = part.indexOf(heading);
      const help = part.indexOf("If anything's unclear");
      assert.ok(steps > 0 && steps < box && box < help, "steps, then the group, then the help line");
      assert.ok(part.includes(text));
    }

    // HTML: the box's colours, and a white pill with a green border and green text.
    assert.match(m.html, /background:#eaf6f0;border:1px solid #cfe7db;border-radius:12px/);
    assert.match(m.html, new RegExp(`font-weight:700;color:#16302a">${heading}</p>`));
    assert.match(
      m.html,
      /<td style="background:#ffffff;border:2px solid #0b7d50;border-radius:999px"><a href="https:\/\/www\.facebook\.com\/groups\/realcomplymembers\/" style="[^"]*color:#0b7d50[^"]*">Join the group<\/a>/,
    );
    assert.equal(COMMUNITY_GROUP_URL, "https://www.facebook.com/groups/realcomplymembers/");

    // Plain text: the heading, the text, then the link written out.
    assert.ok(m.text.includes(`${heading}\n${text}\n\nJoin the group: https://www.facebook.com/groups/realcomplymembers/\n`));
  });

  it("the invitation does not mention the group", () => {
    const invite = buildInvitationEmail({ firstName: "Sam", inviteUrl: `${base}/signup?founder=tok`, unsubscribeUrl: null, base });
    assert.doesNotMatch(invite.html + invite.text, /facebook|RealComply group/i);
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
