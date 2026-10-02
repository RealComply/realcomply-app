import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DISCLAIMER,
  EDIT_FIRST,
  a4cSave,
  draftOffer,
  editedInWording,
  pendingFromForm,
  type PendingReasoning,
  type ReasoningAdoptionRecord,
} from "./esp-reasoning-adoption";

const DRAFT =
  "The sales I relied on are 14 Smith St and 8 Jones Ave.\n\nMy estimated selling price, recorded in the agency agreement, is $1,300,000 to $1,400,000. On this evidence I consider it is supported by them.";
const EDITED = `${DRAFT} The kitchen was renovated in 2024, which is why I sit at the top of the range.`;
const user = { id: "user-1", name: "Sam Agent" };
const now = "2026-10-02T03:00:00.000Z";
const pendingDraft: PendingReasoning = {
  source: "realcomply_draft",
  text: DRAFT,
  generatedAt: "2026-10-02T02:58:00.000Z",
  evidence: "supports",
};

const save = (note: string, pending: PendingReasoning | null, confirmed: boolean, previous: Record<string, unknown> | null = null) =>
  a4cSave({ note, pending, confirmed, previous, user, now });
const dataOf = (r: ReturnType<typeof a4cSave>) => (r as { data: Record<string, unknown> }).data;

describe("edit first, then confirm", () => {
  it("draft unchanged can't be confirmed", () => {
    assert.equal(editedInWording(DRAFT, DRAFT), false, "the page keeps the confirm button disabled");
    const result = save(DRAFT, pendingDraft, true);
    assert.deepEqual(result, { error: EDIT_FIRST });
  });

  it("a change of spacing, punctuation or capital letters alone can't be confirmed", () => {
    const cosmetic = [
      DRAFT.replace(/\n\n/g, "\n").replace(/ /g, "  "),
      DRAFT.replace(/\./g, "!").replace(/,/g, ""),
      DRAFT.toUpperCase(),
      DRAFT.replace("$1,300,000", "$1300000"),
      `  ${DRAFT}  `,
    ];
    for (const text of cosmetic) {
      assert.equal(editedInWording(DRAFT, text), false, text);
      assert.deepEqual(save(text, pendingDraft, true), { error: EDIT_FIRST });
    }
  });

  it("an edited draft can be confirmed, and keeps the original draft beside the final text", () => {
    assert.equal(editedInWording(DRAFT, EDITED), true);
    assert.equal(editedInWording(DRAFT, DRAFT.replace("relied on", "leaned on")), true, "one word is a wording change");

    const data = dataOf(save(EDITED, pendingDraft, true));
    const record = data.reasoningAdoption as ReasoningAdoptionRecord;
    assert.equal(data.note, EDITED);
    assert.equal(record.source, "realcomply_draft");
    assert.equal(record.originalText, DRAFT);
    assert.equal(record.confirmedText, EDITED);
    assert.equal(record.confirmedBy, "user-1");
    assert.equal(record.confirmedByName, "Sam Agent");
    assert.equal(record.confirmedAt, now);
    assert.equal(record.evidence, "supports");
  });

  it("the server rejects an unedited confirm, whatever the page sent", () => {
    // A hand-built POST: confirm pressed, draft unchanged.
    const form = new FormData();
    form.set("note", DRAFT);
    form.set("reasoningSource", "realcomply_draft");
    form.set("reasoningOriginal", DRAFT);
    form.set("adoptDraft", "yes");
    const result = a4cSave({ note: DRAFT, pending: pendingFromForm(form), confirmed: true, previous: null, user, now });
    assert.deepEqual(result, { error: EDIT_FIRST });
  });

  it("an edited draft that isn't confirmed doesn't save: the card stays incomplete", () => {
    const result = save(EDITED, pendingDraft, false);
    assert.ok("error" in result);
    assert.match((result as { error: string }).error, /This is my reasoning for the estimated selling price/);
  });
});

describe("reasoning read from the agent's own document", () => {
  const doc = "Priced off the two Jones Ave sales; this one has the bigger block.";
  const pendingDoc: PendingReasoning = { source: "document", text: doc };

  it("needs no edit, but still needs the one-click confirmation", () => {
    assert.ok("error" in save(doc, pendingDoc, false), "Mark done alone is refused");
    const data = dataOf(save(doc, pendingDoc, true));
    const record = data.reasoningAdoption as ReasoningAdoptionRecord;
    assert.equal(data.note, doc);
    assert.equal(record.source, "document");
    assert.equal(record.originalText, doc);
  });
});

describe("the disclaimer", () => {
  it("is never saved into the reasoning, even if pasted into the box", () => {
    const pasted = `${DISCLAIMER}\n\n${EDITED}`;
    const data = dataOf(save(pasted, pendingDraft, true));
    assert.equal(data.note, EDITED);
    assert.ok(!JSON.stringify(data).includes(DISCLAIMER), "nowhere in what is saved");
  });
});

describe("later saves", () => {
  it("keep the adoption record and the none-on-market confirmation", () => {
    const first = dataOf(save(EDITED, pendingDraft, true));
    const previous = { ...first, noneOnMarket: { confirmedBy: "user-1", confirmedAt: now } };
    const later = dataOf(save(`${EDITED} One more line.`, null, false, previous));
    assert.deepEqual(later.reasoningAdoption, first.reasoningAdoption);
    assert.deepEqual(later.noneOnMarket, previous.noneOnMarket);
  });

  it("the agent's own typing saves as before, with no confirmation step", () => {
    assert.deepEqual(dataOf(save("My own reasoning.", null, false)), { note: "My own reasoning." });
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
