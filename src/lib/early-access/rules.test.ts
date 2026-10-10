import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { earlyAccessStatus, hiddenFromList, isTestAddress, maySendTo, sameInstant, welcomeSwitchedOn } from "./rules";

const blank = { invitedAt: null, unsubscribedAt: null, declinedAt: null, signedUpAt: null };

describe("earlyAccessStatus", () => {
  it("puts each row in one tab", () => {
    assert.equal(earlyAccessStatus(blank), "not_invited");
    assert.equal(earlyAccessStatus({ ...blank, invitedAt: "2026-10-09T01:00:00Z" }), "invited");
    assert.equal(earlyAccessStatus({ ...blank, unsubscribedAt: "2026-10-09T01:00:00Z" }), "unsubscribed");
    assert.equal(earlyAccessStatus({ ...blank, declinedAt: "2026-10-09T01:00:00Z" }), "unsubscribed");
  });

  it("signed up wins, even over an invite and a later unsubscribe", () => {
    assert.equal(
      earlyAccessStatus({ invitedAt: "x", unsubscribedAt: "y", declinedAt: null, signedUpAt: "z" }),
      "signed_up",
    );
  });

  it("an invited row that then unsubscribes can't be emailed", () => {
    assert.equal(earlyAccessStatus({ ...blank, invitedAt: "x", unsubscribedAt: "y" }), "unsubscribed");
  });
});

describe("hiddenFromList", () => {
  it("leaves off Adam's own test domains, whatever the case", () => {
    assert.equal(hiddenFromList("admin+t1@realcomply.com.au"), true);
    assert.equal(hiddenFromList("Sue@CassProperty.com.au"), true);
    assert.equal(hiddenFromList("getadamc3+test1@gmail.com"), false);
    assert.equal(hiddenFromList("someone@notrealcomply.com.au"), false);
  });
});

describe("who an invitation may go to", () => {
  it("only Adam's plus-addresses while locked", () => {
    assert.equal(isTestAddress("getadamc3+test1@gmail.com"), true);
    assert.equal(isTestAddress("getadamc3@gmail.com"), false);
    assert.equal(isTestAddress("someone+getadamc3+x@gmail.com"), false);
    assert.equal(maySendTo("sam@harbourre.com.au", {}), false);
    assert.equal(maySendTo("getadamc3+test1@gmail.com", {}), true);
  });

  it("opens only on the live site with the switch set", () => {
    assert.equal(maySendTo("sam@harbourre.com.au", { EARLY_ACCESS_INVITES: "live", VERCEL_ENV: "production" }), true);
    assert.equal(maySendTo("sam@harbourre.com.au", { EARLY_ACCESS_INVITES: "live", VERCEL_ENV: "preview" }), false);
    assert.equal(maySendTo("sam@harbourre.com.au", { EARLY_ACCESS_INVITES: "on", VERCEL_ENV: "production" }), false);
  });
});

describe("welcomeSwitchedOn", () => {
  it("is off unless set to exactly on", () => {
    assert.equal(welcomeSwitchedOn({}), false);
    assert.equal(welcomeSwitchedOn({ EARLY_ACCESS_WELCOME_EMAIL: "true" }), false);
    assert.equal(welcomeSwitchedOn({ EARLY_ACCESS_WELCOME_EMAIL: "on" }), true);
  });
});

describe("sameInstant", () => {
  it("matches the page's time against Postgres's spelling of the same time", () => {
    assert.equal(sameInstant("2026-10-11T01:02:03.456+00:00", "2026-10-11T01:02:03.456Z"), true);
    assert.equal(sameInstant("2026-10-11T01:02:03.456+00:00", "2026-10-11T01:02:04.000Z"), false);
  });

  it("never sent on both sides matches; one side only does not", () => {
    assert.equal(sameInstant(null, ""), true);
    assert.equal(sameInstant("2026-10-11T01:02:03Z", ""), false);
    assert.equal(sameInstant(null, "2026-10-11T01:02:03Z"), false);
  });
});
