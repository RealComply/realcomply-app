import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { a4cSave, draftOffer, type ReasoningDraftRecord } from "./esp-reasoning-adoption";

const DRAFT =
  "The sales I relied on are 14 Smith St and 8 Jones Ave.\n\nMy estimated selling price, recorded in the agency agreement, is $1,300,000 to $1,400,000.";
const user = { id: "user-1", name: "Sam Agent" };
const now = "2026-10-02T03:00:00.000Z";
const draftInForm = { text: DRAFT, generatedAt: "2026-10-02T02:58:00.000Z", evidence: "supports" as const };

describe("adopting the draft", () => {
  it("draft not adopted counts as incomplete: nothing is saved as the agent's reasoning", () => {
    const result = a4cSave({ note: DRAFT, draft: draftInForm, confirmed: false, previous: null, user, now });

    assert.ok("error" in result, "the save is refused, so the card stays open");
    assert.match((result as { error: string }).error, /This is my reasoning for the estimated selling price/);
  });

  it("adopted unedited: records who, when, the original draft, and that it wasn't edited", () => {
    const result = a4cSave({ note: DRAFT, draft: draftInForm, confirmed: true, previous: null, user, now });

    assert.ok("data" in result);
    const data = (result as { data: Record<string, unknown> }).data;
    assert.equal(data.note, DRAFT);
    const record = data.reasoningDraft as ReasoningDraftRecord;
    assert.equal(record.text, DRAFT);
    assert.equal(record.confirmedText, DRAFT);
    assert.equal(record.editedBeforeConfirming, false);
    assert.equal(record.confirmedBy, "user-1");
    assert.equal(record.confirmedByName, "Sam Agent");
    assert.equal(record.confirmedAt, now);
    assert.equal(record.evidence, "supports");
  });

  it("adopted after edits: keeps the original draft beside the final text", () => {
    const edited = `${DRAFT}\n\nThe kitchen was renovated in 2024, which is why I sit at the top of the range.`;
    const result = a4cSave({ note: edited, draft: draftInForm, confirmed: true, previous: null, user, now });

    const data = (result as { data: Record<string, unknown> }).data;
    const record = data.reasoningDraft as ReasoningDraftRecord;
    assert.equal(data.note, edited, "the final text is the reasoning");
    assert.equal(record.text, DRAFT, "the original draft is kept");
    assert.equal(record.editedBeforeConfirming, true);
  });

  it("whitespace alone is not an edit", () => {
    const result = a4cSave({ note: `  ${DRAFT.replace("\n\n", "\n")}  `, draft: draftInForm, confirmed: true, previous: null, user, now });
    const record = (result as { data: Record<string, unknown> }).data.reasoningDraft as ReasoningDraftRecord;
    assert.equal(record.editedBeforeConfirming, false);
  });

  it("a later save keeps the adoption record and the none-on-market confirmation", () => {
    const first = (a4cSave({ note: DRAFT, draft: draftInForm, confirmed: true, previous: null, user, now }) as {
      data: Record<string, unknown>;
    }).data;
    const previous = { ...first, noneOnMarket: { confirmedBy: "user-1", confirmedAt: now } };

    const later = a4cSave({ note: `${DRAFT} Plus one more line.`, draft: null, confirmed: false, previous, user, now });
    const data = (later as { data: Record<string, unknown> }).data;
    assert.deepEqual(data.reasoningDraft, first.reasoningDraft);
    assert.deepEqual(data.noneOnMarket, previous.noneOnMarket);
  });

  it("the agent's own words save as before, with no draft involved", () => {
    const result = a4cSave({ note: "My own reasoning.", draft: null, confirmed: false, previous: null, user, now });
    assert.deepEqual((result as { data: Record<string, unknown> }).data, { note: "My own reasoning." });
  });
});

describe("where the draft is offered", () => {
  const base = { savedNote: "", documentNote: "", boxText: "", isDone: false, recordedElsewhere: false, reportRead: true };

  it("empty box, report read: offered in the box", () => {
    assert.equal(draftOffer(base), "in_box");
  });

  it("agent's own text not overwritten: saved reasoning, or text they have typed, means no offer", () => {
    assert.equal(draftOffer({ ...base, savedNote: "Relied on 14 Smith St.", boxText: "Relied on 14 Smith St." }), "none");
    assert.equal(draftOffer({ ...base, boxText: "I started writing this myself" }), "none");
  });

  it("reasoning read from the uploaded document stays first; the draft is the second option", () => {
    const doc = "Agent's notes from the appraisal: priced off the two Jones Ave sales.";
    assert.equal(draftOffer({ ...base, documentNote: doc, boxText: doc }), "second_option");
    assert.equal(draftOffer({ ...base, documentNote: doc, boxText: `${doc} And I added this.` }), "none");
  });

  it("no offer before the report is read, once done, or when recorded elsewhere", () => {
    assert.equal(draftOffer({ ...base, reportRead: false }), "none");
    assert.equal(draftOffer({ ...base, isDone: true }), "none");
    assert.equal(draftOffer({ ...base, recordedElsewhere: true }), "none");
  });
});
