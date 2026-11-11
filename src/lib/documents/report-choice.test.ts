import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NO_SALES_PROMPT,
  confirmedAsReport,
  noSalesInReport,
  reportPromptFor,
  reportToCheck,
  withReportChoice,
  type ReportChoice,
} from "@/lib/documents/report-choice";
import { computePropertyDigests } from "@/lib/property-digest";
import type { Property, PropertyItem } from "@/lib/types";

// No comparable sales found in the ESP card's report (Master, 11 Nov 2026):
// the card asks "Upload report" or "This is my report", the listing needs
// attention until one is done, and the choice is kept with who and when.

const PATH = "agency/listing/a4/report.pdf";
const read = (outcome: string, path = PATH) => ({ reportRead: { at: "2026-11-11T00:02:32Z", path, outcome } });
const mine = (path = PATH): ReportChoice => ({ path, choice: "my_report", by: "u1", byName: "Tim Agent (made up)", at: "2026-11-11T01:00:00Z" });

describe("no comparable sales found in the report", () => {
  it("asks when the read found none, or thought it the agreement or the contract", () => {
    assert.equal(reportToCheck({ data: read("nothing_found"), evidence_path: PATH }), true);
    assert.equal(reportToCheck({ data: read("wrong_document"), evidence_path: PATH }), true);
  });

  it("doesn't ask when sales were found, the read failed, or there's no read yet", () => {
    assert.equal(reportToCheck({ data: read("read"), evidence_path: PATH }), false);
    assert.equal(reportToCheck({ data: read("failed"), evidence_path: PATH }), false);
    assert.equal(reportToCheck({ data: {}, evidence_path: PATH }), false);
    assert.equal(reportToCheck({ data: read("nothing_found"), evidence_path: null }), false);
  });

  it("a read of an earlier file says nothing about the file on the card now", () => {
    assert.equal(reportToCheck({ data: read("nothing_found", "agency/listing/a4/old.pdf"), evidence_path: PATH }), false);
  });

  it("'This is my report' answers it, for that file only", () => {
    const confirmed = withReportChoice(read("nothing_found"), mine());
    assert.equal(reportToCheck({ data: confirmed, evidence_path: PATH }), false);
    assert.equal(confirmedAsReport(confirmed, PATH)?.byName, "Tim Agent (made up)");
    assert.equal(noSalesInReport(confirmed, PATH), true, "the read itself is unchanged");
    // A new file on the card, also with no sales, asks again.
    const NEW = "agency/listing/a4/new.pdf";
    const newFile = { ...confirmed, ...read("nothing_found", NEW) };
    assert.equal(reportToCheck({ data: newFile, evidence_path: NEW }), true);
  });

  it("keeps every choice with who and when, the newest last, and the rest of the card", () => {
    const first = withReportChoice({ ...read("wrong_document"), espGivenOn: "2026-11-10" }, { ...mine(), choice: "uploaded" });
    const second = withReportChoice(first, mine());
    assert.equal(second.espGivenOn, "2026-11-10");
    assert.deepEqual(
      (second.reportChoices as ReportChoice[]).map((c) => c.choice),
      ["uploaded", "my_report"],
    );
    let many: Record<string, unknown> = {};
    for (let i = 0; i < 25; i++) many = withReportChoice(many, { ...mine(), at: `2026-11-11T00:00:${String(i).padStart(2, "0")}Z` });
    assert.equal((many.reportChoices as ReportChoice[]).length, 20);
  });

  it("what the ESP card says: the prompt, then who confirmed it and when", () => {
    const day = (iso: string) => iso.slice(0, 10);
    assert.deepEqual(reportPromptFor(read("nothing_found"), PATH, day), { kind: "ask" });
    const confirmed = reportPromptFor(withReportChoice(read("nothing_found"), mine()), PATH, day);
    assert.equal(confirmed?.kind, "confirmed");
    assert.match((confirmed as { text: string }).text, /^Tim Agent \(made up\) confirmed this is the comparable sales report on 2026-11-11\. Add its sales on the ESP reasoning card\./);
    assert.equal(reportPromptFor(read("read"), PATH, day), null);
    assert.equal(NO_SALES_PROMPT, "We couldn't find comparable sales in this file. Upload your comparable sales report, or confirm this is it.");
  });

  it("the listing needs attention in the digest Home and the Office overview use, and holds nothing", () => {
    const property = { id: "p1", address: "8 Smith Street, Testville (made up)", stage: 1, created_by: "u1", test_mode: false } as unknown as Property;
    const a4 = { property_id: "p1", item_key: "a4", status: "done", data: read("wrong_document"), evidence_path: PATH, recorded_at: "2026-11-11T00:00:00Z" } as unknown as PropertyItem;
    const [asking] = computePropertyDigests([property], new Map([["p1", new Map([["a4", a4]])]]));
    assert.equal(asking.reportToCheck, true);
    assert.deepEqual(asking.flagged, [], "not a flag on the card");
    const answered = { ...a4, data: withReportChoice(a4.data, mine()) } as PropertyItem;
    const [done] = computePropertyDigests([property], new Map([["p1", new Map([["a4", answered]])]]));
    assert.equal(done.reportToCheck, false);
  });
});
