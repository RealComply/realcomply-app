import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyAnswer,
  applyTick,
  documentRecordLine,
  questionAndDocumentRecordLines,
  questionComplete,
  questionRecordLines,
  readQuestion,
  withQuestion,
} from "./question-card";
import { POA_DOCUMENT_KEY, POA_KEY, SEEDED_AT_CREATION, getItem, itemsForStage, poaAnswer } from "./nsw-sales";
import { scheduleOne } from "@/lib/legal/sg-annexure";
import type { Property, PropertyItem } from "@/lib/types";

// The Power of Attorney question (Adam, 15 Oct 2026).

const jo = { id: "jo", name: "Jo Agent (made up)" };
const sam = { id: "sam", name: "Sam Licensee (made up)" };
const T1 = "2026-10-15T01:00:00.000Z";
const T2 = "2026-10-15T02:00:00.000Z";
const T3 = "2026-10-15T03:00:00.000Z";
const when = (iso: string) => iso.slice(0, 10);

const spec = getItem(POA_KEY)!.question!;

describe("the question card", () => {
  it("is not complete until it is answered", () => {
    assert.equal(questionComplete(spec, readQuestion({})), false);
  });

  it("No completes it, with nothing to tick", () => {
    const q = applyAnswer({}, "no", jo, T1);
    assert.equal(questionComplete(spec, q), true);
    assert.deepEqual([q.answer, q.answeredBy, q.answeredByName, q.answeredAt], ["no", "jo", "Jo Agent (made up)", T1]);
    assert.equal(applyTick(q, true, jo, T2), null, "nothing to tick after No");
  });

  it("Yes waits for the tick, and the tick completes it", () => {
    const yes = applyAnswer({}, "yes", jo, T1);
    assert.equal(questionComplete(spec, yes), false);
    const ticked = applyTick(yes, true, sam, T2)!;
    assert.equal(questionComplete(spec, ticked), true);
    assert.deepEqual([ticked.tickedBy, ticked.tickedByName, ticked.tickedAt], ["sam", "Sam Licensee (made up)", T2]);
  });

  it("Yes then No clears the tick, and the history keeps every step", () => {
    const ticked = applyTick(applyAnswer({}, "yes", jo, T1), true, jo, T2)!;
    const no = applyAnswer(ticked, "no", jo, T3);
    assert.equal(no.ticked, false);
    assert.equal(no.tickedBy, undefined);
    assert.equal(no.tickedAt, undefined);
    assert.equal(questionComplete(spec, no), true);
    assert.deepEqual(
      no.history!.map((h) => h.event),
      ["answered_yes", "ticked", "unticked", "answered_no"],
    );
    // Back to Yes: the tick has to be given again.
    const yesAgain = applyAnswer(no, "yes", jo, T3);
    assert.equal(yesAgain.ticked, false);
    assert.equal(questionComplete(spec, yesAgain), false);
  });

  it("a cleared tick stays cleared when saved over the old data", () => {
    const old = applyTick(applyAnswer({}, "yes", jo, T1), true, jo, T2)!;
    const stored = withQuestion({ ...old, evidenceFileName: "x.pdf" }, applyAnswer(old, "no", jo, T3));
    const back = readQuestion(stored);
    assert.equal(back.ticked, false);
    assert.equal(back.tickedBy, undefined);
    assert.equal(stored.evidenceFileName, "x.pdf");
  });

  it("answering the same again changes nothing", () => {
    const yes = applyAnswer({}, "yes", jo, T1);
    assert.equal(applyAnswer(yes, "yes", sam, T2), yes);
  });

  it("prints the answer and the tick with who and when", () => {
    const ticked = applyTick(applyAnswer({}, "yes", jo, T1), true, sam, T2)!;
    assert.deepEqual(questionRecordLines(spec, ticked, when), [
      "Answer: Yes. Answered by Jo Agent (made up) on 2026-10-15.",
      "Power of Attorney provided: ticked by Sam Licensee (made up) on 2026-10-15.",
    ]);
    assert.deepEqual(questionRecordLines(spec, applyAnswer({}, "no", jo, T1), when), [
      "Answer: No. Answered by Jo Agent (made up) on 2026-10-15.",
    ]);
    assert.deepEqual(questionRecordLines(spec, {}, when), ["Not answered."]);
  });

  it("prints the upload with who and when, or that none was given", () => {
    assert.equal(
      documentRecordLine("poa.pdf", { uploadedByName: "Jo Agent (made up)", uploadedAt: T1 }, when),
      "Uploaded: poa.pdf, by Jo Agent (made up) on 2026-10-15.",
    );
    assert.equal(documentRecordLine(null, {}, when), "No copy uploaded (optional).");
  });
});

const listing = { id: "p", stage: 0, test_mode: false, agent_interest: false, sale_method: "private_treaty" } as unknown as Property;
const row = (key: string, data: Record<string, unknown> = {}, extra: Partial<PropertyItem> = {}): PropertyItem => ({
  id: key,
  agency_id: "a",
  property_id: "p",
  item_key: key,
  status: "open",
  event_date: null,
  recorded_at: T1,
  data,
  evidence_path: null,
  extracted_date: null,
  completed_by: null,
  created_at: T1,
  ...extra,
});
const keys = (stage: 0 | 1, items: Record<string, PropertyItem>) => itemsForStage(stage, listing, items).map((i) => i.key);

describe("Power of Attorney on a listing", () => {
  it("is given to new listings at creation", () => {
    assert.deepEqual([...SEEDED_AT_CREATION], [POA_KEY]);
  });

  it("an existing listing (no card) shows no question, so nothing reopens", () => {
    assert.ok(!keys(0, {}).includes(POA_KEY));
    assert.ok(!keys(1, {}).includes(POA_DOCUMENT_KEY));
  });

  it("a new listing asks it straight after Vendor identity verified, and the stage waits on it", () => {
    const k = keys(0, { [POA_KEY]: row(POA_KEY) });
    assert.equal(k[k.indexOf("a1") + 1], POA_KEY);
    assert.equal(getItem(POA_KEY)!.requiredForStageCompletion, true);
    assert.equal(getItem(POA_KEY)!.legalBasis, "Reg Sch 1 cl 8, Sch 5 cl 4");
  });

  it("No: no Pre-market card", () => {
    const items = { [POA_KEY]: row(POA_KEY, applyAnswer({}, "no", jo, T1)) };
    assert.equal(poaAnswer(items), "no");
    assert.ok(!keys(1, items).includes(POA_DOCUMENT_KEY));
  });

  it("Yes: an optional Pre-market card, first in the stage, that the stage never waits on", () => {
    const items = { [POA_KEY]: row(POA_KEY, applyAnswer({}, "yes", jo, T1)) };
    const k = keys(1, items);
    assert.equal(k[0], POA_DOCUMENT_KEY);
    const card = getItem(POA_DOCUMENT_KEY)!;
    assert.equal(card.requiredForStageCompletion, false);
    assert.equal(card.kind, "document");
    assert.equal(card.legalBasis, "Reg Sch 1 cl 8, Sch 5 cl 4");
  });

  it("an uploaded copy stays on show if the answer later changes to No", () => {
    const items = {
      [POA_KEY]: row(POA_KEY, applyAnswer({}, "no", jo, T1)),
      [POA_DOCUMENT_KEY]: row(POA_DOCUMENT_KEY, {}, { evidence_path: "a/p/poa.pdf" }),
    };
    assert.ok(keys(1, items).includes(POA_DOCUMENT_KEY));
  });

  it("the annexure's Schedule 1 gives both cards their provision, neither blank", () => {
    const rows = scheduleOne().flatMap((g) => g.rows);
    for (const label of ["Is the property being sold under a Power of Attorney?", "Power of Attorney document"]) {
      assert.equal(rows.find((r) => r.record === label)?.provision, "Reg Sch 1 cl 8, Sch 5 cl 4", label);
    }
  });

  it("the finalised file prints the question and the upload", () => {
    const q = row(POA_KEY, applyTick(applyAnswer({}, "yes", jo, T1), true, jo, T2)!);
    assert.equal(questionAndDocumentRecordLines(getItem(POA_KEY)!, q, when).length, 2);
    const doc = row(
      POA_DOCUMENT_KEY,
      { evidenceFileName: "poa.pdf", uploadedByName: "Jo Agent (made up)", uploadedAt: T3 },
      { evidence_path: "a/p/poa.pdf", status: "done" },
    );
    assert.deepEqual(questionAndDocumentRecordLines(getItem(POA_DOCUMENT_KEY)!, doc, when), [
      "Uploaded: poa.pdf, by Jo Agent (made up) on 2026-10-15.",
    ]);
    assert.deepEqual(questionAndDocumentRecordLines(getItem("a1")!, row("a1"), when), []);
  });
});
