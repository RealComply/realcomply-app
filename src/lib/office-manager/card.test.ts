import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { officeManagerCard, type OfficeManagerCardInput } from "./card";

const now = new Date("2026-10-27T00:00:00Z");
const base: OfficeManagerCardInput = {
  isAgentPlan: false,
  isLicensee: false,
  isAccountHolder: true,
  officeHasLicenseeLogin: false,
  licenseeName: "Jordan Blake",
  licenseeEmail: "jordan@example.invalid",
  records: [],
  openRequest: null,
  now,
};

describe("the office manager card on Home", () => {
  it("asks the account holder to ask their licensee, when the licensee has no login", () => {
    assert.deepEqual(officeManagerCard(base), {
      kind: "ask",
      licenseeName: "Jordan Blake",
      licenseeEmail: "jordan@example.invalid",
    });
  });

  it("shows nothing on an agent plan, to a licensee, or to someone who isn't the account holder", () => {
    assert.equal(officeManagerCard({ ...base, isAgentPlan: true }), null);
    assert.equal(officeManagerCard({ ...base, isLicensee: true }), null);
    assert.equal(officeManagerCard({ ...base, isAccountHolder: false }), null);
  });

  it("doesn't ask by email when the licensee is on RealComply (they use Team)", () => {
    assert.equal(officeManagerCard({ ...base, officeHasLicenseeLogin: true }), null);
  });

  it("asks even with no licensee email, so the card can say what to do", () => {
    assert.deepEqual(officeManagerCard({ ...base, licenseeEmail: "  " }), {
      kind: "ask",
      licenseeName: "Jordan Blake",
      licenseeEmail: null,
    });
  });

  it("waits while a request is open, and says when the email didn't go", () => {
    const openRequest = {
      id: "r1",
      sent_to: "jordan@example.invalid",
      email_sent_at: "2026-10-26T22:41:00Z",
      email_attempts: 1,
      expires_at: "2026-11-25T22:41:00Z",
    };
    assert.deepEqual(officeManagerCard({ ...base, openRequest }), {
      kind: "waiting",
      licenseeName: "Jordan Blake",
      sentTo: "jordan@example.invalid",
      sentAt: "2026-10-26T22:41:00Z",
      emailFailed: false,
    });
    const failed = officeManagerCard({ ...base, openRequest: { ...openRequest, email_sent_at: null } });
    assert.equal(failed?.kind === "waiting" && failed.emailFailed, true);
  });

  it("asks again once a request is out of date", () => {
    const openRequest = {
      id: "r1",
      sent_to: "jordan@example.invalid",
      email_sent_at: "2026-09-01T00:00:00Z",
      email_attempts: 1,
      expires_at: "2026-10-01T00:00:00Z",
    };
    assert.equal(officeManagerCard({ ...base, openRequest })?.kind, "ask");
  });

  it("says approved for two weeks, then nothing", () => {
    const record = {
      approved_at: "2026-10-26T22:14:00Z",
      approved_by_name: "Jordan Blake",
      approved_via: "email_link" as const,
      withdrawn_at: null,
      withdrawn_via: null,
    };
    assert.deepEqual(officeManagerCard({ ...base, records: [record] }), {
      kind: "approved",
      licenseeName: "Jordan Blake",
      approvedByName: "Jordan Blake",
      approvedAt: "2026-10-26T22:14:00Z",
      viaLink: true,
    });
    assert.equal(officeManagerCard({ ...base, records: [record], now: new Date("2026-11-20T00:00:00Z") }), null);
  });

  it("says withdrawn for two weeks, and offers to ask again only where asking by email works", () => {
    const record = {
      approved_at: "2026-10-01T00:00:00Z",
      approved_by_name: "Jordan Blake",
      approved_via: "email_link" as const,
      withdrawn_at: "2026-10-26T05:40:00Z",
      withdrawn_via: "email_link" as const,
    };
    const card = officeManagerCard({ ...base, records: [record] });
    assert.equal(card?.kind, "withdrawn");
    assert.equal(card?.kind === "withdrawn" && card.mayAskAgain, true);
    const withLogin = officeManagerCard({ ...base, records: [record], officeHasLicenseeLogin: true });
    assert.equal(withLogin?.kind === "withdrawn" && withLogin.mayAskAgain, false);
    assert.equal(officeManagerCard({ ...base, records: [record], now: new Date("2026-11-20T00:00:00Z") })?.kind, "ask");
  });

  it("says nothing about a role that ended because the person left the office", () => {
    const record = {
      approved_at: "2026-10-01T00:00:00Z",
      approved_by_name: "Jordan Blake",
      approved_via: "team" as const,
      withdrawn_at: "2026-10-26T05:40:00Z",
      withdrawn_via: "left_office" as const,
    };
    assert.equal(officeManagerCard({ ...base, records: [record], officeHasLicenseeLogin: true }), null);
  });
});
