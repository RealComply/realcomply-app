import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readerAlertEmail } from "@/lib/email/reader-alert";
import type { ReaderAlert } from "@/lib/documents/read-record";

// Adam's same-day alert (1 Nov 2026): office, listing, card and file name.
// Made-up offices, listings and files only.

const base: ReaderAlert = {
  reader: "comparable_sales",
  card: "ESP and comparable sales (a4)",
  fileName: "CMA 12 Sample Street.pdf",
  office: "Sample Realty (made up)",
  listing: "12 Sample Street, Testville NSW 2999",
  outcome: "failed",
  why: "cut_off",
  sales: 0,
  at: new Date("2026-11-01T22:14:00Z"),
};

describe("the reader alert", () => {
  it("names the office, listing, card, file and Sydney time", () => {
    const { text } = readerAlertEmail(base);
    assert.match(text, /^A comparable-sales report couldn't be read\./);
    assert.ok(text.includes("Office: Sample Realty (made up)"));
    assert.ok(text.includes("Listing: 12 Sample Street, Testville NSW 2999"));
    assert.ok(text.includes("Card: ESP and comparable sales (a4)"));
    assert.ok(text.includes("File: CMA 12 Sample Street.pdf"));
    assert.ok(text.includes("When: 2 Nov 2026, 9:14 am (Sydney)"), text);
    assert.ok(text.includes("only email about this listing today"));
  });

  it("says what happened for each kind of failure, in plain words", () => {
    for (const why of ["cut_off", "unparseable", "refused", "no_answer", "too_large", "unsupported", "file", "service", "other"] as const) {
      const { subject, text } = readerAlertEmail({ ...base, why });
      assert.ok(!/[—–]/.test(subject + text), `no dashes (${why})`);
      assert.match(text, /What happened: /);
      assert.ok(!text.includes("undefined"), why);
    }
  });

  it("a read that isn't on a listing names the office and the kind of document", () => {
    const { subject, text } = readerAlertEmail({
      ...base,
      reader: "cpd_certificate",
      card: "CPD register",
      fileName: "cpd-certificate.pdf",
      listing: null,
      sales: null,
    });
    assert.equal(subject, "RealComply alert: a CPD certificate couldn't be read (Sample Realty (made up))");
    assert.ok(text.includes("Listing: none (not a listing document)"));
    assert.ok(text.includes("only email about CPD certificate reads in this office today"));
  });

  it("a comparable-sales report with 0 comparables says so, and that it may be the reader", () => {
    const { subject, text } = readerAlertEmail({ ...base, outcome: "nothing_found", why: null });
    assert.equal(subject, "RealComply alert: a comparable-sales report gave 0 comparables (12 Sample Street, Testville NSW 2999)");
    assert.match(text, /^A comparable-sales report was read and gave 0 comparables\./);
    assert.match(text, /Either it has none, or the reader missed them/);
    const wrong = readerAlertEmail({ ...base, outcome: "wrong_document", why: null });
    assert.match(wrong.text, /isn't a comparable-sales report/);
  });
});
