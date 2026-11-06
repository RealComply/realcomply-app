import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { firstYearEnds, moveDownFor } from "./move-down";

// Adam's worked example (6 Nov 2026): an office on Office 2 monthly, started
// 18 January 2026, billing on the 18th.
const started = "2026-01-18T03:00:00.000Z";
const dayBefore = (billing: string) => new Date(new Date(billing).getTime() - 20 * 3_600_000);

describe("moving down automatically (Adam, 6 Nov 2026; Terms cl 7.2)", () => {
  it("never in the first 12 months, however few the listings", () => {
    const billing = "2026-03-18T03:00:00.000Z";
    assert.deepEqual(
      moveDownFor({
        plan: "office_2",
        listingCount: 5,
        periodEnd: billing,
        startedAt: started,
        now: dayBefore(billing),
      }),
      {
        kind: "stay",
        why: "first_year",
      },
    );
  });

  it("from the first anniversary, at each billing date: Adam's table", () => {
    const rows: Array<[string, number, string]> = [
      ["2027-01-18T03:00:00.000Z", 62, "stay"],
      ["2027-02-18T03:00:00.000Z", 55, "stay"],
      ["2027-03-18T03:00:00.000Z", 47, "office_1"],
    ];
    for (const [billing, listings, expected] of rows) {
      const result = moveDownFor({
        plan: "office_2",
        listingCount: listings,
        periodEnd: billing,
        startedAt: started,
        now: dayBefore(billing),
      });
      assert.equal(result.kind === "move" ? result.to : result.kind, expected, billing);
    }
  });

  it("straight to the plan the listings fit, more than one step if need be", () => {
    const billing = "2027-05-18T03:00:00.000Z";
    assert.deepEqual(
      moveDownFor({
        plan: "office_4",
        listingCount: 30,
        periodEnd: billing,
        startedAt: started,
        now: dayBefore(billing),
      }),
      {
        kind: "move",
        to: "office_1",
      },
    );
  });

  it("never across ladders, and never up", () => {
    const billing = "2027-05-18T03:00:00.000Z";
    const office = moveDownFor({
      plan: "office_1",
      listingCount: 3,
      periodEnd: billing,
      startedAt: started,
      now: dayBefore(billing),
    });
    assert.deepEqual(office, { kind: "stay", why: "fits" });
    const over = moveDownFor({
      plan: "agent_1",
      listingCount: 90,
      periodEnd: billing,
      startedAt: started,
      now: dayBefore(billing),
    });
    assert.deepEqual(over, { kind: "stay", why: "fits" });
    const agent = moveDownFor({
      plan: "agent_3",
      listingCount: 20,
      periodEnd: billing,
      startedAt: started,
      now: dayBefore(billing),
    });
    assert.deepEqual(agent, { kind: "move", to: "agent_1" });
  });

  it("only when the billing date is within the next 26 hours (the daily run)", () => {
    const billing = "2027-03-18T03:00:00.000Z";
    const early = new Date(new Date(billing).getTime() - 3 * 86_400_000);
    assert.deepEqual(
      moveDownFor({ plan: "office_2", listingCount: 47, periodEnd: billing, startedAt: started, now: early }),
      {
        kind: "stay",
        why: "not_due",
      },
    );
    const after = new Date(new Date(billing).getTime() + 60_000);
    assert.equal(
      moveDownFor({ plan: "office_2", listingCount: 47, periodEnd: billing, startedAt: started, now: after }).kind,
      "stay",
    );
  });

  it("a yearly plan is looked at once a year, at renewal", () => {
    const renewal = "2027-01-18T03:00:00.000Z";
    assert.deepEqual(
      moveDownFor({
        plan: "office_2",
        listingCount: 40,
        periodEnd: renewal,
        startedAt: started,
        now: dayBefore(renewal),
      }),
      {
        kind: "move",
        to: "office_1",
      },
    );
  });

  it("the first year ends twelve calendar months after the start", () => {
    assert.equal(firstYearEnds(started).toISOString(), "2027-01-18T03:00:00.000Z");
  });
});
