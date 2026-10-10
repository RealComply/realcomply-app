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

test("an attendee whose session CPD write failed gets it on the next save", () => {
  const c = attendanceChanges({ recorded: ["a", "b"], withCpd: ["a"], wanted: ["a", "b"] });
  assert.deepEqual(c, { unticked: [], ticked: [], needCpd: ["b"] });
});

test("unticking everyone removes everyone", () => {
  const c = attendanceChanges({ recorded: ["a", "b"], withCpd: ["a"], wanted: [] });
  assert.deepEqual(c, { unticked: ["a", "b"], ticked: [], needCpd: [] });
});

test("a box sent twice is one attendee", () => {
  const c = attendanceChanges({ recorded: [], withCpd: [], wanted: ["a", "a"] });
  assert.deepEqual(c, { unticked: [], ticked: ["a"], needCpd: ["a"] });
});
