import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { activityDeleteAfter, daysLeft, deletionDate, onOrAfter, reminderDate, sydneyDate } from "./dates";

describe("subscription end dates", () => {
  it("counts in Sydney days: 8 Oct ends, 15 Oct reminds, 22 Oct deletes", () => {
    const ended = new Date("2026-10-08T05:00:00Z"); // 4pm Sydney
    assert.equal(sydneyDate(ended), "2026-10-08");
    assert.equal(reminderDate(ended), "2026-10-15");
    assert.equal(deletionDate(ended), "2026-10-22");
  });

  it("uses the Sydney date, not the UTC one, late in the Sydney evening", () => {
    // 11:30pm on 8 Oct in UTC is already 9 Oct in Sydney.
    const ended = new Date("2026-10-08T23:30:00Z");
    assert.equal(deletionDate(ended), "2026-10-23");
  });

  it("shows 14 days left on the day it ends and 0 on the deletion date", () => {
    const ended = new Date("2026-10-08T05:00:00Z");
    assert.equal(daysLeft(ended, ended), 14);
    assert.equal(daysLeft(ended, new Date("2026-10-21T13:00:00Z")), 0); // 22 Oct, Sydney
  });

  it("is due on the deletion date and not the day before", () => {
    const ended = new Date("2026-10-08T05:00:00Z");
    const due = deletionDate(ended);
    assert.equal(onOrAfter(due, new Date("2026-10-21T12:00:00Z")), false); // 21 Oct 11pm Sydney
    assert.equal(onOrAfter(due, new Date("2026-10-21T15:00:00Z")), true); // 22 Oct 2am Sydney
  });

  it("keeps the activity record for 7 years from the end", () => {
    assert.equal(activityDeleteAfter(new Date("2026-10-08T05:00:00Z")), "2033-10-08");
  });
});
