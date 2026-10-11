import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { linksFor, liveLink, signedLink, type SignoffLink } from "./signoff-links";

// The two kinds of link on one listing (0065): the final sign-off and the
// price statement. Neither may ever be read as the other.

const now = new Date("2026-10-12T00:00:00Z");
const link = (over: Partial<SignoffLink>): SignoffLink => ({
  id: "x",
  itemKey: "sign_licensee",
  sentTo: "lee@example.com",
  createdAt: "2026-10-01T00:00:00Z",
  expiresAt: "2026-10-31T00:00:00Z",
  signedAt: null,
  signedName: null,
  emailSentAt: "2026-10-01T00:00:01Z",
  emailAttempts: 1,
  emailError: null,
  priceStatement: null,
  espLow: null,
  espHigh: null,
  ...over,
});

describe("liveLink and signedLink, by kind", () => {
  it("never takes a signed price statement request for the final signature", () => {
    const links = [
      link({ id: "b4", itemKey: "b4", signedAt: "2026-10-05T00:00:00Z", signedName: "Lee", priceStatement: "Guide $1m" }),
    ];
    assert.equal(signedLink(links, "sign_licensee"), null);
    assert.equal(signedLink(links, "b4")?.id, "b4");
  });

  it("does not let a live price statement request hide, or stand in for, the final link", () => {
    const links = [
      link({ id: "b4", itemKey: "b4", createdAt: "2026-10-10T00:00:00Z", priceStatement: "Guide $1m" }),
      link({ id: "final", itemKey: "sign_licensee" }),
    ];
    assert.equal(liveLink(links, "sign_licensee", now)?.id, "final");
    assert.equal(liveLink(links, "b4", now)?.id, "b4");
    assert.equal(liveLink([links[0]], "sign_licensee", now), null);
  });

  it("is not live once signed or expired", () => {
    assert.equal(liveLink([link({ signedAt: "2026-10-05T00:00:00Z" })], "sign_licensee", now), null);
    assert.equal(liveLink([link({ expiresAt: "2026-10-11T00:00:00Z" })], "sign_licensee", now), null);
  });

  it("keeps each kind's own order", () => {
    const links = [link({ id: "b2", itemKey: "b4" }), link({ id: "f1" }), link({ id: "b1", itemKey: "b4" })];
    assert.deepEqual(linksFor(links, "b4").map((l) => l.id), ["b2", "b1"]);
    assert.deepEqual(linksFor(links, "sign_licensee").map((l) => l.id), ["f1"]);
  });
});
