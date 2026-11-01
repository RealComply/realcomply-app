import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UnfinishedAnswer, answerShapeProblem, toolAnswer, unfinishedMessage } from "@/lib/documents/reader-answer";

// The reader's answer (30 Oct 2026; every reader since 1 Nov 2026). A
// comparable-sales report's answer cut off at the token cap used to pass for
// "nothing found". Made-up answers only.

type Response = Parameters<typeof toolAnswer>[0];

const toolUse = (input: unknown) =>
  ({ type: "tool_use", id: "toolu_1", name: "record_findings", input }) as Response["content"][number];

const answer = (stop_reason: Response["stop_reason"], content: Response["content"]): Response => ({ stop_reason, content });

const sales = { documentIs: "comparable_sales", patches: [{ itemKey: "a4c", comparableSales: [{ address: "1 Example St" }] }] };

// The outline of the listing reader's tool, as far as the check looks.
const findingsSchema = {
  type: "object",
  properties: { documentIs: { type: "string" }, patches: { type: "array" } },
  required: ["documentIs", "patches"],
};

const unfinished = (why: string) => (e: unknown) => e instanceof UnfinishedAnswer && e.why === why;

describe("the reader's answer", () => {
  it("is the tool's input when the answer finished", () => {
    assert.deepEqual(toolAnswer(answer("tool_use", [toolUse(sales)]), findingsSchema), sales);
    assert.deepEqual(toolAnswer(answer("end_turn", [toolUse(sales)])), sales);
  });

  it("is a failed read, not an empty one, when it was cut off at the cap", () => {
    // What a long report's answer looked like at 1,536: the call begun, its list unfinished.
    const cut = answer("max_tokens", [toolUse({ documentIs: "comparable_sales" })]);
    assert.throws(() => toolAnswer(cut, findingsSchema), unfinished("cut_off"));
    assert.throws(() => toolAnswer(answer("model_context_window_exceeded", [toolUse({})])), unfinished("cut_off"));
  });

  it("is a failed read when it was refused or held no tool call", () => {
    assert.throws(() => toolAnswer(answer("refusal", [])), unfinished("refused"));
    assert.throws(
      () => toolAnswer(answer("end_turn", [{ type: "text", text: "Here are the sales.", citations: null } as Response["content"][number]])),
      unfinished("no_answer"),
    );
  });

  // REVERSAL (Adam, 1 Nov 2026). Was: readers that didn't ask for the check
  // took a cut-off answer as it came. Now no reader can.
  it("fails the same way for every reader: there is no way to take a cut-off answer as it came", () => {
    const cut = answer("max_tokens", [toolUse({ documentIs: "licence" })]);
    assert.throws(() => toolAnswer(cut), unfinished("cut_off"));
    assert.throws(() => toolAnswer(answer("end_turn", [])), unfinished("no_answer"));
  });

  it("is a failed read when the answer can't be used", () => {
    // Not an object, the required list missing, a list given as text.
    assert.throws(() => toolAnswer(answer("tool_use", [toolUse("comparable_sales")]), findingsSchema), unfinished("unparseable"));
    assert.throws(() => toolAnswer(answer("tool_use", [toolUse({ documentIs: "comparable_sales" })]), findingsSchema), unfinished("unparseable"));
    assert.throws(
      () => toolAnswer(answer("tool_use", [toolUse({ documentIs: "comparable_sales", patches: "27 sales" })]), findingsSchema),
      unfinished("unparseable"),
    );
  });

  it("judges only the answer's outline, never one odd entry in a list", () => {
    const oneOdd = { documentIs: "comparable_sales", patches: [{ itemKey: "a4c" }, "a stray line", { itemKey: "a4c", comparableSales: [{ price: "1.2m" }] }] };
    assert.equal(answerShapeProblem(oneOdd, findingsSchema), null);
    assert.equal(answerShapeProblem({ isIdentityDocument: "yes" }, { type: "object", properties: { isIdentityDocument: { type: "boolean" } }, required: ["isIdentityDocument"] }), "isIdentityDocument isn't true or false");
    assert.equal(answerShapeProblem({ hours: "3" }, { type: "object", properties: { hours: { type: "number" } } }), "hours isn't a number");
    assert.equal(answerShapeProblem({}, { type: "object", properties: { hours: { type: "number" } } }), null);
  });

  it("says so in plain words", () => {
    for (const why of ["cut_off", "refused", "no_answer", "unparseable"] as const) {
      const text = unfinishedMessage(why);
      assert.ok(text.includes("nothing was taken from it"), text);
      assert.ok(!/[—–]/.test(text), text);
    }
    assert.ok(unfinishedMessage("cut_off").includes("couldn't be read to the end"));
  });
});
