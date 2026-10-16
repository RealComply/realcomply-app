import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addNswBusinessDays,
  changeConfirmation,
  changeHint,
  currentLicenseeDetails,
  fairTradingDueOn,
  fairTradingDueSentence,
  fairTradingReminder,
  historyRows,
  isNswBusinessDay,
  licenceLabel,
  LOCKED_LISTING_MESSAGE,
  newLicenseeLockCopy,
  openLineFor,
  shortDate,
  type LicenseeHistoryLine,
} from "./licensee-history";
import { formatAuTimestamp } from "@/lib/format-date";

// Licensee in charge history (0080; mockup approved by Adam, 16 Oct 2026).

const line = (over: Partial<LicenseeHistoryLine>): LicenseeHistoryLine => ({
  id: "l1",
  profile_id: "pat",
  licensee_name: "Pat Sample (made up)",
  licence_type: "class_1",
  licence_number: "20654321",
  source: "change",
  started_on: "2026-10-14",
  ended_on: null,
  ended_at: null,
  fair_trading_told_on: null,
  recorded_by: "jane",
  recorded_at: "2026-10-14T01:00:00.000Z",
  started_on_recorded_by: null,
  started_on_recorded_at: null,
  fair_trading_recorded_by: null,
  fair_trading_recorded_at: null,
  ...over,
});

describe("five business days (s31(3))", () => {
  it("matches the mockup: took over Wednesday 14 October 2026, due Wednesday 21 October", () => {
    assert.equal(fairTradingDueOn("2026-10-14"), "2026-10-21");
  });

  it("skips the weekend", () => {
    // Friday 16 Oct: Mon 19, Tue 20, Wed 21, Thu 22, Fri 23.
    assert.equal(fairTradingDueOn("2026-10-16"), "2026-10-23");
  });

  it("skips a NSW public holiday as well as the weekend: Labour Day, Monday 5 October 2026", () => {
    // Thursday 1 Oct: Fri 2, (Sat, Sun, Labour Day Mon 5), Tue 6, Wed 7, Thu 8, Fri 9.
    assert.equal(fairTradingDueOn("2026-10-01"), "2026-10-09");
    assert.ok(!isNswBusinessDay("2026-10-05"));
  });

  it("skips Christmas, Boxing Day's additional Monday and the weekend between", () => {
    // Wednesday 23 Dec 2026: Thu 24, (Fri 25, Sat, Sun, Mon 28), Tue 29, Wed 30, Thu 31,
    // (Fri 1 Jan, New Year's Day, Sat, Sun), Mon 4 Jan.
    assert.equal(addNswBusinessDays("2026-12-23", 5), "2027-01-04");
  });

  it("the Anzac Day additional Monday (27 April 2026) is not a business day", () => {
    assert.ok(!isNswBusinessDay("2026-04-27"));
    assert.ok(isNswBusinessDay("2026-04-28"));
  });
});

describe("the Fair Trading reminder", () => {
  it("shows for a change with no date, due 5 business days on, amber until the due date", () => {
    const r = fairTradingReminder(line({}), "2026-10-21");
    assert.deepEqual(r, { dueOn: "2026-10-21", startedOn: "2026-10-14", overdue: false });
    assert.equal(
      fairTradingDueSentence(r!),
      "Due 21 October 2026, 5 business days after you took over on 14 October.",
    );
  });

  it("turns red after the due date", () => {
    assert.equal(fairTradingReminder(line({}), "2026-10-22")?.overdue, true);
  });

  it("goes once a date is recorded", () => {
    assert.equal(fairTradingReminder(line({ fair_trading_told_on: "2026-10-20" }), "2026-10-22"), null);
  });

  it("never for a backfilled or first line, or a line that has ended", () => {
    assert.equal(fairTradingReminder(line({ source: "backfill", started_on: null }), "2026-10-22"), null);
    assert.equal(fairTradingReminder(line({ source: "first" }), "2026-10-22"), null);
    assert.equal(fairTradingReminder(line({ ended_at: "2026-10-20T00:00:00Z", ended_on: "2026-10-19" }), "2026-10-22"), null);
  });

  it("the role given on Team reminds too", () => {
    assert.ok(fairTradingReminder(line({ source: "team" }), "2026-10-15"));
  });

  it("names the year when the change and the due date fall in different years", () => {
    assert.equal(
      fairTradingDueSentence({ startedOn: "2026-12-23", dueOn: "2027-01-04" }),
      "Due 4 January 2027, 5 business days after you took over on 23 December 2026.",
    );
  });
});

describe("the card and the history", () => {
  it("the card's line: licence, since, Fair Trading told", () => {
    assert.equal(
      currentLicenseeDetails(line({ fair_trading_told_on: "2026-10-16" })),
      "Class 1 licence 20654321 · since 14 October 2026 · Fair Trading told 16 October 2026",
    );
    assert.equal(
      currentLicenseeDetails(line({ source: "backfill", started_on: null })),
      "Class 1 licence 20654321 · since: Not recorded · Fair Trading told: Not recorded",
    );
  });

  it("licence labels", () => {
    assert.equal(licenceLabel("class_2", "1"), "Class 2 licence 1");
    assert.equal(licenceLabel(null, "123"), "Licence 123");
    assert.equal(licenceLabel(null, null), null);
  });

  it("short dates as the mockup shows them", () => {
    assert.equal(shortDate("2025-02-03"), "3 Feb 2025");
    assert.equal(shortDate("2026-05-01"), "1 May 2026");
  });

  it("the history: newest first, Now for the current one, who recorded each line and when", () => {
    const rows = historyRows(
      [
        line({ id: "old", profile_id: "jane", licensee_name: "Jane Citizen (made up)", source: "backfill", started_on: null,
               ended_on: "2026-10-13", ended_at: "2026-10-14T01:00:00Z", recorded_by: null, recorded_at: "2026-10-01T00:00:00Z" }),
        line({ id: "new" }),
      ],
      { jane: "Jane Citizen (made up)" },
      formatAuTimestamp,
    );
    assert.deepEqual(rows.map((r) => [r.id, r.from, r.to, r.fairTradingTold]), [
      ["new", "14 Oct 2026", "Now", "Not recorded"],
      ["old", "Not recorded", "13 Oct 2026", "Not recorded"],
    ]);
    assert.equal(rows[0].recorded, "Recorded by Jane Citizen (made up) on 14 October 2026.");
    assert.equal(rows[1].recorded, "Recorded by RealComply on 1 October 2026.");
  });

  it("newest first even when the oldest line, backfilled, has no start date", () => {
    // Jane backfilled (no start, ended 30 Sep), Pat 1 to 13 Oct, Jane again from 14 Oct.
    const rows = historyRows(
      [
        line({ id: "jane-old", profile_id: "jane", source: "backfill", started_on: null, ended_on: "2026-09-30",
               ended_at: "2026-10-16T03:30:00Z", recorded_by: null, recorded_at: "2026-10-16T03:27:00Z" }),
        line({ id: "pat", started_on: "2026-10-01", ended_on: "2026-10-13", ended_at: "2026-10-16T03:40:00Z",
               recorded_at: "2026-10-16T03:30:00Z" }),
        line({ id: "jane-now", profile_id: "jane", started_on: "2026-10-14", recorded_at: "2026-10-16T03:40:00Z" }),
      ],
      {},
      formatAuTimestamp,
    );
    assert.deepEqual(rows.map((r) => r.id), ["jane-now", "pat", "jane-old"]);
  });

  it("a date filled in later says who added it and when", () => {
    const [row] = historyRows(
      [line({ fair_trading_told_on: "2026-10-16", fair_trading_recorded_by: "pat", fair_trading_recorded_at: "2026-10-16T02:00:00Z" })],
      { jane: "Jane Citizen (made up)", pat: "Pat Sample (made up)" },
      formatAuTimestamp,
    );
    assert.equal(
      row.recorded,
      "Recorded by Jane Citizen (made up) on 14 October 2026. Fair Trading date added by Pat Sample (made up) on 16 October 2026.",
    );
  });

  it("finds a person's open line", () => {
    const lines = [line({ id: "a", profile_id: "jane", ended_at: "2026-10-14T00:00:00Z", ended_on: "2026-10-13" }), line({ id: "b" })];
    assert.equal(openLineFor(lines, "pat")?.id, "b");
    assert.equal(openLineFor(lines, "jane"), null);
  });

  it("the change form's words", () => {
    assert.equal(
      changeConfirmation("Pat Sample"),
      "Pat Sample becomes licensee in charge and takes over sign-offs, billing and the annexure. You stay on the team as an agent.",
    );
    assert.equal(
      changeHint("2026-10-14"),
      "Tell Fair Trading within 5 business days. We'll remind the new licensee if this is blank by 21 October 2026.",
    );
    assert.equal(changeHint(null), "Tell Fair Trading within 5 business days.");
  });

  it("no em dashes in anything shown", () => {
    const all = [changeConfirmation("X"), changeHint("2026-10-14"), currentLicenseeDetails(line({}))].join(" ");
    assert.ok(!all.includes("—"));
  });
});

describe("the new-listing lock after a change", () => {
  it("the new licensee is asked to read and adopt", () => {
    const copy = newLicenseeLockCopy({ isLicensee: true }, "Pat Sample (made up)");
    assert.equal(copy.pill, "Waiting on the annexure");
    assert.equal(copy.action, "read_and_adopt");
    assert.match(copy.text, /Existing listings carry on as normal\.$/);
  });

  it("an agent is told who it's waiting on, and has nothing to press", () => {
    const copy = newLicenseeLockCopy({ isLicensee: false }, "Pat Sample (made up)");
    assert.equal(copy.pill, "Waiting on your licensee");
    assert.equal(copy.action, null);
    assert.ok(copy.text.startsWith("Waiting on Pat Sample (made up), your new licensee in charge,"));
    assert.ok(newLicenseeLockCopy({ isLicensee: false }, null).text.startsWith("Waiting on your new licensee in charge"));
  });

  it("the refusal is the database's own words, and no em dashes", () => {
    assert.equal(
      LOCKED_LISTING_MESSAGE,
      "New listings can be added once your licensee in charge has adopted RealComply's annexure.",
    );
    const all = [true, false].map((isLicensee) => newLicenseeLockCopy({ isLicensee }, "X").text).join(" ");
    assert.ok(!all.includes("—"));
  });
});
