import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { comparableFolded, foldsWhenMarked, weighingProgress, type Weighting } from "./comparables";

// Sale cards on the ESP reasoning card fold to one line once marked (Adam,
// 13 Oct 2026, approved mockup), with "N of N done" above the list.

const marked = (weighting: Weighting | null) => ({
  weighting,
  reopened: false,
  noteUnsaved: false,
  hasError: false,
});

describe("a sale's card folds once marked", () => {
  it("folds on Relied on and on Considered", () => {
    assert.equal(comparableFolded(marked("relied")), true);
    assert.equal(comparableFolded(marked("considered")), true);
  });

  it("stays open while unmarked", () => {
    assert.equal(comparableFolded(marked(null)), false);
  });

  it("leaves the retired 'not comparable' mark open, as it always showed", () => {
    assert.equal(foldsWhenMarked("not_comparable"), false);
    assert.equal(comparableFolded(marked("not_comparable")), false);
  });

  it("opens again on Change", () => {
    assert.equal(comparableFolded({ ...marked("relied"), reopened: true }), false);
  });

  it("stays open while a typed note is unsaved, so it is not hidden before it is kept", () => {
    assert.equal(comparableFolded({ ...marked("considered"), noteUnsaved: true }), false);
  });

  it("stays open while the last save failed, so the error is seen", () => {
    assert.equal(comparableFolded({ ...marked("relied"), hasError: true }), false);
  });
});

describe("the N of N done counter", () => {
  it("counts every marked sale against all of them", () => {
    assert.deepEqual(
      weighingProgress([{ weighting: "relied" }, { weighting: null }, { weighting: "considered" }, { weighting: null }]),
      { done: 2, total: 4 },
    );
  });

  it("counts a sale marked 'not comparable' before that option went as done", () => {
    assert.deepEqual(weighingProgress([{ weighting: "not_comparable" }, { weighting: "relied" }]), {
      done: 2,
      total: 2,
    });
  });

  it("is 0 of 0 with no sales", () => {
    assert.deepEqual(weighingProgress([]), { done: 0, total: 0 });
  });
});
