import { test } from "node:test";
import assert from "node:assert/strict";
import { attendanceChanges } from "@/lib/attendance-changes";

test("saving attendance unchanged touches nobody's rows", () => {
  const c = attendanceChanges({ recorded: ["a", "b"], withCpd: ["a", "b"], wanted: ["a", "b"] });
  assert.deepEqual(c, { unticked: [], ticked: [], needCpd: [] });
});

test("adding a latecomer adds only the latecomer", () => {
  const c = attendanceChanges({ recorded: ["a", "b"], withCpd: ["a", "b"], wanted: ["a", "b", "c"] });
  assert.deepEqual(c, { unticked: [], ticked: ["c"], needCpd: ["c"] });
});

test("unticking someone removes only them", () => {
  const c = attendanceChanges({ recorded: ["a", "b"], withCpd: ["a", "b"], wanted: ["a"] });
  assert.deepEqual(c, { unticked: ["b"], ticked: [], needCpd: [] });
});

test("a session CPD record the licensee deleted is not put back by a later save", () => {
  // b's record was deleted (logged); the licensee then adds latecomer c.
  const c = attendanceChanges({ recorded: ["a", "b"], withCpd: ["a"], wanted: ["a", "b", "c"] });
  assert.deepEqual(c, { unticked: [], ticked: ["c"], needCpd: ["c"] });
});

test("someone unticked and ticked again gets session CPD again", () => {
  const off = attendanceChanges({ recorded: ["a", "b"], withCpd: ["a", "b"], wanted: ["a"] });
  assert.deepEqual(off.unticked, ["b"]);
  const on = attendanceChanges({ recorded: ["a"], withCpd: ["a"], wanted: ["a", "b"] });
  assert.deepEqual(on, { unticked: [], ticked: ["b"], needCpd: ["b"] });
});

test("unticking everyone removes everyone", () => {
  const c = attendanceChanges({ recorded: ["a", "b"], withCpd: ["a"], wanted: [] });
  assert.deepEqual(c, { unticked: ["a", "b"], ticked: [], needCpd: [] });
});

test("a box sent twice is one attendee", () => {
  const c = attendanceChanges({ recorded: [], withCpd: [], wanted: ["a", "a"] });
  assert.deepEqual(c, { unticked: [], ticked: ["a"], needCpd: ["a"] });
});
