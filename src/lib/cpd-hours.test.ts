import { test } from "node:test";
import assert from "node:assert/strict";
import { countableCpdHours, cpdYearStanding } from "@/lib/cpd-hours";
import { cpdRequirementFor } from "@/lib/rules/nsw-cpd";

const req = cpdRequirementFor("class_2", "residential_sales");
const cert = (hours: number | null, provider: string | null = "REINSW", completed_date: string | null = "2026-09-10") => ({
  hours,
  provider,
  completed_date,
});

test("only approved-provider CPD with hours and a date counts toward the year", () => {
  assert.equal(
    countableCpdHours([
      cert(3),
      cert(2, null), // no provider: office training, never CPD hours
      cert(null), // hours not stated: asked for, counts nothing yet
      cert(1, "REINSW", null), // no date yet
      { hours: 2, provider: null, completed_date: "2026-09-01", source_session_id: "s1" }, // provider-led session
    ]),
    5,
  );
});

test("one certificate short of the year: the reminder keeps going and says what's outstanding", () => {
  const s = cpdYearStanding({ records: [cert(3)], confirmedYears: [], yearStart: "2026-07-01", requirement: req });
  assert.equal(s.remind, true);
  assert.equal(s.complete, false);
  assert.match(s.outstanding ?? "", /3 of 7 hours recorded\. 4 still to go/);
});

test("CPD reminders stop for the year once it is confirmed complete", () => {
  const s = cpdYearStanding({ records: [cert(3)], confirmedYears: ["2026-07-01"], yearStart: "2026-07-01", requirement: req });
  assert.equal(s.complete, true);
  assert.equal(s.remind, false);
  assert.equal(s.outstanding, null);
});

test("and start again for the next CPD year", () => {
  const s = cpdYearStanding({ records: [], confirmedYears: ["2026-07-01"], yearStart: "2027-07-01", requirement: req });
  assert.equal(s.remind, true);
});
