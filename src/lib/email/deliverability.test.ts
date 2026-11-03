import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_REPLY_TO, withReplyTo } from "@/lib/email/send";
import { buildSignoffRequestEmail } from "@/lib/email/signoff-request";
import { buildOfficeManagerRequestEmail } from "@/lib/email/office-manager";
import { buildAnnexureRequestEmail } from "@/lib/email/sg-annexure";
import { buildInvitationEmail } from "@/lib/email/early-access-invite";

// Email that gets through (Adam, 2 Nov 2026, queue item 2). Vic Srbinovski's
// office held a RealComply approval email on 21 Oct. Offices must never need
// IT to let RealComply through, so the emails that ask someone to approve or
// sign carry nothing office email security scores against them: a plain-text
// part, no hidden text, no remote images, every link on www.realcomply.com.au
// (no shorteners or tracking redirects), and a reply-to that reaches a person.

const BASE = "https://www.realcomply.com.au";

const approvals = {
  "file sign-off": buildSignoffRequestEmail({
    agentName: "Ana Agent",
    agencyName: "Harbour Realty (made up)",
    propertyAddress: "1 Test Street, Testville NSW 2000",
    url: `${BASE}/signoff/00000000-0000-4000-8000-000000000001`,
    expiresAt: "2 December 2026",
    agreementDate: "1 November 2026",
    espLow: 900000,
    espHigh: 990000,
  }),
  "office manager approval": buildOfficeManagerRequestEmail({
    personName: "Fran Founder",
    officeName: "Harbour Realty (made up)",
    wording: "I approve Fran Founder as office manager.",
    url: `${BASE}/office-manager/00000000-0000-4000-8000-000000000002`,
    expiresAt: "2 December 2026",
  }),
  "annexure adoption": buildAnnexureRequestEmail({
    licenseeName: "Lee Licensee",
    box: {
      kind: "sign",
      agencyName: "Harbour Realty (made up)",
      licenceNumber: "1234567",
      date: "2 November 2026",
      url: `${BASE}/annexure/00000000-0000-4000-8000-000000000003`,
    },
    base: BASE,
  }),
};

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

describe("approval and signing emails office email security has no reason to hold", () => {
  for (const [name, email] of Object.entries(approvals)) {
    it(`${name}: a plain-text part with the link, no hidden text, no remote images`, () => {
      assert.ok(email.text.length > 0);
      assert.ok(email.text.includes(`${BASE}/`), "the link is in the plain text too");
      assert.ok(!/display\s*:\s*none/i.test(email.html), "no hidden text");
      assert.ok(!/&zwnj;|&#847;/.test(email.html), "no invisible padding");
      assert.ok(!/<img\b/i.test(email.html), "no images to fetch");
    });

    it(`${name}: every link is on www.realcomply.com.au, or an email address`, () => {
      const links = hrefs(email.html);
      assert.ok(links.length > 0);
      for (const href of links) {
        assert.ok(href.startsWith(`${BASE}/`) || href === BASE || href.startsWith("mailto:"), href);
      }
    });
  }

  it("the invitation and welcome shell: the logo picture and the hidden preview line are gone", () => {
    const invite = buildInvitationEmail({ firstName: "Sam", inviteUrl: `${BASE}/signup?invite=x`, unsubscribeUrl: null, base: BASE });
    assert.ok(!invite.html.includes("email-logo.png"));
    assert.ok(!/display\s*:\s*none/i.test(invite.html));
  });
});

describe("every email has a reply-to", () => {
  it("admin@realcomply.com.au when the email doesn't name one", () => {
    assert.equal(DEFAULT_REPLY_TO, "admin@realcomply.com.au");
    assert.equal(withReplyTo({ to: "a@example.invalid", subject: "s", text: "t" }).replyTo, DEFAULT_REPLY_TO);
    assert.equal(withReplyTo({ to: "a@example.invalid", subject: "s", text: "t", replyTo: "  " }).replyTo, DEFAULT_REPLY_TO);
  });

  it("an email sent on someone's behalf keeps their address", () => {
    assert.equal(
      withReplyTo({ to: "a@example.invalid", subject: "s", text: "t", replyTo: "getadamc3+agent@gmail.com" }).replyTo,
      "getadamc3+agent@gmail.com",
    );
  });
});
