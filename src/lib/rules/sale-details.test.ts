import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { missingSaleDetails, missingSaleLine } from "@/lib/rules/sale-details";

// What each sale is still missing, under it on the ESP reasoning card (Master, 11 Nov 2026).

const full = { salePrice: 1200000, saleDate: "2026-10-01", bedrooms: 3, bathrooms: 2, carSpaces: 1, landSizeSqm: 600 };

describe("what a sale is still missing", () => {
  it("names each empty detail, in Edit details' order", () => {
    assert.deepEqual(missingSaleDetails({ ...full, bedrooms: null, landSizeSqm: null, saleDate: null }, false), [
      "bedrooms",
      "land size",
      "sale date",
    ]);
    assert.equal(missingSaleLine(["bedrooms", "land size", "sale date"]), "Still to add: bedrooms, land size and sale date.");
    assert.equal(missingSaleLine(["car spaces"]), "Still to add: car spaces.");
  });

  it("a 0 is filled in, not missing", () => {
    assert.deepEqual(missingSaleDetails({ ...full, bedrooms: 0, carSpaces: 0 }, false), []);
    assert.equal(missingSaleLine([]), null);
  });

  it("land size isn't asked for on a strata listing, or where a whole-site figure was hidden", () => {
    assert.deepEqual(missingSaleDetails({ ...full, landSizeSqm: null }, true), []);
    assert.deepEqual(missingSaleDetails({ ...full, landSizeSqm: null, landSizeHidden: true }, false), []);
  });
});
