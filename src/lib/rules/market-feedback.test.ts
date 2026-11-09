import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FEEDBACK_INCOMPLETE,
  FEEDBACK_NONE,
  FEEDBACK_CONFIRM_MISSING,
  FEEDBACK_WHERE_MISSING,
  feedbackFrom,
  feedbackRecordLine,
  feedbackRecordLines,
  feedbackRecordOf,
  feedbackToStore,
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
    assert.deepEqual(marketFeedbackFrom(JSON.stringify([full]), false), { entries: [], record: { file: null, where: null, confirmed: false } });
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

describe("market feedback attached or kept in the CRM (Adam, 9 Nov 2026)", () => {
  const file = { path: "o/p/d3/1-feedback.pdf", name: "Buyer emails (made up).pdf" };

  it("a file or where it's kept is enough on its own; typed entries can come with them", () => {
    const fileOnly = marketFeedbackFrom("[]", true, { file, elsewhere: false, where: null });
    assert.deepEqual(fileOnly, { entries: [], record: { file, where: null, confirmed: false } });
    const crmOnly = marketFeedbackFrom(JSON.stringify([{ who: "" }]), true, { file: null, elsewhere: true, where: " Rex ", confirmed: true });
    assert.deepEqual(crmOnly, { entries: [], record: { file: null, where: "Rex", confirmed: true } });
    const all = marketFeedbackFrom(JSON.stringify([full]), true, { file, elsewhere: true, where: "Rex", confirmed: true });
    assert.ok("entries" in all && all.entries.length === 1 && all.record.file && all.record.where === "Rex");
  });

  it("ticked 'somewhere else' needs where; a half-typed entry is still refused", () => {
    assert.deepEqual(marketFeedbackFrom("[]", true, { file: null, elsewhere: true, where: "  " }), { error: FEEDBACK_WHERE_MISSING });
    // The tick is required with it (Adam, 9 Nov 2026).
    assert.deepEqual(marketFeedbackFrom("[]", true, { file: null, elsewhere: true, where: "Rex" }), { error: FEEDBACK_CONFIRM_MISSING });
    assert.deepEqual(marketFeedbackFrom("[]", true, { file: null, elsewhere: true, where: "Rex", confirmed: false }), { error: FEEDBACK_CONFIRM_MISSING });
    assert.deepEqual(
      marketFeedbackFrom(JSON.stringify([{ ...full, why: "" }]), true, { file, elsewhere: false, where: null }),
      { error: FEEDBACK_INCOMPLETE },
    );
  });

  it("is kept in the one list and read back from it", () => {
    const stored = feedbackToStore({ entries: [{ ...full, who: "Sam Buyer (made up)", contact: null }], record: { file, where: "Rex", confirmed: true } });
    assert.equal(stored.length, 3);
    assert.equal(marketFeedbackOf(stored).length, 1, "the file and the pointer aren't typed feedback");
    assert.deepEqual(feedbackRecordOf(stored), { file, where: "Rex", confirmed: true });
    assert.deepEqual(feedbackRecordOf([]), { file: null, where: null, confirmed: false });
    assert.deepEqual(feedbackRecordOf([{ kind: "elsewhere", where: "Rex" }]), { file: null, where: "Rex", confirmed: false }, "saved before the tick");
    assert.deepEqual(feedbackRecordLines(2, { file, where: "Rex", confirmed: true }, "Ana Agent (made up)"), [
      "Revision 2, market feedback record attached: Buyer emails (made up).pdf.",
      "Revision 2, market feedback recorded in: Rex.",
      'Revision 2, ticked by Ana Agent (made up): "The feedback, who gave it, when, why it was relevant and how I used it are recorded there."',
    ]);
  });
});
