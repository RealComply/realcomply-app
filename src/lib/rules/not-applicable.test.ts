import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyNa, naCarriedThroughSave, naRecordLines, naRefusal, readNa, withNa } from "./not-applicable";
import { getItem, itemsForStage } from "./nsw-sales";
import type { Property, PropertyItem } from "@/lib/types";

// "Not applicable" on the property reports disclosure card, f4 (Adam, 17 Oct 2026).

const jo = { id: "jo", name: "Jo Agent (made up)" };
const sam = { id: "sam", name: "Sam Licensee (made up)" };
const T1 = "2026-10-17T01:00:00.000Z";
const T2 = "2026-10-17T02:00:00.000Z";
const T3 = "2026-10-17T03:00:00.000Z";
const when = (iso: string) => iso.slice(0, 10);

const f4 = getItem("f4")!;
const spec = f4.notApplicable!;

describe("f4's Not applicable option, in the rules file", () => {
  it("has the option and the line Adam asked for", () => {
    assert.equal(spec.label, "Not applicable");
    assert.equal(spec.line, "No building, pest or strata reports exist for this property.");
  });

  it("is offered on f4 and, as a question, on e1 only", () => {
    const property = { id: "p", stage: 3 } as unknown as Property;
    const offering = [0, 1, 2, 3, 4, 5]
      .flatMap((stage) => itemsForStage(stage as Property["stage"], property))
      .filter((i) => i.notApplicable)
      .map((i) => i.key)
      .sort();
    assert.deepEqual(offering, ["e1", "f4"]);
    assert.equal(spec.question, undefined, "f4 stays a tick box");
  });

  it("f4 is still required for its stage, so Not applicable is what lets the stage move on", () => {
    assert.equal(f4.requiredForStageCompletion, true);
  });

  it("has no em dash in what the agent reads", () => {
    for (const text of [spec.label, spec.line, spec.refusedWhileLogged!.message]) assert.ok(!text.includes("—"), text);
  });
});

describe("marking and clearing", () => {
  it("reads nothing stored as not marked", () => {
    assert.equal(readNa(undefined).notApplicable, false);
    assert.equal(readNa({ entries: [] }).notApplicable, false);
    assert.equal(readNa({ notApplicable: "yes" }).notApplicable, false);
  });

  it("marking keeps who and when, and a history line", () => {
    const na = applyNa(readNa({}), true, jo, T1);
    assert.equal(na.notApplicable, true);
    assert.equal(na.naByName, "Jo Agent (made up)");
    assert.equal(na.naAt, T1);
    assert.deepEqual(na.naHistory, [{ at: T1, by: "jo", byName: "Jo Agent (made up)", event: "marked_na" }]);
  });

  it("changing back clears the mark but keeps the history", () => {
    const marked = applyNa(readNa({}), true, jo, T1);
    const cleared = applyNa(marked, false, sam, T2);
    assert.equal(cleared.notApplicable, false);
    assert.equal(cleared.naBy, undefined);
    assert.deepEqual(
      cleared.naHistory?.map((e) => [e.event, e.byName]),
      [
        ["marked_na", "Jo Agent (made up)"],
        ["cleared_na", "Sam Licensee (made up)"],
      ],
    );
  });

  it("the same answer twice changes nothing", () => {
    const marked = applyNa(readNa({}), true, jo, T1);
    assert.equal(applyNa(marked, true, sam, T2), marked);
    const blank = readNa({});
    assert.equal(applyNa(blank, false, sam, T2), blank);
  });

  it("leaves everything else on the card alone, so a buyer list survives a mark and a clear", () => {
    const before = { entries: [{ name: "Pat Buyer (made up)" }], loggedElsewhere: false, note: "kept" };
    const marked = withNa(before, applyNa(readNa(before), true, jo, T1));
    assert.deepEqual(marked.entries, before.entries);
    assert.equal(marked.note, "kept");
    const cleared = withNa(marked, applyNa(readNa(marked), false, jo, T2));
    assert.deepEqual(cleared.entries, before.entries);
    assert.equal(cleared.notApplicable, false);
    assert.equal("naBy" in cleared, false);
    assert.equal((cleared.naHistory as unknown[]).length, 2);
  });
});

describe("a save that rebuilds the card (Mark done, Reopen)", () => {
  it("carries the history of an earlier mark and change back", () => {
    const marked = applyNa(readNa({}), true, jo, T1);
    const cleared = withNa({ entries: [{ name: "Pat" }] }, applyNa(marked, false, jo, T2));
    assert.deepEqual(
      naCarriedThroughSave(cleared, sam, T3).naHistory?.map((e) => e.event),
      ["marked_na", "cleared_na"],
    );
  });

  it("records a change back if the card was still marked, and does not carry the mark", () => {
    const marked = withNa({}, applyNa(readNa({}), true, jo, T1));
    const carried = naCarriedThroughSave(marked, sam, T2);
    assert.deepEqual(
      carried.naHistory?.map((e) => [e.event, e.byName]),
      [
        ["marked_na", "Jo Agent (made up)"],
        ["cleared_na", "Sam Licensee (made up)"],
      ],
    );
    assert.equal("notApplicable" in carried, false);
  });

  it("carries nothing for a card never marked", () => {
    assert.deepEqual(naCarriedThroughSave({ entries: [] }, sam, T2), {});
  });
});

describe("refused while a report is logged on f3", () => {
  it("is allowed with no f3 card, an empty register, or f3 answered No", () => {
    assert.equal(naRefusal(spec, undefined), null);
    assert.equal(naRefusal(spec, { data: { entries: [] } }), null);
    assert.equal(naRefusal(spec, { data: { entries: [], noReports: true } }), null);
  });

  it("is refused once a report is logged, with a reason", () => {
    const refusal = naRefusal(spec, { data: { entries: [{ recordedAt: T1 }] } });
    assert.ok(refusal?.includes("Building, pest or strata reports"));
  });

  it("names f3 as the card that rules it out", () => {
    assert.equal(spec.refusedWhileLogged?.itemKey, "f3");
  });
});

describe("what the compliance file prints", () => {
  const current = (data: unknown) => ({ data }) as unknown as PropertyItem;

  it("prints Not applicable, the line, who and when", () => {
    const data = withNa({}, applyNa(readNa({}), true, jo, T1));
    assert.deepEqual(naRecordLines(f4, current(data), when), [
      "Not applicable: No building, pest or strata reports exist for this property. Marked by Jo Agent (made up) on 2026-10-17.",
    ]);
  });

  it("prints the earlier answer once it has been changed back", () => {
    const marked = applyNa(readNa({}), true, jo, T1);
    const cleared = applyNa(marked, false, sam, T3);
    assert.deepEqual(naRecordLines(f4, current(withNa({}, cleared)), when), [
      "Earlier marked not applicable by Jo Agent (made up) on 2026-10-17; changed by Sam Licensee (made up) on 2026-10-17.",
    ]);
  });

  it("prints nothing for a card never marked, or a card without the option", () => {
    assert.deepEqual(naRecordLines(f4, current({ entries: [{ name: "Pat" }] }), when), []);
    assert.deepEqual(naRecordLines(f4, undefined, when), []);
    assert.deepEqual(naRecordLines(getItem("f3")!, current({ notApplicable: true }), when), []);
  });
});

// "Who exchanged contracts?" on the contract served card, e1 (Adam, 20 Oct
// 2026; mockup approved). The same engine, asked as a question.
describe("e1's question, in the rules file", () => {
  const e1 = getItem("e1")!;
  const e1Spec = e1.notApplicable!;

  it("asks who exchanged contracts, with the two answers and the line Adam asked for", () => {
    assert.equal(e1Spec.question?.ask, "Who exchanged contracts?");
    assert.equal(e1Spec.question?.ours, "Our agency");
    assert.equal(e1Spec.label, "Someone else");
    assert.equal(
      e1Spec.line,
      "The agency didn't exchange contracts, so serving the contract within 2 business days wasn't the agency's job. Nothing more needed.",
    );
    assert.equal(e1Spec.record?.text, "Exchanged by someone else. Not the agency's to serve.");
  });

  it("doesn't ask who did the exchange (Adam, 20 Oct): no refusal, nothing else to fill in", () => {
    assert.equal(e1Spec.refusedWhileLogged, undefined);
    assert.equal(e1.hideNote, true);
    assert.equal(e1.hideEvidence, true);
  });

  it("is in the Sold stage and still required, so Someone else is what lets the stage move on", () => {
    assert.equal(e1.stage, 4);
    assert.equal(e1.requiredForStageCompletion, true);
    // Our agency still needs the date, as before.
    assert.equal(e1.requiresDate, true);
  });

  it("has no em dash and never says compliant", () => {
    const words = [
      e1.description,
      e1Spec.label,
      e1Spec.line,
      e1Spec.question!.ask,
      e1Spec.question!.ours,
      e1Spec.question!.hint,
      e1Spec.record!.text,
      e1Spec.record!.earlier,
    ];
    for (const text of words) {
      assert.ok(!text.includes("—"), text);
      assert.ok(!/compliant/i.test(text), text);
    }
  });
});

describe("e1 on the compliance file", () => {
  const e1 = getItem("e1")!;
  const current = (data: unknown) => ({ data }) as unknown as PropertyItem;

  it("prints the record, who and when", () => {
    const data = withNa({}, applyNa(readNa({}), true, jo, T1));
    assert.deepEqual(naRecordLines(e1, current(data), when), [
      "Exchanged by someone else. Not the agency's to serve. Recorded by Jo Agent (made up) on 2026-10-17.",
    ]);
  });

  it("after a change back, keeps the history and says what it was", () => {
    const marked = applyNa(readNa({}), true, jo, T1);
    const cleared = applyNa(marked, false, sam, T2);
    assert.deepEqual(naRecordLines(e1, current(withNa({}, cleared)), when), [
      "Earlier recorded as exchanged by someone else by Jo Agent (made up) on 2026-10-17; changed by Sam Licensee (made up) on 2026-10-17.",
    ]);
    // Then answered "Our agency" and marked done: the history goes through that save.
    assert.deepEqual(
      naCarriedThroughSave(withNa({}, cleared), sam, T3).naHistory?.map((e) => e.event),
      ["marked_na", "cleared_na"],
    );
  });

  it("prints nothing for a card answered Our agency the usual way", () => {
    assert.deepEqual(naRecordLines(e1, current({}), when), []);
    assert.deepEqual(naRecordLines(e1, undefined, when), []);
  });
});
