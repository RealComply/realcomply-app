import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { complaintTiles, daysSaid, targetDaysProblem } from "@/lib/complaint-tiles";

// The Complaints register tiles (Master, 10 Nov 2026: "clearer tile labels
// with 'Change' for the licensee") and the dash taken out of "Agency-level
// records the licensee must keep".

describe("the complaints tiles say what they count", () => {
  it("in words, with the days written out", () => {
    const tiles = complaintTiles({ open: 2, resolved: 5, overdue: 1, oldestOpenDays: 41, targetDays: 30 });
    assert.deepEqual(
      tiles.map((t) => [t.value, t.label, t.hint]),
      [
        ["2", "Open", "Not yet resolved"],
        ["5", "Resolved", "Resolved to date"],
        ["1", "Overdue", "Open longer than 30 days"],
        ["41 days", "Oldest open", "Since it was received"],
        ["30 days", "Resolution target", "To resolve a complaint, from the day it's received"],
      ],
    );
    assert.deepEqual(tiles.map((t) => t.tone), ["bad", "ok", "bad", "plain", "plain"]);
  });

  it("with nothing open, says so rather than 0d", () => {
    const tiles = complaintTiles({ open: 0, resolved: 3, overdue: 0, oldestOpenDays: 0, targetDays: 1 });
    const oldest = tiles.find((t) => t.key === "oldest");
    assert.equal(oldest?.value, "None");
    assert.equal(oldest?.hint, "No complaint open");
    assert.equal(tiles.find((t) => t.key === "overdue")?.tone, "ok");
    assert.equal(tiles.find((t) => t.key === "overdue")?.hint, "Open longer than 1 day");
    assert.ok(tiles.every((t) => !/\dd\b/.test(t.value)), "no bare 'd' for days");
  });

  it("days in words", () => {
    assert.equal(daysSaid(1), "1 day");
    assert.equal(daysSaid(14), "14 days");
  });
});

describe("the licensee changes the resolution target", () => {
  it("a whole number of days, 1 to 365", () => {
    for (const ok of ["1", "30", " 45 ", "365"]) assert.equal(targetDaysProblem(ok), null, ok);
    for (const bad of ["", "0", "366", "-5", "2.5", "30 days", "abc"]) {
      assert.equal(targetDaysProblem(bad), "Give the target as a whole number of days, 1 to 365.", bad);
    }
  });

  it("only the licensee in charge, in the server action too", () => {
    const src = readFileSync(new URL("./actions/registers.ts", import.meta.url), "utf8");
    const start = src.indexOf("export async function setComplaintTargetDays(");
    const body = src.slice(start, src.indexOf("\nexport ", start + 1));
    assert.match(body, /if \(!access\.officeLicensee\) return/);
    assert.match(body, /targetDaysProblem\(daysTyped\)/);
  });
});

describe("the registers page heading", () => {
  it("has no em dash", () => {
    const src = readFileSync(new URL("../app/dashboard/registers/page.tsx", import.meta.url), "utf8");
    assert.ok(src.includes("Agency-level records the licensee must keep. CPD year ${cpdYear.label}."));
    assert.ok(!/Agency-level records the licensee must keep —/.test(src));
  });
});
