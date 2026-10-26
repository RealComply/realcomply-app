import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { espFrom } from "@/lib/data/effective-esp";
import {
  SALE_PRICE_NOTE_PROMPT,
  checkSalePrice,
  espText,
  salePriceFlagText,
  saleRecordLines,
  savedSaleCheck,
} from "./sale-price";

// The listing it was found on (26 Oct 2026): ESP $1.40m to $1.45m in the
// agency agreement, revised on the revision card to $1.35m, sold $1.26m.
const a4 = { espLow: 1_400_000, espHigh: 1_450_000, spreadPct: 3.6 };
const d3 = { revisedEspLow: 1_350_000, revisedEspHigh: 1_350_000, noticeServedOn: "2026-08-20" };

describe("checkSalePrice: the latest ESP", () => {
  it("uses the revised ESP instead of the original", () => {
    const check = checkSalePrice(1_260_000, espFrom(a4, d3));
    assert.equal(check.espRevised, true);
    assert.equal(check.espLow, 1_350_000);
    assert.equal(check.espHigh, 1_350_000);
  });

  it("uses the original ESP when there is no revision", () => {
    const check = checkSalePrice(1_260_000, espFrom(a4, undefined));
    assert.equal(check.espRevised, false);
    assert.equal(check.espHigh, 1_450_000);
  });

  it("the sale it was found on: below the revised ESP, no flag", () => {
    assert.equal(checkSalePrice(1_260_000, espFrom(a4, d3)).aboveEsp, false);
  });

  it("15% above the revised ESP is flagged even though it is inside 10% of the original", () => {
    // $1,552,500 is 15% above $1.35m, and only 7% above the original $1.45m.
    assert.equal(checkSalePrice(1_552_500, espFrom(a4, d3)).aboveEsp, true);
    assert.equal(checkSalePrice(1_552_500, espFrom(a4, undefined)).aboveEsp, false);
  });
});

describe("checkSalePrice: flagged only when more than 10% above the top figure", () => {
  const esp = espFrom({ espLow: 900_000, espHigh: 990_000 }, undefined);

  it("below the ESP: no flag", () => {
    assert.equal(checkSalePrice(800_000, esp).aboveEsp, false);
  });
  it("inside the range: no flag", () => {
    assert.equal(checkSalePrice(950_000, esp).aboveEsp, false);
  });
  it("5% above the top: no flag", () => {
    assert.equal(checkSalePrice(1_039_500, esp).aboveEsp, false);
  });
  it("exactly 10% above the top: no flag", () => {
    assert.equal(checkSalePrice(1_089_000, esp).aboveEsp, false);
    // 1,350,000 * 1.1 is 1485000.0000000002 in floating point; still no flag.
    assert.equal(checkSalePrice(1_485_000, espFrom({ espLow: 1_350_000, espHigh: 1_350_000 }, undefined)).aboveEsp, false);
  });
  it("a dollar over 10% above the top: flagged", () => {
    assert.equal(checkSalePrice(1_089_001, esp).aboveEsp, true);
  });
  it("15% above the top: flagged", () => {
    assert.equal(checkSalePrice(1_138_500, esp).aboveEsp, true);
  });
  it("measured from the top figure, not the low one", () => {
    // 12% above the low $900,000 but under 10% above the top $990,000.
    assert.equal(checkSalePrice(1_008_000, esp).aboveEsp, false);
  });
  it("no ESP recorded: nothing to compare with, no flag", () => {
    assert.equal(checkSalePrice(5_000_000, espFrom(undefined, undefined)).aboveEsp, false);
  });
});

describe("the wording", () => {
  it("says it plainly, with the ESP the sale was compared with", () => {
    const check = checkSalePrice(1_552_500, espFrom(a4, d3));
    assert.equal(
      salePriceFlagText(check),
      "The sale price is more than 10% above the latest estimated selling price ($1,350,000).",
    );
    assert.equal(SALE_PRICE_NOTE_PROMPT, "You can add a note on how that came about.");
  });

  it("a range reads as the range", () => {
    assert.equal(espText({ espLow: 1_400_000, espHigh: 1_450_000 }), "$1,400,000 to $1,450,000");
    assert.equal(espText({ espLow: 1_350_000, espHigh: 1_350_000 }), "$1,350,000");
    assert.equal(espText({ espLow: null, espHigh: 990_000 }), "$990,000");
    assert.equal(espText({ espLow: null, espHigh: null }), null);
  });

  it("nothing to say when the sale isn't flagged", () => {
    assert.equal(salePriceFlagText(checkSalePrice(1_260_000, espFrom(a4, d3))), null);
  });

  it("no em dashes and no card codes in anything the agent reads", () => {
    const text = [
      salePriceFlagText(checkSalePrice(1_552_500, espFrom(a4, d3))),
      SALE_PRICE_NOTE_PROMPT,
      ...saleRecordLines({ price: 1_552_500, espLow: 1_350_000, espHigh: 1_350_000, espRevised: true, aboveEsp: true, note: "Two bidders." }),
    ].join(" ");
    assert.doesNotMatch(text, /—/);
    assert.doesNotMatch(text, /\b[a-z]\d\b/);
  });
});

describe("savedSaleCheck and the finalised file", () => {
  it("a card saved under the old rule shows no flag", () => {
    // What the 16 Greenmount Way card held before the re-check.
    const old = {
      price: 1_260_000,
      espLow: 1_400_000,
      espHigh: 1_450_000,
      outsideRange: true,
      flagReason: "Final price falls outside the recorded ESP range — point to the ESP revision log (d3) as evidence of reasonableness.",
    };
    assert.equal(savedSaleCheck(old).aboveEsp, false);
    assert.equal(salePriceFlagText(savedSaleCheck(old)), null);
  });

  it("not flagged: the price and what it was compared with", () => {
    assert.deepEqual(
      saleRecordLines({ price: 1_260_000, espLow: 1_350_000, espHigh: 1_350_000, espRevised: true, aboveEsp: false }),
      ["Final sale price: $1,260,000", "Compared with the revised estimated selling price: $1,350,000"],
    );
  });

  it("flagged with a note: the flag and the note", () => {
    assert.deepEqual(
      saleRecordLines({
        price: 1_138_500,
        espLow: 900_000,
        espHigh: 990_000,
        espRevised: false,
        aboveEsp: true,
        note: "  Three bidders at auction.  ",
      }),
      [
        "Final sale price: $1,138,500",
        "Compared with the estimated selling price: $900,000 to $990,000",
        "The sale price is more than 10% above the latest estimated selling price ($900,000 to $990,000).",
        "Agent's note: Three bidders at auction.",
      ],
    );
  });

  it("flagged without a note: the note is optional", () => {
    const lines = saleRecordLines({ price: 1_138_500, espLow: 900_000, espHigh: 990_000, espRevised: false, aboveEsp: true });
    assert.equal(lines.length, 3);
  });

  it("no price recorded: nothing", () => {
    assert.deepEqual(saleRecordLines(undefined), []);
    assert.deepEqual(saleRecordLines({}), []);
  });
});
