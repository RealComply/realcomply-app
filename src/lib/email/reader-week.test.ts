import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { exampleReaderWeek, readerWeekEmail, readerWeekFrom } from "@/lib/email/reader-week";
import { renderEmailText } from "@/lib/email/layout";

// Adam's weekly staff email: reads done, reads failed, and comparable-sales
// reports with 0 comparables, for the week (Adam, 1 Nov 2026). Made-up
// offices and listings only.

const NOW = new Date("2026-11-01T21:00:00Z"); // Monday 8am in Sydney
type Row = Parameters<typeof readerWeekFrom>[0][number];
const row = (r: Partial<Row>): Row => ({
  agency_id: "o1",
  property_id: "p1",
  reader: "contract",
  outcome: "read",
  why: null,
  sales: null,
  read_at: "2026-10-30T01:00:00Z",
  ...r,
});

describe("the week's reads", () => {
  it("counts reads done, failed and why, and the comparable-sales reports with 0 comparables", () => {
    const week = readerWeekFrom(
      [
        row({}),
        row({ reader: "comparable_sales", sales: 27 }),
        row({ reader: "comparable_sales", outcome: "nothing_found", sales: 0, property_id: "p2" }),
        row({ reader: "comparable_sales", outcome: "wrong_document", sales: 0, property_id: "p3" }),
        row({ reader: "comparable_sales", outcome: "failed", why: "cut_off" }),
        row({ reader: "cpd_certificate", property_id: null, outcome: "failed", why: "service" }),
        row({ reader: "cpd_certificate", property_id: null, outcome: "failed", why: "service" }),
      ],
      NOW,
      (r) => ({ office: "Sample Realty (made up)", listing: `Listing ${r.property_id}` }),
    );
    assert.equal(week.weekTo, "2026-11-01");
    assert.equal(week.done, 7);
    assert.equal(week.failed, 3);
    assert.deepEqual(week.byReader, [
      { reader: "comparable_sales", done: 4, failed: 1 },
      { reader: "cpd_certificate", done: 2, failed: 2 },
      { reader: "contract", done: 1, failed: 0 },
    ]);
    assert.deepEqual(week.failedBecause, [{ why: "service", n: 2 }, { why: "cut_off", n: 1 }]);
    assert.deepEqual(week.zeroComparables.map((z) => z.listing), ["Listing p2", "Listing p3"], "a failed read isn't one of these");
  });

  it("is an email to Adam that says all three, in plain words", () => {
    const { subject, doc } = readerWeekEmail(exampleReaderWeek(NOW));
    assert.equal(subject, "RealComply staff: document reads, week to 1 November 2026");
    const text = renderEmailText(doc);
    for (const part of [
      "42", "documents read in the 7 days to 1 November 2026",
      "2", "reads failed",
      "1", "comparable-sales report gave 0 comparables",
      "Comparable-sales report", "12 reads, 1 failed",
      "Cut off at the length limit",
      "12 Sample Street, Testville NSW 2999", "Sample Realty (made up)",
    ]) {
      assert.ok(text.includes(part), `the email says ${part}`);
    }
    assert.ok(!/[—–]/.test(subject + text), "no dashes");
    assert.ok(!text.includes("compliant"));
    assert.match(readerWeekEmail(exampleReaderWeek(NOW), { test: true }).subject, /^\[Test\] /);
  });

  it("a quiet week says so", () => {
    const { doc } = readerWeekEmail(readerWeekFrom([], NOW, () => ({ office: "", listing: "" })));
    assert.ok(renderEmailText(doc).includes("No documents were read this week."));
  });
});
