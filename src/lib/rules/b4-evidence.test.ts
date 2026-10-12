import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { itemsForStage } from "./nsw-sales";
import type { Property, PropertyItem } from "@/lib/types";

// b4 has no upload box (Adam, 12 Oct 2026), but a file already on the card
// keeps its control, and the predicate never reaches the page as a function.
const property = { id: "p", agency_id: "a", address: "1 Test St", test_mode: false } as unknown as Property;
const b4 = (items: Record<string, PropertyItem>) => itemsForStage(1, property, items).find((i) => i.key === "b4");

describe("b4 upload box", () => {
  it("is hidden on a card with no file", () => {
    const item = b4({});
    assert.ok(item);
    assert.equal(item.hideEvidence, true);
    assert.equal("hideEvidenceWhen" in item, false);
  });

  it("stays for a file already attached, so it can be seen and removed", () => {
    const withFile = { item_key: "b4", status: "open", evidence_path: "a/p/b4/1-ad.pdf" } as unknown as PropertyItem;
    assert.equal(b4({ b4: withFile })?.hideEvidence, false);
  });
});
