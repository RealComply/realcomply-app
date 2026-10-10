import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PM_STAGES, pmStage, type PmGroup, type PmOrigin } from "./nsw-pm";
import {
  pmBlockedLine,
  pmCanAnswerWater,
  pmCanRecord,
  pmCanSetItem,
  pmCardSummary,
  pmMoveCheck,
  pmMoveChecks,
  pmOutgoing,
  pmStageCountLabel,
  pmStageItems,
  pmStageViews,
  pmTenancyFiled,
  type PmEngineInput,
  type PmTenancyInput,
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
  const first = (i: PmEngineInput) => pmMoveChecks(i)[0];

  it("Put up for lease waits for Management onboarding", () => {
    const check = first(input());
    assert.equal(check.move.label, "Put up for lease");
    assert.deepEqual(check.blockedBy, ["Management onboarding"]);
    assert.equal(check.line, "Complete Management onboarding first.");
    assert.equal(pmBlockedLine(check.blockedBy), "Complete Management onboarding first.");
    assert.equal(first(input({ ticks: allDone(1) })).line, "");
  });

  it("Tenant has moved in waits for Stages 2 and 3, and asks for the move-in date", () => {
    const check = first(input({ group: "for_lease", ticks: allDone(1) }));
    assert.equal(check.move.date?.field, "move_in_date");
    assert.equal(check.line, "Complete Getting a tenant in and Money and move-in first.");
    assert.equal(first(input({ group: "for_lease", ticks: allDone(1, 2, 3) })).line, "");
  });

  it("Tenant is vacating asks for the date and who is ending it, and is never blocked", () => {
    const vacating = first(input({ group: "tenanted", ticks: allDone(1, 2, 3) }));
    assert.equal(vacating.move.asks, "vacating");
    assert.equal(vacating.move.date?.field, "vacate_date");
    assert.equal(vacating.line, "");
  });

  it("Tenant vacating offers Tenant has moved out, then Put up for lease now", () => {
    const checks = pmMoveChecks(input({ group: "tenant_vacating", ticks: allDone(1, 2, 3) }));
    assert.deepEqual(checks.map((c) => c.move.label), ["Tenant has moved out", "Put up for lease now"]);
    assert.equal(checks[0].move.date?.field, "move_out_date");
    assert.equal(checks[1].move.newTenancy, true);
    assert.ok(checks.every((c) => c.line === ""));
  });

  it("Vacant offers Put back up for lease and Management has ended; Archived offers nothing", () => {
    const checks = pmMoveChecks(input({ group: "vacant" }));
    assert.deepEqual(checks.map((c) => c.move.label), ["Put back up for lease", "Management has ended"]);
    assert.equal(checks[1].move.asks, "managementEnded");
    assert.deepEqual(pmMoveChecks(input({ group: "archived" })), []);
  });

  it("pmMoveCheck finds one move by its key, only from the right group", () => {
    assert.equal(pmMoveCheck(input({ group: "vacant" }), "management_ended")?.move.to, "archived");
    assert.equal(pmMoveCheck(input({ group: "tenanted" }), "management_ended"), null);
  });
});

describe("PM Part B: who ended the tenancy (brief B1)", () => {
  const vacating = (tenancy: Partial<PmTenancyInput>, ticks: Record<string, PmTick> = {}) =>
    input({
      group: "tenant_vacating",
      ticks: { ...allDone(1, 2, 3), ...ticks },
      tenancy: { beforeStages: [], moveInDate: "2026-01-01", moveOutDate: null, ...tenancy },
    });
  const items = (i: PmEngineInput) => pmStageItems(pmStage(5), i.tenancy);
  const exitItem = (i: PmEngineInput, key: string) => items(i).find((x) => x.key === key)!;

  it("the tenant ending it marks the three termination items and the exclusion N/A, noted Tenant ended it", () => {
    const i = vacating({ endedBy: "tenant" });
    for (const key of ["termination_ground", "notice_period", "termination_statement", "reletting_exclusion"]) {
      assert.equal(exitItem(i, key).auto?.note, "Tenant ended it", key);
    }
    const v = view(i, 5);
    assert.deepEqual([v.done, v.total, v.na], [0, 5, 4]);
    assert.match(pmCanSetItem(i, "termination_ground", "done")!, /marked that N\/A/);
    assert.equal(pmCanSetItem(i, "final_inspection", "done"), null);
  });

  it("the landlord ending it on Renovation words each item for the ground", () => {
    const i = vacating({ endedBy: "landlord", ground: "renovation" });
    assert.equal(exitItem(i, "termination_ground").title, "Termination notice given to the tenant");
    assert.equal(exitItem(i, "termination_ground").help, "In writing and signed, on the ground: Renovation");
    assert.equal(exitItem(i, "notice_period").help, "Minimum notice: 90 days, or 60 if the fixed term is 6 months or less");
    assert.equal(
      exitItem(i, "termination_statement").help,
      "The termination information statement, plus the landlord's signed statement on the works and why the property must be vacant",
    );
    assert.equal(
      exitItem(i, "reletting_exclusion").help,
      "Cannot be re-let for 4 weeks after the termination date, without Fair Trading approval",
    );
    // No N/A once the landlord has ended it on a ground.
    assert.match(pmCanSetItem(i, "notice_period", "na")!, /N\/A is not offered/);
    const v = view(i, 5);
    assert.deepEqual([v.done, v.total, v.na], [0, 9, 0]);
  });

  it("a ground with no exclusion period marks the exclusion N/A", () => {
    for (const ground of ["sold_vacant_possession", "breach"] as const) {
      const i = vacating({ endedBy: "landlord", ground });
      assert.equal(exitItem(i, "reletting_exclusion").auto?.note, "No exclusion period for this ground", ground);
    }
    assert.equal(exitItem(vacating({ endedBy: "landlord", ground: "breach" }), "termination_statement").help, "The termination information statement");
    assert.equal(exitItem(vacating({ endedBy: "landlord", ground: "sold_vacant_possession" }), "notice_period").help, "Minimum notice: 30 days");
  });

  it("Another listed ground leaves the exclusion for the agent, with N/A offered", () => {
    const i = vacating({ endedBy: "landlord", ground: "other_ground" });
    assert.equal(exitItem(i, "reletting_exclusion").auto, null);
    assert.equal(exitItem(i, "reletting_exclusion").naAllowed, true);
    assert.equal(exitItem(i, "notice_period").help, "Minimum notice: the minimum for that ground");
  });

  it("a tenancy recorded before this was asked keeps the fallback wording and N/A", () => {
    const i = vacating({});
    assert.equal(exitItem(i, "termination_ground").auto, null);
    assert.equal(pmCanSetItem(i, "termination_ground", "na"), null);
  });
});

describe("PM Part B: re-leasing and the outgoing tenant (brief B2)", () => {
  const oldTenancy: PmTenancyInput = { seq: 1, beforeStages: [], moveInDate: "2025-01-01", moveOutDate: null, endedBy: "tenant" };
  const newTenancy: PmTenancyInput = { seq: 2, beforeStages: [], moveInDate: null, moveOutDate: null };
  const exitDone = { final_inspection: tick(), bond_claim: tick(), exit_survey: tick(), dv_termination: tick("na"), tenancy_db_listing: tick("na") };
  const releasing = (oldOver: Partial<PmTenancyInput> = {}, oldTicks: Record<string, PmTick> = {}, ticks: Record<string, PmTick> = {}) =>
    input({
      group: "for_lease",
      tenancy: newTenancy,
      ticks: { ...allDone(1), ...ticks },
      previous: [{ tenancyId: "t1", tenancy: { ...oldTenancy, ...oldOver }, ticks: oldTicks }],
    });

  it("Stage 1 is not shown again once the property has had a tenancy", () => {
    assert.deepEqual(pmStageViews(releasing()).map((v) => v.stage), [2, 3, 4, 5]);
    assert.equal(view(releasing(), 2).locked, false, "Stage 2 opens for the new tenant");
  });

  it("the old tenant's unfinished Exit shows as an outgoing section, never locked", () => {
    const out = pmOutgoing(releasing());
    assert.equal(out.length, 1);
    assert.equal(out[0].movedOut, false);
    assert.equal(pmCanSetItem(releasing(), "final_inspection", "done", "t1"), null);
    assert.match(pmCanSetItem(releasing(), "fixed_rent", "done", "t1")!, /Only the Exit items/);
  });

  it("the new tenant cannot move in until the outgoing tenant has moved out", () => {
    const ready = releasing({}, {}, allDone(2, 3));
    assert.equal(pmMoveChecks(ready)[0].line, "The outgoing tenant has to move out first.");
    const out = releasing({ moveOutDate: "2026-10-01" }, {}, allDone(2, 3));
    assert.equal(pmMoveChecks(out)[0].line, "");
  });

  it("an outgoing tenancy is filed once it has moved out and its Exit is complete", () => {
    assert.equal(pmTenancyFiled({ ...oldTenancy, moveOutDate: "2026-10-01" }, exitDone), true);
    assert.equal(pmTenancyFiled(oldTenancy, exitDone), false, "not moved out yet");
    assert.equal(pmTenancyFiled({ ...oldTenancy, moveOutDate: "2026-10-01" }, {}), false, "Exit still open");
    assert.equal(pmOutgoing(releasing({ moveOutDate: "2026-10-01" }, exitDone)).length, 0);
    assert.match(pmCanSetItem(releasing({ moveOutDate: "2026-10-01" }, exitDone), "final_inspection", "open", "t1")!, /filed/);
  });

  it("an existing vacant property's first tenancy is filed straight away (its Exit was before RealComply)", () => {
    assert.equal(pmTenancyFiled({ seq: 1, beforeStages: [2, 3, 5], moveInDate: null, moveOutDate: null }, {}), true);
  });
});

describe("PM Part B: water usage and records", () => {
  it("water usage is one Stage 3 item, answered not ticked", () => {
    const i = input({ group: "for_lease", ticks: allDone(1, 2) });
    assert.match(pmCanSetItem(i, "water_usage", "done")!, /water usage questions/);
    assert.equal(pmCanAnswerWater(i), null);
    assert.match(pmCanAnswerWater(input({ group: "for_lease", ticks: allDone(1) }))!, /locked/);
    const almost = input({ group: "for_lease", ticks: allDone(1, 2, 3) });
    assert.equal(view(almost, 3).finished, true);
    const { water_usage: _w, ...rest } = allDone(1, 2, 3);
    void _w;
    assert.equal(view(input({ group: "for_lease", ticks: rest }), 3).finished, false, "an open water item holds Stage 3");
  });

  it("a pet on the application follows Stage 2's lock; Stage 4 records run from move-in to move-out", () => {
    assert.match(pmCanRecord(input({ ticks: allDone(1) }), "pet_application")!, /locked/);
    assert.equal(pmCanRecord(input({ group: "for_lease", ticks: allDone(1) }), "pet_application"), null);
    assert.match(pmCanRecord(input({ group: "for_lease" }), "ongoing")!, /while the tenant is in/);
    assert.equal(pmCanRecord(input({ group: "tenanted", ticks: allDone(1, 2, 3) }), "ongoing"), null);
    const movedOut = input({ group: "vacant", tenancy: { beforeStages: [], moveInDate: "2026-01-01", moveOutDate: "2026-09-01" } });
    assert.match(pmCanRecord(movedOut, "ongoing")!, /while the tenant is in/);
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

  it("item counts per stage match the brief (Water usage in Stage 3 from Part B)", () => {
    assert.deepEqual(PM_STAGES.map((s) => s.items.length), [4, 13, 9, 0, 9]);
  });

  it("never says compliant", () => {
    const text = JSON.stringify(PM_STAGES).toLowerCase();
    assert.equal(text.includes("compliant"), false);
  });
});
