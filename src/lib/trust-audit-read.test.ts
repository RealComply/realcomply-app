import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { realDate, trustAuditReadOutcome } from "@/lib/trust-audit-read";

// Reading the trust account audit report (Adam, 3 Nov 2026: "or RealComply
// reads them from the report, as for other uploads").

const YEAR = "2026-06-30";

describe("reading a trust account audit report", () => {
  it("fills in the auditor from a clear read and says the report's date, never as the date received", () => {
    const r = trustAuditReadOutcome(
      { documentIs: "trust_account_audit_report", auditor: "Jane Smith,\nSmith & Co Auditors", periodEnd: YEAR, reportDate: "2026-09-12" },
      YEAR,
    );
    assert.equal(r.outcome, "read");
    if (r.outcome !== "read") return;
    assert.equal(r.auditor, "Jane Smith, Smith & Co Auditors");
    assert.equal(r.reportDate, "2026-09-12");
    assert.equal(r.message, "Auditor read from the report. Check it, then save. The report is dated 12 September 2026.");
  });

  it("refuses anything that isn't an audit report", () => {
    const r = trustAuditReadOutcome({ documentIs: "other", auditor: "Someone" }, YEAR);
    assert.equal(r.outcome, "wrong_document");
    assert.match(r.message, /doesn't look like a trust account audit report/);
    assert.equal(trustAuditReadOutcome(null, YEAR).outcome, "wrong_document");
  });

  it("refuses last year's report, saying which year it is for", () => {
    const r = trustAuditReadOutcome({ documentIs: "trust_account_audit_report", periodEnd: "2025-06-30" }, YEAR);
    assert.equal(r.outcome, "wrong_period");
    assert.equal(
      r.message,
      "This report is for the year ended 30 June 2025, not 30 June 2026, so it hasn't been attached. Upload the report for the year ended 30 June 2026.",
    );
  });

  it("never guesses: an unreadable auditor or period is asked for", () => {
    const r = trustAuditReadOutcome(
      { documentIs: "trust_account_audit_report", auditor: "J?ne Sm1th", periodEnd: "2025-06-30", unreadableFields: ["auditor", "periodEnd"] },
      YEAR,
    );
    assert.equal(r.outcome, "read");
    if (r.outcome !== "read") return;
    assert.equal(r.auditor, null);
    assert.equal(
      r.message,
      "Couldn't read the auditor's name with confidence. Type it in. Check the report covers the year ended 30 June 2026.",
    );
  });

  it("takes only real dates", () => {
    assert.equal(realDate("2026-02-30"), null);
    assert.equal(realDate("30/06/2026"), null);
    assert.equal(realDate(" 2026-06-30 "), "2026-06-30");
    assert.equal(realDate(20260630), null);
  });
});
