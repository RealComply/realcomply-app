import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as adoption from "./esp-reasoning-adoption";
import {
  DISCLAIMER,
  OWN_OPINION,
  TICK_FIRST,
  a4cSave,
  adoptionSummary,
  draftOffer,
  pendingFromForm,
  tickCovers,
  type A4cSaveInput,
  type PendingReasoning,
  type ReasoningAdoptionRecord,
} from "./esp-reasoning-adoption";

// The ESP reasoning is the agent's own opinion (a4c). Since 14 Oct 2026: one
// tick under the box, needed before the card is done whatever put the words
// there, and no forced edit of RealComply's draft.

const DRAFT =
  "The sales I relied on are 14 Smith St and 8 Jones Ave.\n\nMy estimated selling price, recorded in the agency agreement, is $1,300,000 to $1,400,000. On this evidence I consider it is supported by them.";
const EDITED = `${DRAFT} The kitchen was renovated in 2024, which is why I sit at the top of the range.`;
const user = { id: "user-1", name: "Sam Agent" };
const now = "2026-10-14T03:15:00.000Z";
const pendingDraft: PendingReasoning = {
  source: "realcomply_draft",
  text: DRAFT,
  generatedAt: "2026-10-14T03:10:00.000Z",
  evidence: "supports",
};

const save = (over: Partial<A4cSaveInput> & { note: string }) =>
  a4cSave({ pending: null, status: "done", ticked: false, serverDraft: null, previous: null, user, now, ...over });
const dataOf = (r: ReturnType<typeof a4cSave>) => {
  assert.ok("data" in r, `refused: ${"error" in r ? r.error : ""}`);
  return r.data;
};
const recordOf = (r: ReturnType<typeof a4cSave>) => dataOf(r).reasoningAdoption as ReasoningAdoptionRecord;

describe("the tick", () => {
  it("is the brief's sentence, word for word", () => {
    assert.equal(
      OWN_OPINION,
      "I've read this reasoning, made any changes I felt were needed, and it reflects my own opinion of the estimated selling price.",
    );
  });

  it("is required before the card is done: RealComply's draft, the agent's document, or their own typing", () => {
    const doc: PendingReasoning = { source: "document", text: "Priced off the two Jones Ave sales; this one has the bigger block." };
    assert.deepEqual(save({ note: DRAFT, pending: pendingDraft }), { error: TICK_FIRST });
    assert.deepEqual(save({ note: doc.text, pending: doc }), { error: TICK_FIRST });
    assert.deepEqual(save({ note: "My own reasoning about the two Jones Ave sales." }), { error: TICK_FIRST });
  });

  it("the server rejects a save without it, whatever the page sent", () => {
    // A hand-built POST: the draft, marked done, no tick.
    const form = new FormData();
    form.set("note", DRAFT);
    form.set("reasoningSource", "realcomply_draft");
    form.set("reasoningOriginal", DRAFT);
    form.set("status", "done");
    assert.deepEqual(save({ note: DRAFT, pending: pendingFromForm(form) }), { error: TICK_FIRST });

    // The same draft with the fields that say so left out: the server knows
    // its own draft, so it is still refused, and still recorded as the draft.
    assert.deepEqual(save({ note: DRAFT, serverDraft: DRAFT }), { error: TICK_FIRST });
    const r = recordOf(save({ note: DRAFT, serverDraft: DRAFT, ticked: true }));
    assert.equal(r.source, "realcomply_draft");
    assert.equal(r.changed, false);
  });

  it("words the agent did not type here never save without it, even when not marking done", () => {
    assert.deepEqual(save({ note: DRAFT, pending: pendingDraft, status: "open" }), { error: TICK_FIRST });
  });

  it("the agent's own typing can still be saved on an open card without it", () => {
    assert.deepEqual(dataOf(save({ note: "My own reasoning.", status: "open" })), { note: "My own reasoning." });
  });

  it("an empty box is left to the completion rule, which asks for the reasoning", () => {
    assert.deepEqual(dataOf(save({ note: "" })), { note: "" });
  });
});

describe("no forced edit (reversal, 14 Oct 2026)", () => {
  it("the edit-before-confirm rule and its message are gone", () => {
    assert.equal((adoption as Record<string, unknown>).EDIT_FIRST, undefined);
    assert.ok(!JSON.stringify(Object.values(adoption)).includes("make it yours"));
  });

  it("an unchanged draft can be confirmed with the tick, and is recorded as used as written", () => {
    const data = dataOf(save({ note: DRAFT, pending: pendingDraft, ticked: true }));
    const record = data.reasoningAdoption as ReasoningAdoptionRecord;
    assert.equal(data.note, DRAFT);
    assert.equal(record.source, "realcomply_draft");
    assert.equal(record.originalText, DRAFT, "the original draft is kept");
    assert.equal(record.confirmedText, DRAFT);
    assert.equal(record.changed, false);
    assert.equal(record.statement, OWN_OPINION, "what was ticked, word for word");
    assert.equal(record.confirmedBy, "user-1");
    assert.equal(record.confirmedByName, "Sam Agent");
    assert.equal(record.confirmedAt, now);
    assert.equal(record.evidence, "supports");
    assert.equal(record.draftGeneratedAt, "2026-10-14T03:10:00.000Z");
  });

  it("a draft changed in its wording is recorded as changed, with the original beside the final text", () => {
    const record = recordOf(save({ note: EDITED, pending: pendingDraft, ticked: true }));
    assert.equal(record.changed, true);
    assert.equal(record.originalText, DRAFT);
    assert.equal(record.confirmedText, EDITED);
  });

  it("spacing, punctuation and capitals alone are not a change", () => {
    const record = recordOf(save({ note: DRAFT.replace(/\n\n/g, "\n").toUpperCase(), pending: pendingDraft, ticked: true }));
    assert.equal(record.changed, false);
  });
});

describe("what the record says", () => {
  it("reasoning read from the document: changed or used as written", () => {
    const doc = "Priced off the two Jones Ave sales; this one has the bigger block.";
    const pendingDoc: PendingReasoning = { source: "document", text: doc };
    const asRead = recordOf(save({ note: doc, pending: pendingDoc, ticked: true }));
    assert.equal(asRead.source, "document");
    assert.equal(asRead.originalText, doc);
    assert.equal(asRead.changed, false);
    assert.equal(recordOf(save({ note: `${doc} Bigger block, so the top half.`, pending: pendingDoc, ticked: true })).changed, true);
  });

  it("the agent's own typing: who ticked it and when, no original", () => {
    const record = recordOf(save({ note: "My own reasoning about the two Jones Ave sales.", ticked: true }));
    assert.equal(record.source, "typed");
    assert.equal(record.originalText, undefined);
    assert.equal(record.changed, undefined);
    assert.equal(record.statement, OWN_OPINION);
    assert.equal(record.confirmedBy, "user-1");
    assert.equal(record.confirmedAt, now);
  });

  it("in words on the card: changed, or used as written", () => {
    const at = { confirmedBy: "user-1", confirmedByName: "Sam Agent", confirmedAt: now, statement: OWN_OPINION };
    const line = (r: Partial<ReasoningAdoptionRecord>) => adoptionSummary({ confirmedText: "x", source: "typed", ...at, ...r });
    assert.equal(
      line({ source: "realcomply_draft", originalText: DRAFT, changed: false }),
      "Ticked as Sam Agent's own opinion on 14 October 2026 at 2:15 pm. RealComply's draft, used as written.",
    );
    assert.match(line({ source: "realcomply_draft", originalText: DRAFT, changed: true }), /Started from RealComply's draft and changed\.$/);
    assert.match(line({ source: "document", originalText: "x", changed: false }), /Read from the uploaded document, used as written\.$/);
    assert.match(line({ source: "document", originalText: "y", changed: true }), /Read from the uploaded document and changed\.$/);
    assert.match(line({ source: "typed" }), /Written on this card\.$/);
  });

  it("a confirmation from before 14 Oct 2026 keeps its own wording", () => {
    const old: ReasoningAdoptionRecord = {
      source: "realcomply_draft", originalText: DRAFT, confirmedText: EDITED,
      confirmedBy: "user-1", confirmedByName: "Sam Agent", confirmedAt: "2026-10-03T01:00:00.000Z",
    };
    assert.equal(adoptionSummary(old), "Confirmed as Sam Agent's reasoning on 3 October 2026, edited from RealComply's draft.");
  });
});

describe("later saves", () => {
  const first = dataOf(save({ note: DRAFT, pending: pendingDraft, ticked: true }));

  it("re-saving exactly the text a tick covers needs no second tick, and keeps the record", () => {
    assert.ok(tickCovers(first.reasoningAdoption as ReasoningAdoptionRecord, DRAFT));
    const again = dataOf(save({ note: DRAFT, serverDraft: DRAFT, previous: first }));
    assert.deepEqual(again.reasoningAdoption, first.reasoningAdoption);
  });

  it("any change to the text needs a fresh tick", () => {
    assert.deepEqual(save({ note: EDITED, previous: first }), { error: TICK_FIRST });
  });

  it("a fresh tick on edited text keeps where it came from and the original draft", () => {
    const record = recordOf(save({ note: EDITED, previous: first, ticked: true, now: "2026-10-15T00:00:00.000Z" }));
    assert.equal(record.source, "realcomply_draft");
    assert.equal(record.originalText, DRAFT);
    assert.equal(record.changed, true);
    assert.equal(record.confirmedAt, "2026-10-15T00:00:00.000Z");
  });

  it("a confirmation from before 14 Oct 2026 is not a tick: marking done again asks for one", () => {
    const old = { note: EDITED, reasoningAdoption: { source: "realcomply_draft", originalText: DRAFT, confirmedText: EDITED, confirmedBy: "u", confirmedByName: null, confirmedAt: now } };
    assert.deepEqual(save({ note: EDITED, previous: old }), { error: TICK_FIRST });
  });

  it("keep the none-on-market confirmation", () => {
    const previous = { ...first, noneOnMarket: { confirmedBy: "user-1", confirmedAt: now } };
    const later = dataOf(save({ note: DRAFT, previous }));
    assert.deepEqual(later.noneOnMarket, previous.noneOnMarket);
  });
});

describe("the disclaimer", () => {
  it("is never saved into the reasoning, even if pasted into the box", () => {
    const pasted = `${DISCLAIMER}\n\n${EDITED}`;
    const data = dataOf(save({ note: pasted, pending: pendingDraft, ticked: true }));
    assert.equal(data.note, EDITED);
    assert.ok(!JSON.stringify(data).includes(DISCLAIMER), "nowhere in what is saved");
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
