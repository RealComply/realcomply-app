import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanModeAt, sydneyHour } from "./listing-scan-schedule";

// Each instant is a cron firing (20:00 or 21:00 UTC). Only the one that is
// 7am in Sydney does anything; the label is the Sydney date of that 7am.
const at = (iso: string) => new Date(iso);

describe("scanModeAt", () => {
  it("runs the weekly check every Monday at 7am Sydney until 31 October", () => {
    for (const iso of ["2026-10-11T20:00:00Z", "2026-10-18T20:00:00Z", "2026-10-25T20:00:00Z"]) {
      assert.equal(sydneyHour(at(iso)), 7, iso);
      assert.equal(scanModeAt(at(iso)), "weekly", iso);
    }
  });

  it("only finds pages on the other mornings before 1 November", () => {
    // Fri 9, Tue 13, Sun 25, Sat 31 October.
    for (const iso of ["2026-10-08T20:00:00Z", "2026-10-12T20:00:00Z", "2026-10-24T20:00:00Z", "2026-10-30T20:00:00Z"]) {
      assert.equal(sydneyHour(at(iso)), 7, iso);
      assert.equal(scanModeAt(at(iso)), "discovery", iso);
    }
  });

  it("switches to the daily check on Sunday 1 November and stays there, Mondays included", () => {
    // Sun 1 Nov, Mon 2 Nov, Mon 9 Nov 2026; Mon 3 May 2027 (no daylight saving: 21:00 UTC).
    for (const iso of ["2026-10-31T20:00:00Z", "2026-11-01T20:00:00Z", "2026-11-08T20:00:00Z", "2027-05-02T21:00:00Z"]) {
      assert.equal(sydneyHour(at(iso)), 7, iso);
      assert.equal(scanModeAt(at(iso)), "daily", iso);
    }
  });
});
