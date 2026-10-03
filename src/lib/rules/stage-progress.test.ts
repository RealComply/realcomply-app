import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stageProgress, stageStarted } from "./stage-progress";

describe("stageProgress", () => {
  it("counts done items against every item that applies", () => {
    assert.deepEqual(stageProgress(["done", "open", undefined, "done"]), { done: 2, total: 4, state: "inProgress" });
  });
  it("reads as not started when nothing is done", () => {
    assert.deepEqual(stageProgress([undefined, "open", undefined]), { done: 0, total: 3, state: "notStarted" });
  });
  it("reads as finished only when every item is done", () => {
    assert.deepEqual(stageProgress(["done", "done"]), { done: 2, total: 2, state: "finished" });
  });
  it("a flag wins over everything, even with every other item done", () => {
    assert.equal(stageProgress(["done", "flagged", "done"]).state, "flagged");
    assert.equal(stageProgress(["flagged"]).state, "flagged");
    assert.equal(stageProgress(["flagged", undefined]).done, 0);
  });
  it("a flagged item is not counted as done", () => {
    assert.equal(stageProgress(["done", "flagged"]).done, 1);
  });
  it("a stage has started once anything is done or flagged", () => {
    assert.equal(stageStarted(stageProgress([undefined, "open"])), false);
    assert.equal(stageStarted(stageProgress(["done", "open"])), true);
    assert.equal(stageStarted(stageProgress(["flagged", "open"])), true);
    assert.equal(stageStarted(stageProgress(["done"])), true);
  });
});
