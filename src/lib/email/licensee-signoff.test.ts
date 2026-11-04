import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COMPANY_LINE,
  buildPackEmail,
  buildSendPackReminder,
  buildSignPackReminder,
} from "@/lib/email/licensee-signoff";

// The licensee's sign-off emails (Adam, 3 Nov 2026): subject "Your [Month]
// sign-off pack: [n] items", body "Hi [name], [office manager] has sent you
// [Month]'s sign-off pack for [office]: [n] sales files, [n] trust
// reconciliations and [n] office items. [n] items are flagged for a closer
// look.", button "Open the pack", footer RealComply Pty Ltd and ABN.
//
// The licensee signs the pack in the app, logged in, so the button opens the
// Licensee sign-off page. Adam's approved wording also had "The link works
// without logging in and is for you only.": that line belongs to the
// licensee's links, a separate change (Master, 4 Nov 2026), and is left out.

const URL = "https://www.realcomply.com.au/dashboard/licensee-signoff";

describe("the pack email", () => {
  const email = buildPackEmail({
    licenseeName: "Priya Nandakumar",
    senderName: "Mel",
    officeName: "Made Up Realty",
    month: "2026-10-01",
    counts: { sales: 36, pm: 0, trust: 2, office: 3 },
    total: 41,
    flagged: 2,
    trustAllReconciliations: true,
    url: URL,
  });

  it("says what Adam approved, word for word", () => {
    assert.equal(email.subject, "Your October sign-off pack: 41 items");
    const text = email.text.replace(/\s+/g, " ");
    assert.ok(text.includes("Hi Priya,"));
    assert.ok(
      text.includes(
        "Mel has sent you October's sign-off pack for Made Up Realty: 36 sales files, 2 trust reconciliations and 3 office items. 2 items are flagged for a closer look.",
      ),
    );
    assert.ok(text.includes("Open the pack"));
    assert.ok(text.includes(URL));
    assert.ok(text.includes(COMPANY_LINE));
    assert.ok(email.html.includes(URL));
  });

  it("never says the link works without logging in: the pack is signed in the app", () => {
    for (const e of [
      email,
      buildSignPackReminder({ licenseeName: "Priya", officeName: "Made Up Realty", month: "2026-10-01", n: 5, url: URL }),
    ]) {
      assert.ok(!e.text.includes("without logging in"), e.subject);
    }
  });

  it("calls an audit in the trust group a trust item", () => {
    const withAudit = buildPackEmail({
      licenseeName: "Priya",
      senderName: "Mel",
      officeName: "Made Up Realty",
      month: "2026-10-01",
      counts: { sales: 0, pm: 0, trust: 2, office: 0 },
      total: 2,
      flagged: 0,
      trustAllReconciliations: false,
      url: URL,
    });
    assert.ok(withAudit.text.includes("2 trust items."));
    assert.ok(!withAudit.text.includes("flagged"));
  });

  it("has no em dashes in any licensee email", () => {
    const all = [
      email,
      buildSendPackReminder({ name: "Mel Carter", officeName: "Made Up Realty", month: "2026-10-01", n: 5, url: URL }),
      buildSignPackReminder({ licenseeName: "Priya", officeName: "Made Up Realty", month: "2026-10-01", n: 5, url: URL }),
    ];
    for (const e of all) {
      assert.ok(!`${e.subject} ${e.text}`.includes("—"), e.subject);
      assert.ok(!/compliant/i.test(e.text), e.subject);
    }
  });
});

describe("the monthly reminders", () => {
  it("reminds the office manager on the 1st, and the licensee after 7 days", () => {
    const send = buildSendPackReminder({ name: "Mel Carter", officeName: "Made Up Realty", month: "2026-10-01", n: 1, url: URL });
    assert.equal(send.subject, "Time to send October's sign-off pack");
    assert.ok(send.text.includes("1 item is waiting for the licensee's signature."));
    const sign = buildSignPackReminder({ licenseeName: "Priya", officeName: "Made Up Realty", month: "2026-10-01", n: 5, url: URL });
    assert.equal(sign.subject, "Reminder: your October sign-off pack");
    assert.ok(sign.text.includes("still waiting for your signature: 5 items."));
  });
});
