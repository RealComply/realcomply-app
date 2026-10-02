import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stageHold } from "./stage-hold";

const open: Record<number, string[]> = { 0: [], 1: ["Card B"], 2: [] };
const base = { storedStage: 3 as const, testMode: false, signedOff: false, incompleteRequired: (s: number) => open[s] ?? [] };

describe("stageHold", () => {
  it("holds a file at the first earlier stage with an open required card", () => {
    assert.deepEqual(stageHold(base), { stage: 1, waitingOn: ["Card B"] });
  });
  it("leaves it at its own stage once earlier cards are complete", () => {
    assert.deepEqual(stageHold({ ...base, incompleteRequired: () => [] }), { stage: 3, waitingOn: [] });
  });
  it("never looks at the file's own stage", () => {
    assert.deepEqual(stageHold({ ...base, storedStage: 1 }).stage, 1);
  });
  it("never holds in test mode or once signed off", () => {
    assert.equal(stageHold({ ...base, testMode: true }).stage, 3);
    assert.equal(stageHold({ ...base, signedOff: true }).stage, 3);
  });
});
