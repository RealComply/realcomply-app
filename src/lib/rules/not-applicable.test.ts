import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyNa, naRecordLines, naRefusal, readNa, withNa } from "./not-applicable";
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

  it("is offered on f4 only", () => {
    const property = { id: "p", stage: 3 } as unknown as Property;
    const offering = [0, 1, 2, 3, 4, 5]
      .flatMap((stage) => itemsForStage(stage as Property["stage"], property))
      .filter((i) => i.notApplicable)
      .map((i) => i.key);
    assert.deepEqual(offering, ["f4"]);
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
