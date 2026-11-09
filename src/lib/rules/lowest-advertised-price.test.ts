import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  belowLowestPrice,
  elsewhereAnswerProblem,
  highestPriceOnlyRejection,
  lowestAdvertisedPrice,
  lowestPriceLine,
  offerProblem,
  offerSummary,
  raisesLowestPrice,
  registeredPassInBid,
  vendorMustBeTold,
  type OfferRecord,
} from "./lowest-advertised-price";

const BEFORE = new Date("2026-11-16T12:00:00+11:00");
const AFTER = new Date("2026-11-17T09:00:00+11:00");

const offer = (o: Partial<OfferRecord>): OfferRecord => ({
  amount: 1_250_000,
  outcome: "rejected",
  vendorInformed: true,
  belowFloor: false,
  ...o,
});

describe("raisesLowestPrice", () => {
  it("only a written offer rejected on price only", () => {
    assert.equal(raisesLowestPrice(offer({ inWriting: true, rejectedFor: "price" })), true);
    assert.equal(raisesLowestPrice(offer({ inWriting: true, rejectedFor: "terms" })), false);
    assert.equal(raisesLowestPrice(offer({ inWriting: false, rejectedFor: "price" })), false);
    assert.equal(raisesLowestPrice(offer({ outcome: "pending", inWriting: true, rejectedFor: "price" })), false);
  });
});

describe("highestPriceOnlyRejection", () => {
  it("takes the highest from the log and the answer for offers kept elsewhere", () => {
    const entries = [
      offer({ amount: 1_250_000, inWriting: true, rejectedFor: "price", rejectedOn: "2026-11-19" }),
      offer({ amount: 1_300_000, inWriting: true, rejectedFor: "terms", rejectedOn: "2026-11-20" }),
      offer({ amount: 1_400_000, inWriting: false }),
    ];
    assert.deepEqual(highestPriceOnlyRejection(entries), { amount: 1_250_000, rejectedOn: "2026-11-19" });
    assert.deepEqual(
      highestPriceOnlyRejection(entries, {
        rejected: "yes",
        inWriting: true,
        rejectedFor: "price",
        amount: 1_270_000,
        rejectedOn: "2026-11-21",
      }),
      { amount: 1_270_000, rejectedOn: "2026-11-21" },
    );
  });
  it("ignores a No, a verbal offer and a terms rejection given elsewhere", () => {
    assert.equal(highestPriceOnlyRejection([], { rejected: "no" }), null);
    assert.equal(highestPriceOnlyRejection([], { rejected: "yes", inWriting: false, rejectedFor: "price", amount: 1 }), null);
    assert.equal(
      highestPriceOnlyRejection([], { rejected: "yes", inWriting: true, rejectedFor: "terms", amount: 1_300_000 }),
      null,
    );
  });
});

describe("registeredPassInBid", () => {
  it("a registered bidder's highest bid at a pass-in, not a vendor bid", () => {
    assert.equal(registeredPassInBid({ outcome: "passed_in", highestBid: 1_150_000, vendorBid: false }), 1_150_000);
    assert.equal(registeredPassInBid({ outcome: "passed_in", highestBid: 1_150_000, vendorBid: true }), null);
    assert.equal(registeredPassInBid({ outcome: "passed_in", highestBid: null }), null);
    assert.equal(registeredPassInBid({ outcome: "sold", highestBid: 1_150_000 }), null);
    assert.equal(registeredPassInBid(null), null);
  });
});

describe("lowestAdvertisedPrice", () => {
  const offerFloor = { amount: 1_250_000, rejectedOn: "2026-11-19" };

  it("before 17 November 2026 it is the ESP only", () => {
    const r = lowestAdvertisedPrice({ espLow: 1_200_000, passInBid: 1_300_000, rejectedOffer: offerFloor, now: BEFORE });
    assert.equal(r.floor, 1_200_000);
    assert.equal(r.source, "esp");
  });

  it("from 17 November it is the highest of the three, and says what it's made of", () => {
    const r = lowestAdvertisedPrice({ espLow: 1_200_000, passInBid: null, rejectedOffer: offerFloor, now: AFTER });
    assert.equal(r.floor, 1_250_000);
    assert.equal(r.source, "offer");
    assert.equal(
      r.why,
      "The higher of your ESP ($1,200,000) and the written offer the vendor rejected on price only ($1,250,000, rejected 19 November 2026).",
    );
    assert.equal(lowestPriceLine(r.floor as number), "Your advertised price can't start below $1,250,000.");

    const three = lowestAdvertisedPrice({ espLow: 1_200_000, passInBid: 1_300_000, rejectedOffer: offerFloor, now: AFTER });
    assert.equal(three.floor, 1_300_000);
    assert.equal(three.source, "pass_in");
    assert.match(three.why, /^The highest of your ESP \(\$1,200,000\), the registered bidder's/);
  });

  it("names the ESP on a tie, and is empty with nothing to go on", () => {
    const tie = lowestAdvertisedPrice({ espLow: 1_250_000, passInBid: null, rejectedOffer: offerFloor, now: AFTER });
    assert.equal(tie.source, "esp");
    assert.deepEqual(lowestAdvertisedPrice({ espLow: null, passInBid: null, rejectedOffer: null, now: AFTER }), {
      floor: null,
      source: null,
      why: "",
    });
  });

  it("uses the name it's given for a revised ESP", () => {
    const r = lowestAdvertisedPrice({ espLow: 1_100_000, espName: "revised ESP", passInBid: null, rejectedOffer: null, now: AFTER });
    assert.equal(r.why, "Your revised ESP ($1,100,000).");
  });

  it("the words have no dashes", () => {
    const r = lowestAdvertisedPrice({ espLow: 1_200_000, passInBid: 1_300_000, rejectedOffer: offerFloor, now: AFTER });
    assert.ok(!/[—–]/.test(r.why));
  });
});

describe("belowLowestPrice", () => {
  const lowest = lowestAdvertisedPrice({
    espLow: 1_200_000,
    passInBid: null,
    rejectedOffer: { amount: 1_250_000, rejectedOn: null },
    now: AFTER,
  });
  it("says so when the advertised price starts below it", () => {
    assert.match(belowLowestPrice(1_200_000, lowest) ?? "", /^The advertised price starts at \$1,200,000, below \$1,250,000/);
    assert.equal(belowLowestPrice(1_250_000, lowest), null);
    assert.equal(belowLowestPrice(null, lowest), null);
  });
});

describe("vendorMustBeTold", () => {
  it("every offer, except one below the vendor's instruction that doesn't need the ESP revised", () => {
    assert.equal(vendorMustBeTold({ vendorInformed: false, belowFloor: false }), true);
    assert.equal(vendorMustBeTold({ vendorInformed: true, belowFloor: false }), false);
    assert.equal(vendorMustBeTold({ vendorInformed: false, belowFloor: true, needsEspRevision: false }), false);
    assert.equal(vendorMustBeTold({ vendorInformed: false, belowFloor: true, needsEspRevision: true }), true);
  });
});

describe("offerProblem", () => {
  it("a written rejected offer needs the reason and the date; below the instruction needs the ESP question", () => {
    assert.equal(offerProblem(offer({ amount: 0 })), "Enter the offer amount.");
    assert.equal(offerProblem(offer({ inWriting: true })), "Answer: Why did the vendor reject it?");
    assert.equal(offerProblem(offer({ inWriting: true, rejectedFor: "price" })), "Enter the date the vendor rejected it.");
    assert.equal(offerProblem(offer({ inWriting: true, rejectedFor: "price", rejectedOn: "2026-11-19" })), null);
    assert.equal(offerProblem(offer({ belowFloor: true })), "Answer: Does this offer mean the ESP needs revising?");
    assert.equal(offerProblem(offer({ belowFloor: true, needsEspRevision: false })), null);
    assert.equal(offerProblem(offer({ outcome: "pending", inWriting: true })), null);
  });
});

describe("elsewhereAnswerProblem", () => {
  it("a price-only rejection needs the amount and the date", () => {
    assert.equal(elsewhereAnswerProblem({ rejected: "no" }), null);
    assert.equal(elsewhereAnswerProblem({ rejected: "yes", inWriting: false }), null);
    assert.equal(elsewhereAnswerProblem({ rejected: "yes", inWriting: true }), "Answer: Why did the vendor reject it?");
    assert.equal(elsewhereAnswerProblem({ rejected: "yes", inWriting: true, rejectedFor: "terms" }), null);
    assert.equal(
      elsewhereAnswerProblem({ rejected: "yes", inWriting: true, rejectedFor: "price" }),
      "Enter the amount of the offer.",
    );
    assert.equal(
      elsewhereAnswerProblem({ rejected: "yes", inWriting: true, rejectedFor: "price", amount: 1_250_000 }),
      "Enter the date the vendor rejected it.",
    );
  });
});

describe("offerSummary", () => {
  it("one line, no dashes", () => {
    const line = offerSummary(
      offer({ inWriting: true, rejectedFor: "price", rejectedOn: "2026-11-19", conditions: "subject to finance" }),
    );
    assert.equal(
      line,
      "rejected · vendor informed · in writing, price only · conditions: subject to finance · rejected 19 November 2026",
    );
    assert.ok(!/[—–]/.test(line));
  });
});
