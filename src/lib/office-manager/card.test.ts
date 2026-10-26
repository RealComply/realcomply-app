import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  licenseeOfficeManagerHome,
  officeManagerCard,
  officeManagerHome,
  type OfficeManagerCardInput,
  type OfficeManagerOfOffice,
} from "./card";

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
      id: "11111111-1111-4111-8111-111111111111",
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
      noticeKey: "om-approved:11111111-1111-4111-8111-111111111111",
    });
    assert.equal(officeManagerCard({ ...base, records: [record], now: new Date("2026-11-20T00:00:00Z") }), null);
  });

  it("says withdrawn for two weeks, and offers to ask again only where asking by email works", () => {
    const record = {
      id: "22222222-2222-4222-8222-222222222222",
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
    // Named from the record, even where the office's licensee name is blank.
    const named = officeManagerCard({
      ...base,
      licenseeName: null,
      officeHasLicenseeLogin: true,
      records: [{ ...record, withdrawn_via: "team" as const, withdrawn_by_name: "Sam Licensee" }],
    });
    assert.equal(named?.kind === "withdrawn" && named.withdrawnByName, "Sam Licensee");
    const unnamed = officeManagerCard({ ...base, licenseeName: null, records: [record] });
    assert.equal(unnamed?.kind === "withdrawn" && unnamed.withdrawnByName, "Your licensee in charge");
    assert.equal(officeManagerCard({ ...base, records: [record], now: new Date("2026-11-20T00:00:00Z") })?.kind, "ask");
  });

  it("says nothing about a role that ended because the person left the office", () => {
    const record = {
      id: "33333333-3333-4333-8333-333333333333",
      approved_at: "2026-10-01T00:00:00Z",
      approved_by_name: "Jordan Blake",
      approved_via: "team" as const,
      withdrawn_at: "2026-10-26T05:40:00Z",
      withdrawn_via: "left_office" as const,
    };
    assert.equal(officeManagerCard({ ...base, records: [record], officeHasLicenseeLogin: true }), null);
  });
});

describe("the office manager card, seen once (0096)", () => {
  const approved = {
    id: "44444444-4444-4444-8444-444444444444",
    approved_at: "2026-10-26T22:14:00Z",
    approved_by_name: "Vic Licensee",
    approved_via: "email_link" as const,
    withdrawn_at: null,
    withdrawn_via: null,
  };
  const approvedKey = "om-approved:44444444-4444-4444-8444-444444444444";
  const input = { ...base, records: [approved], personName: "Igor Manager" };

  it("shows the card the first time, with no line", () => {
    const home = officeManagerHome(input);
    assert.equal(home.card?.kind, "approved");
    assert.equal(home.card?.kind === "approved" && home.card.noticeKey, approvedKey);
    assert.equal(home.line, null);
  });

  it("once seen (Got it, or a second visit), shows the small line instead", () => {
    const home = officeManagerHome({ ...input, seenKeys: new Set([approvedKey]) });
    assert.equal(home.card, null);
    assert.deepEqual(home.line, {
      personName: "Igor Manager",
      approvedByName: "Vic Licensee",
      approvedAt: "2026-10-26T22:14:00Z",
    });
  });

  it("keeps the line after the two weeks, for as long as they are office manager", () => {
    const home = officeManagerHome({ ...input, now: new Date("2027-03-01T00:00:00Z") });
    assert.equal(home.card, null);
    assert.equal(home.line?.personName, "Igor Manager");
  });

  it("treats every card as unseen when the seen record can't be read", () => {
    assert.equal(officeManagerHome({ ...input, seenKeys: null }).card?.kind, "approved");
  });

  it("shows a withdrawal once, then nothing for the rest of the two weeks, then asks as before", () => {
    const withdrawn = {
      ...approved,
      withdrawn_at: "2026-10-26T23:00:00Z",
      withdrawn_via: "email_link" as const,
      withdrawn_by_name: "Vic Licensee",
    };
    const key = "om-withdrawn:44444444-4444-4444-8444-444444444444";
    const first = officeManagerHome({ ...input, records: [withdrawn] });
    assert.equal(first.card?.kind === "withdrawn" && first.card.noticeKey, key);
    assert.equal(first.line, null);
    const after = officeManagerHome({ ...input, records: [withdrawn], seenKeys: new Set([key]) });
    assert.deepEqual(after, { card: null, line: null });
    const later = officeManagerHome({
      ...input,
      records: [withdrawn],
      seenKeys: new Set([key]),
      now: new Date("2026-11-20T00:00:00Z"),
    });
    assert.equal(later.card?.kind, "ask");
  });

  it("leaves Ask and Waiting as full cards on every visit", () => {
    const seenAll = new Set([approvedKey]);
    assert.equal(officeManagerHome({ ...base, seenKeys: seenAll }).card?.kind, "ask");
    const openRequest = {
      id: "r1",
      sent_to: "jordan@example.invalid",
      email_sent_at: "2026-10-26T22:41:00Z",
      email_attempts: 1,
      expires_at: "2026-11-25T22:41:00Z",
    };
    assert.equal(officeManagerHome({ ...base, openRequest, seenKeys: seenAll }).card?.kind, "waiting");
  });

  it("gives no line on an agent plan or to a licensee", () => {
    assert.deepEqual(officeManagerHome({ ...input, isAgentPlan: true }), { card: null, line: null });
    assert.deepEqual(officeManagerHome({ ...input, isLicensee: true }), { card: null, line: null });
  });
});

describe("the licensee in charge's Home, when someone is made office manager (0096)", () => {
  const viewerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const record: OfficeManagerOfOffice = {
    id: "55555555-5555-4555-8555-555555555555",
    profile_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    person_name: "Igor Manager",
    approved_at: "2026-10-26T22:14:00Z",
    approved_by: viewerId,
    approved_by_name: "Vic Licensee",
    approved_via: "team",
    withdrawn_at: null,
    withdrawn_via: null,
  };
  const key = "om-approved:55555555-5555-4555-8555-555555555555";
  const input = { isOfficeLicensee: true, viewerId, records: [record], now };

  it("shows a card once per approval", () => {
    assert.deepEqual(licenseeOfficeManagerHome(input), {
      cards: [
        {
          noticeKey: key,
          personName: "Igor Manager",
          approvedByName: "Vic Licensee",
          approvedByViewer: true,
          approvedAt: "2026-10-26T22:14:00Z",
          viaLink: false,
        },
      ],
      lines: [],
    });
  });

  it("then a small line per current office manager, 'by you' where the licensee approved it", () => {
    const withdrawn = {
      ...record,
      id: "66666666-6666-4666-8666-666666666666",
      person_name: "Old Manager",
      withdrawn_at: "2026-10-20T00:00:00Z",
      withdrawn_via: "team" as const,
    };
    const byLink = {
      ...record,
      id: "77777777-7777-4777-8777-777777777777",
      person_name: "Ana Manager",
      approved_by: null,
      approved_via: "email_link" as const,
      approved_at: "2026-09-01T00:00:00Z",
    };
    const home = licenseeOfficeManagerHome({
      ...input,
      records: [record, withdrawn, byLink],
      seenKeys: new Set([key]),
    });
    assert.deepEqual(home.cards, []);
    assert.deepEqual(home.lines, [
      { personName: "Igor Manager", approvedByName: "you", approvedAt: "2026-10-26T22:14:00Z" },
      { personName: "Ana Manager", approvedByName: "Vic Licensee", approvedAt: "2026-09-01T00:00:00Z" },
    ]);
  });

  it("shows nothing to anyone but the office's licensee in charge", () => {
    assert.deepEqual(licenseeOfficeManagerHome({ ...input, isOfficeLicensee: false }), { cards: [], lines: [] });
  });
});
