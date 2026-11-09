import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ENTER_PRICE, TICK_MARKETING, advertisedPriceProblem, priceFromText } from "./advertised-price";

describe("priceFromText", () => {
  it("reads a range as written on an agreement", () => {
    assert.deepEqual(priceFromText("$1,200,000 - $1,300,000"), { low: 1_200_000, high: 1_300_000 });
    assert.deepEqual(priceFromText("$1,200,000 to $1,300,000"), { low: 1_200_000, high: 1_300_000 });
    assert.deepEqual(priceFromText("$1.2m – $1.3m"), { low: 1_200_000, high: 1_300_000 });
  });

  it("reads a single figure as a range of one", () => {
    assert.deepEqual(priceFromText("$950,000"), { low: 950_000, high: 950_000 });
    assert.deepEqual(priceFromText("950k"), { low: 950_000, high: 950_000 });
    assert.deepEqual(priceFromText("Offers above $900,000"), { low: 900_000, high: 900_000 });
  });

  it("ignores small numbers and empty text", () => {
    assert.equal(priceFromText("3 bedrooms, 2 car spaces"), null);
    assert.equal(priceFromText(""), null);
    assert.equal(priceFromText(null), null);
    assert.deepEqual(priceFromText("3 bed home, $1,100,000"), { low: 1_100_000, high: 1_100_000 });
  });
});

describe("advertisedPriceProblem", () => {
  const before = new Date("2026-11-12T10:00:00+11:00");
  const after = new Date("2026-11-18T10:00:00+11:00");

  it("from 17 November needs the price and the tick", () => {
    assert.equal(advertisedPriceProblem({ low: null, inAllMarketing: true, now: after }), ENTER_PRICE);
    assert.equal(advertisedPriceProblem({ low: 900_000, inAllMarketing: false, now: after }), TICK_MARKETING);
    assert.equal(advertisedPriceProblem({ low: 900_000, inAllMarketing: true, now: after }), null);
  });

  it("before 17 November a price is optional, and the marketing tick isn't asked (s72D starts then)", () => {
    assert.equal(advertisedPriceProblem({ low: null, inAllMarketing: false, now: before }), null);
    assert.equal(advertisedPriceProblem({ low: 900_000, inAllMarketing: false, now: before }), null);
  });
});
