import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  reportReadFailed,
  reportReadFinished,
  reportReadFrom,
  reportReadNote,
  reportReadOf,
  type ReportRead,
} from "@/lib/documents/report-read";

// What the last read of the comparable-sales report came to, and what the
// cards say about it (30 Oct 2026). Made-up files and sales only.

const PATH = "office/listing/a4/1-cma.pdf";
const AT = "2026-10-30T03:00:00.000Z";
const sale = { address: "1 Example St" };
const listing = { address: "2 Sample Rd" };

describe("the comparable-sales report's read", () => {
  it("counts what it found", () => {
    const r = reportReadFrom([{ itemKey: "a4c", comparableSales: [sale, sale, sale], marketListings: [listing] }], PATH, AT);
    assert.deepEqual(r, { at: AT, path: PATH, outcome: "read", sales: 3, listings: 1 });
  });

  it("is a read with nothing in it when it found no sales or listings", () => {
    assert.equal(reportReadFrom([], PATH, AT).outcome, "nothing_found");
    assert.equal(reportReadFrom([{ itemKey: "a4c", comparableSales: [], marketListings: [] }], PATH, AT).outcome, "nothing_found");
  });

  it("names the wrong document", () => {
    const r = reportReadFrom(
      [{ itemKey: "a4", wrongDocument: { expected: "a comparable-sales report", actual: "a contract for sale of land" } }],
      PATH,
      AT,
    );
    assert.equal(r.outcome, "wrong_document");
    assert.equal(r.message, "a contract for sale of land");
  });

  it("is only about the file attached now", () => {
    const r = reportReadFailed("couldn't be read just now. Try again in a minute", PATH, AT);
    assert.deepEqual(reportReadOf({ reportRead: r }, PATH), r);
    assert.equal(reportReadOf({ reportRead: r }, "office/listing/a4/2-new-cma.pdf"), null);
    assert.equal(reportReadOf({ reportRead: r }, null), null);
    assert.equal(reportReadOf({}, PATH), null);
  });

  it("counts as read, for the draft, only when it was read to the end", () => {
    assert.equal(reportReadFinished(reportReadFrom([{ itemKey: "a4c", comparableSales: [sale] }], PATH, AT)), true);
    assert.equal(reportReadFinished(reportReadFrom([], PATH, AT)), true);
    assert.equal(reportReadFinished(reportReadFailed("couldn't download the file", PATH, AT)), false);
    assert.equal(reportReadFinished(null), false);
  });
});

describe("what the cards say", () => {
  const read = (sales: number, listings: number): ReportRead => ({ at: AT, path: PATH, outcome: "read", sales, listings });

  it("on the ESP card, what was found and where it went", () => {
    assert.deepEqual(reportReadNote(read(6, 3), "report"), {
      tone: "ok",
      text: "Read for comparable sales: 6 sales and 3 listings on the market. They're on the ESP reasoning card.",
    });
    assert.equal(reportReadNote(read(1, 0), "report")?.text, "Read for comparable sales: 1 sale. They're on the ESP reasoning card.");
    assert.equal(
      reportReadNote(read(0, 1), "report")?.text,
      "Read for comparable sales: no sales and 1 listing on the market. They're on the ESP reasoning card.",
    );
    // The reasoning card shows the sales themselves.
    assert.equal(reportReadNote(read(6, 3), "reasoning"), null);
  });

  it("when nothing was found, on both cards", () => {
    const r = reportReadFrom([], PATH, AT);
    assert.equal(reportReadNote(r, "report")?.tone, "warn");
    assert.ok(reportReadNote(r, "report")?.text.startsWith("Read, but no sales or listings were found in it."));
    assert.ok(reportReadNote(r, "reasoning")?.text.includes("was read, but no sales or listings were found in it"));
  });

  it("when it couldn't be read, with the reason once and one full stop", () => {
    const r = reportReadFailed("couldn't be read to the end, so nothing was taken from it. Try Read again", PATH, AT);
    assert.equal(
      reportReadNote(r, "report")?.text,
      "Comparable sales not read: couldn't be read to the end, so nothing was taken from it. Try Read again.",
    );
    assert.equal(
      reportReadNote(r, "reasoning")?.text,
      "No sales from the comparable-sales report yet: couldn't be read to the end, so nothing was taken from it. Try Read again. Read again is beside the report on the ESP card.",
    );
    const empty = reportReadFailed("This file came through empty. Download it, then upload it again.", PATH, AT);
    assert.ok(!reportReadNote(empty, "report")!.text.includes(".."));
  });

  it("when it is the wrong document", () => {
    const r = reportReadFrom(
      [{ itemKey: "a4", wrongDocument: { expected: "a comparable-sales report", actual: "a contract for sale of land" } }],
      PATH,
      AT,
    );
    assert.equal(
      reportReadNote(r, "report")?.text,
      "Comparable sales not read: this file looks like a contract for sale of land, not a comparable-sales report, so nothing was taken from it. Replace the file.",
    );
    assert.equal(reportReadNote(r, "reasoning")?.tone, "warn");
  });

  it("in plain words: no dashes, no claims", () => {
    const all: ReportRead[] = [
      read(2, 0),
      reportReadFrom([], PATH, AT),
      reportReadFailed("couldn't be read just now. Try again in a minute", PATH, AT),
      reportReadFrom([{ itemKey: "a4", wrongDocument: { expected: "x", actual: "a different kind of document" } }], PATH, AT),
    ];
    for (const r of all) {
      for (const card of ["report", "reasoning"] as const) {
        const text = reportReadNote(r, card)?.text ?? "";
        assert.ok(!/[—–]/.test(text), text);
        assert.ok(!/compliant/i.test(text), text);
      }
    }
    assert.equal(reportReadNote(null, "report"), null);
  });
});
