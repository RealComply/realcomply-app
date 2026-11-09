import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REFORMS_FROM,
  advertisingFixLine,
  bannedPriceWording,
  reformsInForce,
  storedLegislationOutOfDate,
} from "./underquoting-reforms";

describe("the 17 November 2026 switch", () => {
  it("is midnight at the start of 17 November in Sydney", () => {
    assert.equal(REFORMS_FROM.toISOString(), "2026-11-16T13:00:00.000Z");
    assert.equal(reformsInForce(new Date("2026-11-16T12:59:59Z")), false);
    assert.equal(reformsInForce(new Date("2026-11-16T13:00:00Z")), true);
  });

  it("words the advertising fix for the law on the day", () => {
    assert.match(advertisingFixLine(new Date("2026-11-10T00:00:00Z")), /as soon as practicable\.$/);
    assert.doesNotMatch(advertisingFixLine(new Date("2026-11-10T00:00:00Z")), /business day/);
    assert.match(advertisingFixLine(new Date("2026-11-20T00:00:00Z")), /within 1 business day, other ads as soon as practicable/);
  });

  it("flags the stored Act as out of date only from 17 November", () => {
    assert.equal(storedLegislationOutOfDate(new Date("2026-11-10T00:00:00Z")), false);
    assert.equal(storedLegislationOutOfDate(new Date("2026-11-17T01:00:00+11:00")), true);
  });
});

describe("bannedPriceWording", () => {
  it("finds the phrases s73(2) bans", () => {
    assert.deepEqual(bannedPriceWording("Offers over $900,000"), ["offers over"]);
    assert.deepEqual(bannedPriceWording("O.N.O. $1.2m"), ["o.n.o"]);
  });

  it("finds a price-plus symbol in its usual forms", () => {
    for (const text of ["$900,000+", "Guide $900,000 +", "900,000+", "900k+", "$1.2m+", "1.2 m +"]) {
      assert.equal(bannedPriceWording(text).length, 1, text);
    }
  });

  it("leaves ordinary notes alone", () => {
    for (const text of ["3+ bedrooms", "2+ offers received", "$900,000 to $990,000", "Guide $1,250,000", ""]) {
      assert.deepEqual(bannedPriceWording(text), [], text);
    }
  });
});
