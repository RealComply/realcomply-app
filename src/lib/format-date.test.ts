import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatAuDate,
  formatAuDateTime,
  formatAuDateTimeShort,
  formatAuDayMonth,
  formatAuDayMonthTime,
  formatAuMediumDate,
  formatAuShortDate,
  formatAuTime,
  formatAuTimestamp,
  formatSydney,
  sydneyDate,
} from "@/lib/format-date";

// Every date in Australian format and Sydney time (Adam, 11 Nov 2026),
// whatever the runtime's own setting. These run with TZ and LANG as CI has
// them; the guard test (format-date-guard.test.ts) keeps every other file on
// these functions.

// 9:15 pm on 3 Nov in UTC is 8:15 am on 4 Nov in Sydney (AEDT, UTC+11).
const MORNING_IN_SYDNEY = "2026-11-03T21:15:00Z";

describe("short dates: dd/mm/yyyy", () => {
  it("a stored calendar date", () => {
    assert.equal(formatAuShortDate("2026-11-04"), "04/11/2026");
    assert.equal(formatAuShortDate("2026-01-09"), "09/01/2026");
  });
  it("an instant, on its Sydney day, never the UTC or US one", () => {
    assert.equal(formatAuShortDate(MORNING_IN_SYDNEY), "04/11/2026");
    assert.equal(formatAuShortDate(new Date(MORNING_IN_SYDNEY)), "04/11/2026");
  });
  it("nothing, or not a date", () => {
    assert.equal(formatAuShortDate(null), "");
    assert.equal(formatAuShortDate(""), "");
    assert.equal(formatAuShortDate("not a date"), "not a date");
  });
});

describe("written dates stay as they were", () => {
  it("4 November 2026", () => {
    assert.equal(formatAuDate("2026-11-04"), "4 November 2026");
    assert.equal(formatAuTimestamp(MORNING_IN_SYDNEY), "4 November 2026");
    assert.equal(formatSydney("2026-11-04", { day: "numeric", month: "long", year: "numeric" }), "4 November 2026");
  });
  it("with a weekday, and short months", () => {
    assert.equal(formatSydney("2026-11-04", { weekday: "long", day: "numeric", month: "long" }), "Wednesday 4 November");
    assert.equal(formatAuMediumDate("2026-11-04"), "4 Nov 2026");
  });
  it("a calendar date never slips a day, either side of daylight saving", () => {
    for (const d of ["2026-04-05", "2026-10-04", "2026-12-31", "2027-01-01"]) {
      assert.equal(sydneyDate(new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)), 2))), d);
      assert.equal(formatAuShortDate(d), `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`);
    }
  });
});

describe("times are Sydney's", () => {
  it("2:15 pm style, plain spaces", () => {
    assert.equal(formatAuTime("2026-11-04T03:15:00Z"), "2:15 pm");
    assert.equal(formatAuDateTime("2026-11-04T03:15:00Z"), "4 November 2026, 2:15 pm");
    assert.equal(formatAuDateTimeShort("2026-11-04T03:15:00Z"), "4 Nov 2026, 2:15 pm");
    assert.equal(formatAuDayMonthTime("2026-11-04T03:15:00Z"), "4 Nov, 2:15 pm");
    assert.equal(formatAuDayMonth("2026-11-04T03:15:00Z", new Date("2026-11-11T00:00:00Z")), "4 Nov");
  });
  it("sydneyDate is the Sydney day, as YYYY-MM-DD", () => {
    assert.equal(sydneyDate(new Date(MORNING_IN_SYDNEY)), "2026-11-04");
  });
});
