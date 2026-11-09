import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FEEDBACK_INCOMPLETE,
  FEEDBACK_NONE,
  feedbackFrom,
  feedbackRecordLine,
  marketFeedbackFrom,
  marketFeedbackOf,
} from "./market-feedback";

const full = {
  who: " Sam Buyer (made up) ",
  contact: "0400 000 000",
  on: "2026-11-24",
  what: "Said the kitchen needs work and the price is high for it.",
  why: "Three buyers at the open home said the same.",
  how: "Lowered the top of the range by $50,000.",
};

describe("market feedback on an ESP revision (Reg s12G(1)(f))", () => {
  it("keeps nothing when the tick is off, whatever was typed", () => {
    assert.deepEqual(marketFeedbackFrom(JSON.stringify([full]), false), { entries: [] });
  });

  it("needs the five details for each piece; phone or email is optional", () => {
    const ok = marketFeedbackFrom(JSON.stringify([full, { ...full, who: "Pat Neighbour (made up)", contact: "" }]), true);
    assert.ok("entries" in ok);
    if (!("entries" in ok)) return;
    assert.equal(ok.entries.length, 2);
    assert.equal(ok.entries[0].who, "Sam Buyer (made up)", "trimmed");
    assert.equal(ok.entries[1].contact, null);
    for (const missing of ["who", "on", "what", "why", "how"] as const) {
      assert.deepEqual(marketFeedbackFrom(JSON.stringify([{ ...full, [missing]: "" }]), true), { error: FEEDBACK_INCOMPLETE }, missing);
    }
    assert.deepEqual(marketFeedbackFrom(JSON.stringify([{ ...full, on: "24/11/2026" }]), true), { error: FEEDBACK_INCOMPLETE });
  });

  it("ticked with nothing in it asks for the feedback; an empty row is skipped", () => {
    assert.deepEqual(marketFeedbackFrom("[]", true), { error: FEEDBACK_NONE });
    assert.deepEqual(marketFeedbackFrom(JSON.stringify([{ who: "", what: "" }]), true), { error: FEEDBACK_NONE });
    const one = marketFeedbackFrom(JSON.stringify([full, { who: "", on: "", what: "", why: "", how: "", contact: "" }]), true);
    assert.ok("entries" in one && one.entries.length === 1);
    assert.deepEqual(marketFeedbackFrom("not json", true), { error: FEEDBACK_INCOMPLETE });
  });

  it("reads what a revision kept, and writes it for the record", () => {
    const [f] = marketFeedbackOf([{ ...full, who: "Sam Buyer (made up)" }, { who: "", on: "x" }, "nonsense"]);
    assert.equal(feedbackFrom(f), "Sam Buyer (made up) (0400 000 000), 24 November 2026");
    assert.equal(
      feedbackRecordLine(2, f),
      "Revision 2, market feedback from Sam Buyer (made up) (0400 000 000), 24 November 2026: Said the kitchen needs work and the price is high for it. Why used: Three buyers at the open home said the same. How used: Lowered the top of the range by $50,000.",
    );
    assert.deepEqual(marketFeedbackOf(null), []);
  });
});
