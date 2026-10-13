import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OWN_OPINION, type ReasoningAdoptionRecord } from "@/lib/rules/esp-reasoning-adoption";

// The tick under the ESP reasoning box (Adam, 14 Oct 2026): shown until the
// agent has ticked for the text in the box, and the record in its place once
// they have. No forced edit, so nothing on the card asks for one. .tsx needs
// the repo's load hook, as in draft-disclaimer.test.ts.
register("../../../scripts/tsx-hooks.mjs", import.meta.url);

type Ui = typeof import("./ReasoningAssist");
let ui: Ui;
before(async () => {
  ui = (await import("./ReasoningAssist.tsx" as string)) as Ui;
});

const REASONING = "Relied on 14 Smith St and 8 Jones Ave, both three bedroom on similar land.";
const ticked: ReasoningAdoptionRecord = {
  source: "realcomply_draft",
  originalText: REASONING,
  confirmedText: REASONING,
  changed: false,
  statement: OWN_OPINION,
  confirmedBy: "u1",
  confirmedByName: "Sam Agent",
  confirmedAt: "2026-10-14T03:15:00.000Z",
};

function card(over: { text: string; adoption?: ReasoningAdoptionRecord | null; isDone?: boolean }): string {
  return renderToStaticMarkup(
    createElement(ui.ReasoningAssist, {
      noteId: "note-a4c",
      initialText: over.text,
      draftInput: null,
      comparables: [],
      savedReasoning: over.text,
      documentReasoning: "",
      reportRead: true,
      adoption: over.adoption ?? null,
      isDone: over.isDone ?? false,
      onDraftInBox: () => {},
      onTickMissing: () => {},
    }),
  );
}

const apostrophes = (html: string) => html.replace(/&#x27;/g, "'");

describe("the tick under the reasoning box", () => {
  it("is shown, unticked, with the brief's sentence, while the card is open", () => {
    const html = apostrophes(card({ text: REASONING }));
    assert.ok(html.includes(OWN_OPINION));
    const box = html.match(/<input type="checkbox"[^>]*>/)?.[0] ?? "";
    assert.ok(box.includes('name="ownOpinion"') && box.includes('value="yes"'), box);
    assert.ok(!box.includes("checked"), "starts unticked");
  });

  it("nothing on the card asks for the draft to be edited first, and the old confirm button is gone", () => {
    const html = apostrophes(card({ text: REASONING }));
    assert.ok(!html.includes("make it yours"));
    assert.ok(!html.includes("This is my reasoning for the estimated selling price"));
  });

  it("once ticked for the text in the box, the record shows instead: who, when, and used as written", () => {
    const html = apostrophes(card({ text: REASONING, adoption: ticked, isDone: true }));
    assert.ok(!html.includes('name="ownOpinion"'));
    assert.ok(html.includes("Ticked as Sam Agent's own opinion on 14 October 2026 at 2:15 pm. RealComply's draft, used as written."));
  });

  it("comes back when the text no longer matches what was ticked", () => {
    const html = card({ text: `${REASONING} And the larger block.`, adoption: ticked, isDone: true });
    assert.ok(html.includes('name="ownOpinion"'));
  });
});
