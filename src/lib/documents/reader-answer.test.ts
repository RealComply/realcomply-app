import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UnfinishedAnswer, toolAnswer, unfinishedMessage } from "@/lib/documents/reader-answer";

// The reader's answer (30 Oct 2026). A comparable-sales report's answer cut
// off at the token cap used to pass for "nothing found". Made-up answers only.

type Response = Parameters<typeof toolAnswer>[0];

const toolUse = (input: Record<string, unknown>) =>
  ({ type: "tool_use", id: "toolu_1", name: "record_findings", input }) as Response["content"][number];

const answer = (stop_reason: Response["stop_reason"], content: Response["content"]): Response => ({ stop_reason, content });

const sales = { documentIs: "comparable_sales", patches: [{ itemKey: "a4c", comparableSales: [{ address: "1 Example St" }] }] };

describe("the reader's answer", () => {
  it("is the tool's input when the answer finished", () => {
    assert.deepEqual(toolAnswer(answer("tool_use", [toolUse(sales)]), true), sales);
    assert.deepEqual(toolAnswer(answer("end_turn", [toolUse(sales)]), true), sales);
  });

  it("is a failed read, not an empty one, when it was cut off at the cap", () => {
    // What a long report's answer looked like at 1,536: the call begun, its list unfinished.
    const cut = answer("max_tokens", [toolUse({ documentIs: "comparable_sales" })]);
    assert.throws(() => toolAnswer(cut, true), (e: unknown) => e instanceof UnfinishedAnswer && e.why === "cut_off");
    assert.throws(
      () => toolAnswer(answer("model_context_window_exceeded", [toolUse({})]), true),
      (e: unknown) => e instanceof UnfinishedAnswer && e.why === "cut_off",
    );
  });

  it("is a failed read when it was refused or held no tool call", () => {
    assert.throws(
      () => toolAnswer(answer("refusal", []), true),
      (e: unknown) => e instanceof UnfinishedAnswer && e.why === "refused",
    );
    assert.throws(
      () => toolAnswer(answer("end_turn", [{ type: "text", text: "Here are the sales.", citations: null } as Response["content"][number]]), true),
      (e: unknown) => e instanceof UnfinishedAnswer && e.why === "no_answer",
    );
  });

  it("is unchanged for the readers that don't ask for the check", () => {
    const cut = answer("max_tokens", [toolUse({ documentIs: "comparable_sales" })]);
    assert.deepEqual(toolAnswer(cut, false), { documentIs: "comparable_sales" });
    assert.equal(toolAnswer(answer("end_turn", []), false), null);
  });

  it("says so in plain words", () => {
    for (const why of ["cut_off", "refused", "no_answer"] as const) {
      const text = unfinishedMessage(why);
      assert.ok(text.includes("nothing was taken from it"), text);
      assert.ok(!/[—–]/.test(text), text);
    }
  });
});
