import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DATE_BOX_INVALID,
  WEEKDAYS,
  addDaysIso,
  dateBoxProblem,
  inLimits,
  isoOf,
  monthGrid,
  parseAuDate,
  shiftMonth,
  showAuDate,
} from "@/lib/date-box";

// The RealComply date box: always dd/mm/yyyy, stores YYYY-MM-DD (Adam, 11 Nov 2026).

describe("reading what's typed, day first", () => {
  it("every common way of writing 4 November 2026", () => {
    for (const t of ["4/11/2026", "04/11/2026", "4-11-2026", "4.11.2026", "4 11 2026", "04112026", " 04/11/2026 ", "4/11/26", "2026-11-04"]) {
      assert.equal(parseAuDate(t), "2026-11-04", t);
    }
  });
  it("never month first: 11/04/2026 is 11 April", () => {
    assert.equal(parseAuDate("11/04/2026"), "2026-04-11");
  });
  it("not a date", () => {
    for (const t of ["", "31/02/2026", "29/02/2027", "0/1/2026", "4/13/2026", "4/11", "tomorrow", "4/11/202"]) {
      assert.equal(parseAuDate(t), null, t);
    }
    assert.equal(parseAuDate("29/02/2028"), "2028-02-29");
  });
  it("isoOf checks the date is real", () => {
    assert.equal(isoOf(2026, 2, 28), "2026-02-28");
    assert.equal(isoOf(2026, 2, 29), null);
  });
});

describe("what the box shows", () => {
  it("dd/mm/yyyy for a stored date, blank otherwise", () => {
    assert.equal(showAuDate("2026-11-04"), "04/11/2026");
    assert.equal(showAuDate(""), "");
    assert.equal(showAuDate(null), "");
    assert.equal(showAuDate("garbage"), "");
  });
});

describe("what the box says is wrong", () => {
  it("not a date, too early, too late, or fine", () => {
    assert.equal(dateBoxProblem("31/02/2026"), DATE_BOX_INVALID);
    assert.equal(dateBoxProblem("01/11/2026", { min: "2026-11-04" }), "Choose a date on or after 04/11/2026.");
    assert.equal(dateBoxProblem("05/11/2026", { max: "2026-11-04" }), "Choose a date on or before 04/11/2026.");
    assert.equal(dateBoxProblem("04/11/2026", { min: "2026-11-04", max: "2026-11-04" }), null);
    assert.equal(dateBoxProblem(""), null, "blank is for required to judge");
  });
  it("inLimits", () => {
    assert.equal(inLimits("2026-11-04", { max: "2026-11-03" }), false);
    assert.equal(inLimits("2026-11-04", { min: "2026-11-04" }), true);
    assert.equal(inLimits("2026-11-04"), true);
  });
  it("no dashes and never the word compliant", () => {
    for (const t of [DATE_BOX_INVALID, dateBoxProblem("01/01/2026", { min: "2026-02-01" }) ?? ""]) {
      assert.doesNotMatch(t, /[–—]/);
      assert.doesNotMatch(t, /compliant/i);
    }
  });
});

describe("the calendar: weeks start on Monday", () => {
  it("the headings", () => {
    assert.deepEqual([...WEEKDAYS], ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
  it("November 2026 starts on a Sunday, so its first week is 26 Oct to 1 Nov", () => {
    const grid = monthGrid(2026, 11);
    assert.equal(grid.length, 6);
    assert.ok(grid.every((w) => w.length === 7));
    assert.deepEqual(
      grid[0].map((d) => d.iso),
      ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"],
    );
    assert.equal(grid[0][6].inMonth, true);
    assert.equal(grid[0][0].inMonth, false);
    // 4 Nov 2026 is a Wednesday: third column.
    const wed = grid.flat().find((d) => d.iso === "2026-11-04");
    assert.ok(wed && grid[1].indexOf(wed) === 2);
  });
  it("a month starting on a Monday has no days before it", () => {
    assert.equal(monthGrid(2026, 6)[0][0].iso, "2026-06-01");
  });
  it("moving months and days", () => {
    assert.deepEqual(shiftMonth(2026, 12, 1), [2027, 1]);
    assert.deepEqual(shiftMonth(2026, 1, -1), [2025, 12]);
    assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
    assert.equal(addDaysIso("2026-03-01", -1), "2026-02-28");
  });
});
