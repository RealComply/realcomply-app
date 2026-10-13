import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as adoption from "@/lib/rules/esp-reasoning-adoption";
import {
  OWN_OPINION,
  TICK_FIRST,
  a4cSave,
  adoptionSummary,
  pendingFromForm,
  type ReasoningAdoptionRecord,
} from "@/lib/rules/esp-reasoning-adoption";
import { MISSING_ON_MARKET, espReasoningMissing } from "@/lib/rules/esp-reasoning-gate";
import { keepsFieldsOnRefusal, sendKeepingFields } from "./send-keeping-fields";

// The live misfire on the ESP reasoning card (Adam, 14 Oct 2026): the agent
// drafted the reasoning, pressed Done without editing it, the old edit-first
// rule refused the save, the box emptied, and the card was stuck until they
// pressed Discard. Now the agent ticks that the reasoning is their own
// opinion, with no forced edit, and a refused save leaves the box as it was.

const DRAFT =
  "The sales I relied on are 14 Smith St and 8 Jones Ave.\n\nMy estimated selling price, recorded in the agency agreement, is $1,300,000 to $1,400,000. On this evidence I consider it is supported by them.";
const user = { id: "user-1", name: "Sam Agent" };
const now = "2026-10-14T03:15:00.000Z";

/** What the card posts when Done is pressed with RealComply's draft in the box. */
function posted({ ticked, note = DRAFT }: { ticked: boolean; note?: string }): FormData {
  const form = new FormData();
  form.set("note", note);
  form.set("status", "done"); // the Done button carries the status
  if (ticked) form.set("ownOpinion", "yes");
  form.set("reasoningSource", "realcomply_draft");
  form.set("reasoningOriginal", DRAFT);
  form.set("reasoningDraftGeneratedAt", "2026-10-14T03:10:00.000Z");
  form.set("reasoningDraftEvidence", "supports");
  return form;
}

/**
 * The a4c branch of setItemStatus (lib/actions/compliance.ts), reading the
 * form as it does: the tick and the save rule, then the completion rule for
 * a Done. onMarketCount is the properties on the original on-market list.
 */
function serverSave(form: FormData, onMarketCount = 2): { error: string } | { data: Record<string, unknown> } {
  const note = String(form.get("note") ?? "").trim();
  const status = String(form.get("status") ?? "done");
  const pending = pendingFromForm(form);
  const saved = a4cSave({
    note,
    pending,
    status,
    ticked: String(form.get("ownOpinion") ?? "") === "yes",
    serverDraft: pending ? null : DRAFT,
    previous: null,
    user,
    now,
  });
  if ("error" in saved) return saved;
  if (status === "done") {
    const missing = espReasoningMissing({ data: saved.data, onMarketCount, signedOff: false });
    if (missing.length > 0) return { error: missing.join(" ") };
  }
  return saved;
}

describe("Done on RealComply's draft, unchanged (the live misfire, 14 Oct 2026)", () => {
  it("draft, tick, Done: the unchanged draft saves and the card is done", () => {
    const result = serverSave(posted({ ticked: true }));
    assert.ok("data" in result, `refused: ${"error" in result ? result.error : ""}`);
    assert.equal(result.data.note, DRAFT);
    const record = result.data.reasoningAdoption as ReasoningAdoptionRecord;
    assert.equal(record.source, "realcomply_draft");
    assert.equal(record.originalText, DRAFT);
    assert.equal(record.changed, false);
    assert.equal(record.statement, OWN_OPINION);
    assert.equal(record.confirmedByName, "Sam Agent");
    assert.ok(adoptionSummary(record).endsWith("RealComply's draft, used as written."));
    assert.deepEqual(espReasoningMissing({ data: result.data, onMarketCount: 2, signedOff: false }), []);
  });

  it("nothing refuses it for being unedited: the edit-first rule and its message are gone", () => {
    assert.ok(!("EDIT_FIRST" in adoption));
    for (const ticked of [true, false]) {
      const result = serverSave(posted({ ticked }));
      assert.ok(!("error" in result) || !/edit/i.test(result.error), JSON.stringify(result));
    }
  });

  it("Done without the tick is refused with the reason, and nothing is saved", () => {
    assert.deepEqual(serverSave(posted({ ticked: false })), { error: TICK_FIRST });
  });
});

describe("a refused save keeps the box, so the card is never stuck", () => {
  it("the reasoning card is sent without React's form reset; other cards are unchanged", () => {
    assert.equal(keepsFieldsOnRefusal("a4c"), true);
    assert.equal(keepsFieldsOnRefusal("a4"), false);
    assert.equal(keepsFieldsOnRefusal("a3"), false);
  });

  it("sending stops the browser's own submit, sends the box with the button pressed, and never resets the form", () => {
    const calls: string[] = [];
    const form = {
      reset: () => {
        throw new Error("the form was reset");
      },
    } as unknown as HTMLFormElement;
    const doneButton = { name: "status", value: "done" } as unknown as HTMLElement;
    let sent: FormData | null = null;

    sendKeepingFields(
      {
        preventDefault: () => calls.push("preventDefault"),
        currentTarget: form,
        nativeEvent: { submitter: doneButton } as unknown as Event,
      },
      (formData) => {
        calls.push("send");
        sent = formData;
      },
      (scope) => {
        calls.push("transition");
        scope();
      },
      (f, submitter) => {
        calls.push("read form");
        assert.equal(f, form);
        assert.equal(submitter, doneButton);
        return posted({ ticked: false });
      },
    );

    assert.deepEqual(calls, ["preventDefault", "read form", "transition", "send"]);
    const formData = sent as FormData | null;
    assert.equal(formData?.get("status"), "done");
    assert.equal(formData?.get("note"), DRAFT);
  });

  it("after a refusal the box still holds the draft, and ticking it then pressing Done saves: no Discard needed", () => {
    // Refused: Done without the tick. The box keeps the draft.
    assert.deepEqual(serverSave(posted({ ticked: false })), { error: TICK_FIRST });
    // The same box, ticked, Done again.
    const retried = serverSave(posted({ ticked: true }));
    assert.ok("data" in retried);
    assert.equal(retried.data.note, DRAFT);
  });

  it("a refusal for another reason (nothing on the market yet) keeps the tick and the draft, and saves once that is fixed", () => {
    assert.deepEqual(serverSave(posted({ ticked: true }), 0), { error: MISSING_ON_MARKET });
    const retried = serverSave(posted({ ticked: true }), 1);
    assert.ok("data" in retried);
    assert.equal((retried.data.reasoningAdoption as ReasoningAdoptionRecord).changed, false);
  });
});
