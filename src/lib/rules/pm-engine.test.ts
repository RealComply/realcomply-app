import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PM_STAGES, pmStage, type PmGroup, type PmOrigin } from "./nsw-pm";
import {
  pmBlockedLine,
  pmCanSetItem,
  pmCardSummary,
  pmMoveCheck,
  pmStageCountLabel,
  pmStageViews,
  type PmEngineInput,
  type PmTick,
} from "./pm-engine";

const tick = (state: PmTick["state"] = "done"): PmTick => ({ state, changedBy: "u1", changedAt: "2026-10-06T04:15:00Z" });

/** Every item in the given stages ticked. */
function allDone(...stages: number[]): Record<string, PmTick> {
  const out: Record<string, PmTick> = {};
  for (const n of stages) for (const item of pmStage(n as 1).items) out[item.key] = tick();
  return out;
}

function input(over: Partial<PmEngineInput> & { origin?: PmOrigin; group?: PmGroup } = {}): PmEngineInput {
  return {
    origin: "new",
    group: "onboarding",
    tenancy: { beforeStages: [], moveInDate: null, moveOutDate: null },
    ticks: {},
    ...over,
  };
}

const view = (i: PmEngineInput, stage: number) => pmStageViews(i).find((v) => v.stage === stage)!;

describe("PM stages shown", () => {
  it("a new management shows all five stages, numbered 1 to 5", () => {
    assert.deepEqual(
      pmStageViews(input()).map((v) => [v.stage, v.displayNumber]),
      [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]],
    );
  });

  it("an existing tenanted property has no Stage 1, and Stages 2 and 3 are Before RealComply", () => {
    const i = input({ origin: "existing_tenanted", group: "tenanted", tenancy: { beforeStages: [2, 3], moveInDate: null, moveOutDate: null } });
    const views = pmStageViews(i);
    assert.deepEqual(views.map((v) => v.stage), [2, 3, 4, 5]);
    assert.equal(views[0].displayNumber, 1);
    assert.ok(view(i, 2).before && view(i, 3).before);
    assert.equal(view(i, 2).oval.kind, "earlier");
    assert.equal(view(i, 4).oval.kind, "underWay");
    // Exit is not reached until Tenant vacating.
    assert.ok(view(i, 5).locked);
  });

  it("an existing vacant property shows Stages 2, 3 and 5 (and the tenancy between) as Earlier", () => {
    const i = input({ origin: "existing_vacant", group: "vacant", tenancy: { beforeStages: [2, 3, 5], moveInDate: null, moveOutDate: null } });
    assert.deepEqual(
      pmStageViews(i).map((v) => v.oval.kind),
      ["earlier", "earlier", "earlier", "earlier"],
    );
  });

  it("Before RealComply is never recorded as done, and counts nothing", () => {
    const i = input({ origin: "existing_tenanted", group: "tenanted", tenancy: { beforeStages: [2, 3], moveInDate: null, moveOutDate: null } });
    const v = view(i, 2);
    assert.equal(v.finished, false);
    assert.equal(v.done, 0);
    assert.equal(v.complete, true);
  });
});

describe("PM counting", () => {
  it("counts ticks against items, leaving N/A out of the total", () => {
    const i = input({
      group: "for_lease",
      ticks: { ...allDone(1), fixed_rent: tick(), ad_pets: tick(), holding_fee: tick("na") },
    });
    const v = view(i, 2);
    assert.deepEqual([v.done, v.total, v.na], [2, 12, 1]);
    assert.equal(pmStageCountLabel(v), "2 of 12 (1 N/A)");
    assert.equal(v.oval.kind, "count");
  });

  it("an untick (open) counts as not done", () => {
    const i = input({ ticks: { mgmt_agreement: tick("open") } });
    assert.equal(view(i, 1).done, 0);
  });

  it("N/A on an item that does not offer it is ignored", () => {
    const i = input({ ticks: { mgmt_agreement: tick("na") } });
    assert.deepEqual([view(i, 1).done, view(i, 1).total], [0, 4]);
  });

  it("a stage is finished when every counted item is ticked", () => {
    const i = input({ ticks: allDone(1) });
    assert.equal(view(i, 1).finished, true);
    assert.equal(view(i, 1).oval.kind, "tick");
  });
});

describe("PM locking (enforced on the server through pmCanSetItem)", () => {
  it("Stages 2 and 3 stay locked in Onboarding even with Stage 1 done", () => {
    const i = input({ ticks: allDone(1) });
    assert.ok(view(i, 2).locked && view(i, 3).locked);
    assert.match(pmCanSetItem(i, "fixed_rent", "done")!, /locked/);
  });

  it("in For lease, Stage 2 opens and Stage 3 waits for Stage 2", () => {
    const i = input({ group: "for_lease", ticks: allDone(1) });
    assert.equal(view(i, 2).locked, false);
    assert.equal(view(i, 3).locked, true);
    assert.equal(pmCanSetItem(i, "fixed_rent", "done"), null);
    assert.match(pmCanSetItem(i, "fit_to_live", "done")!, /locked/);
  });

  it("unticking an earlier stage locks the later ones again without losing their ticks", () => {
    const ticks = { ...allDone(1, 2), fit_to_live: tick() };
    const before = input({ group: "for_lease", ticks });
    assert.equal(view(before, 3).locked, false);
    const after = input({ group: "for_lease", ticks: { ...ticks, mgmt_agreement: tick("open") } });
    assert.equal(view(after, 2).locked, true);
    assert.equal(view(after, 3).locked, true);
    assert.equal(view(after, 3).done, 1, "the tick in Stage 3 is still there");
    // And the reopened stage itself can still be worked.
    assert.equal(pmCanSetItem(after, "mgmt_agreement", "done"), null);
  });

  it("Stage 4 never blocks Stage 5", () => {
    const i = input({ group: "tenant_vacating", ticks: allDone(1, 2, 3), tenancy: { beforeStages: [], moveInDate: "2026-01-01", moveOutDate: null } });
    assert.equal(view(i, 5).locked, false);
  });

  it("Before RealComply counts as complete for locking", () => {
    const i = input({ origin: "existing_tenanted", group: "tenant_vacating", tenancy: { beforeStages: [2, 3], moveInDate: null, moveOutDate: null } });
    assert.equal(view(i, 5).locked, false);
  });

  it("refuses ticks on Before RealComply stages, unknown items, and N/A where it is not offered", () => {
    const existing = input({ origin: "existing_tenanted", group: "tenanted", tenancy: { beforeStages: [2, 3], moveInDate: null, moveOutDate: null } });
    assert.match(pmCanSetItem(existing, "fixed_rent", "done")!, /before the property came to RealComply/);
    assert.match(pmCanSetItem(existing, "mgmt_agreement", "done")!, /does not apply/);
    assert.match(pmCanSetItem(input(), "made_up", "done")!, /not on this checklist/);
    assert.match(pmCanSetItem(input(), "mgmt_agreement", "na")!, /N\/A is not offered/);
  });

  it("refuses an untick in a locked stage too", () => {
    const i = input({ group: "for_lease", ticks: { ...allDone(2), mgmt_agreement: tick("open") } });
    assert.match(pmCanSetItem(i, "fixed_rent", "open")!, /locked/);
  });
});

describe("PM moves between groups", () => {
  it("Put up for lease waits for Management onboarding", () => {
    const check = pmMoveCheck(input())!;
    assert.equal(check.move.label, "Put up for lease");
    assert.deepEqual(check.blockedBy, ["Management onboarding"]);
    assert.equal(pmBlockedLine(check.blockedBy), "Complete Management onboarding first.");
    assert.deepEqual(pmMoveCheck(input({ ticks: allDone(1) }))!.blockedBy, []);
  });

  it("Tenant has moved in waits for Stages 2 and 3, and asks for the move-in date", () => {
    const check = pmMoveCheck(input({ group: "for_lease", ticks: allDone(1) }))!;
    assert.equal(check.move.date?.field, "move_in_date");
    assert.equal(pmBlockedLine(check.blockedBy), "Complete Getting a tenant in and Money and move-in first.");
    assert.deepEqual(pmMoveCheck(input({ group: "for_lease", ticks: allDone(1, 2, 3) }))!.blockedBy, []);
  });

  it("Tenant is vacating and Tenant has moved out ask for a date and are never blocked", () => {
    const vacating = pmMoveCheck(input({ group: "tenanted", ticks: allDone(1, 2, 3) }))!;
    assert.equal(vacating.move.date?.field, "vacate_date");
    assert.deepEqual(vacating.blockedBy, []);
    const out = pmMoveCheck(input({ group: "tenant_vacating", ticks: allDone(1, 2, 3) }))!;
    assert.equal(out.move.date?.field, "move_out_date");
    assert.deepEqual(out.blockedBy, []);
  });

  it("Vacant and Archived have no Part A move", () => {
    assert.equal(pmMoveCheck(input({ group: "vacant" })), null);
    assert.equal(pmMoveCheck(input({ group: "archived" })), null);
  });
});

describe("PM dashboard card", () => {
  it("shows the stage being worked on by its count", () => {
    const s = pmCardSummary(input({ ticks: { mgmt_agreement: tick(), mgmt_copy_served: tick() } }));
    assert.equal(s.kind, "count");
    if (s.kind === "count") {
      assert.equal(s.stageTitle, "Management onboarding");
      assert.deepEqual([s.progress.done, s.progress.total], [2, 4]);
      assert.equal(s.fill, 50);
    }
  });

  it("Tenanted shows Under way; Vacant shows a tick and Vacant", () => {
    const existingT = input({ origin: "existing_tenanted", group: "tenanted", tenancy: { beforeStages: [2, 3], moveInDate: null, moveOutDate: null } });
    assert.equal(pmCardSummary(existingT).kind, "underWay");
    const existingV = input({ origin: "existing_vacant", group: "vacant", tenancy: { beforeStages: [2, 3, 5], moveInDate: null, moveOutDate: null } });
    assert.deepEqual(pmCardSummary(existingV), { kind: "tick", label: "Vacant" });
  });

  it("never hides open work: an unticked earlier stage shows instead of Under way", () => {
    const i = input({ group: "tenanted", ticks: { ...allDone(1, 2, 3), fixed_rent: tick("open") } });
    const s = pmCardSummary(i);
    assert.equal(s.kind, "count");
  });
});

describe("PM rules content", () => {
  it("item keys are unique across every stage", () => {
    const keys = PM_STAGES.flatMap((s) => s.items.map((i) => i.key));
    assert.equal(new Set(keys).size, keys.length);
  });

  it("every item has a title, a help line and a legal reference", () => {
    for (const s of PM_STAGES)
      for (const i of s.items) {
        assert.ok(i.title && i.help && i.reference, i.key);
      }
  });

  it("Part A item counts per stage match the brief (Water usage left out of Stage 3)", () => {
    assert.deepEqual(PM_STAGES.map((s) => s.items.length), [4, 13, 8, 0, 9]);
  });

  it("never says compliant", () => {
    const text = JSON.stringify(PM_STAGES).toLowerCase();
    assert.equal(text.includes("compliant"), false);
  });
});
