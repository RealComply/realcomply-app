import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allItemsInRuleset, getItem } from "./nsw-sales";

// The upload box on a card adds "(optional)" itself to any upload that isn't
// required (ItemCard.tsx). A card's own label saying it too read "Your own
// record (optional) (optional)" on Record of price quotes given (Master, 10
// Nov 2026: small fixes).

describe("upload labels on the cards", () => {
  it("never say (optional) themselves: the upload box adds it", () => {
    const doubled = allItemsInRuleset()
      .filter((i) => /optional/i.test(i.evidenceLabel ?? ""))
      .map((i) => `${i.key}: ${i.evidenceLabel}`);
    assert.deepEqual(doubled, []);
  });

  it("Record of price quotes given reads \"Your own record\"", () => {
    assert.equal(getItem("b5")?.evidenceLabel, "Your own record");
    assert.notEqual(getItem("b5")?.evidenceRequired, true, "still optional, so the box adds (optional) once");
  });
});
