import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAuDayMonth } from "./format-date";

describe("formatAuDayMonth", () => {
  const now = new Date("2026-10-27T00:00:00Z");

  it("gives the Sydney day and short month, without the year this year", () => {
    assert.equal(formatAuDayMonth("2026-10-26T03:00:00Z", now), "26 Oct");
  });

  it("uses the Sydney day, not the UTC one", () => {
    // 10:30 pm UTC on the 25th is 9:30 am on the 26th in Sydney.
    assert.equal(formatAuDayMonth("2026-10-25T22:30:00Z", now), "26 Oct");
  });

  it("adds the year when it isn't this year", () => {
    assert.equal(formatAuDayMonth("2025-12-31T03:00:00Z", now), "31 Dec 2025");
  });

  it("gives nothing for nothing, and leaves an unreadable value as it is", () => {
    assert.equal(formatAuDayMonth(null, now), "");
    assert.equal(formatAuDayMonth("not a date", now), "not a date");
  });
});
