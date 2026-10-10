import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { linkRequestNeedingTime, listingSignature } from "./listing-signature";

describe("listingSignature", () => {
  it("reads a signature given in the app", () => {
    assert.deepEqual(listingSignature({ typedName: "Ann Agent", signedAt: "2026-10-01T01:00:00Z" }), {
      typedName: "Ann Agent",
      signedAt: "2026-10-01T01:00:00Z",
    });
  });
  it("reads a licensee signature given through the emailed link", () => {
    const data = { signedName: "Lee Licensee", signedVia: "link", signoffRequestId: "r1" };
    assert.deepEqual(listingSignature(data, "2026-10-02T03:00:00Z"), {
      typedName: "Lee Licensee",
      signedAt: "2026-10-02T03:00:00Z",
    });
    assert.deepEqual(listingSignature(data), { typedName: "Lee Licensee", signedAt: null });
  });
  it("is null when nobody has signed", () => {
    assert.equal(listingSignature(undefined), null);
    assert.equal(listingSignature({ note: "" }), null);
    assert.equal(listingSignature({ typedName: "  " }), null);
  });
});

describe("linkRequestNeedingTime", () => {
  it("names the request only for a link signature with no time of its own", () => {
    assert.equal(linkRequestNeedingTime({ signedName: "Lee", signoffRequestId: "r1" }), "r1");
    assert.equal(linkRequestNeedingTime({ signedName: "Lee", signoffRequestId: "r1", signedAt: "2026-10-02" }), null);
    assert.equal(linkRequestNeedingTime({ typedName: "Ann", signedAt: "2026-10-01" }), null);
    assert.equal(linkRequestNeedingTime(undefined), null);
  });
});
