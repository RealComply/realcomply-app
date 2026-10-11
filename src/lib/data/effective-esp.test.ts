import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { espFrom } from "./effective-esp";

// The app and the database have to read the same ESP (jsonb_to_numeric and
// listing_effective_esp in 0066). Each string below was run through
// jsonb_to_numeric on Postgres, 11 Oct 2026, and the expected answer is what
// it gave: a figure, or none.

const a4 = { espLow: 750000, espHigh: 790000 };

/** The revised low as the app reads it, with a high the database accepts. */
const revisedLow = (value: unknown) => {
  const esp = espFrom(a4, { revisedEspLow: value, revisedEspHigh: 950000 });
  return esp.revised ? esp.low : null;
};

describe("espFrom reads a figure as the database does", () => {
  it("takes a number", () => {
    assert.equal(revisedLow(900000), 900000);
    assert.equal(revisedLow(900000.5), 900000.5);
  });

  it("takes a string of digits, with spaces round it trimmed", () => {
    assert.equal(revisedLow("900000"), 900000);
    assert.equal(revisedLow("  900000  "), 900000);
    assert.equal(revisedLow("0900000"), 900000);
    assert.equal(revisedLow("900000.50"), 900000.5);
  });

  // btrim trims spaces only. Each of these is no figure in the database, so
  // it can't be the ESP on foot here either.
  it("refuses a tab, a line break or a non-breaking space round the digits", () => {
    assert.equal(revisedLow("900000\n"), null);
    assert.equal(revisedLow("900000\r"), null);
    assert.equal(revisedLow("\t900000"), null);
    assert.equal(revisedLow("900000 "), null);
    assert.equal(revisedLow(" 900000\n "), null);
  });

  it("refuses anything that isn't plain digits", () => {
    for (const value of ["9e5", "-900000", "900,000", "$900000", "", " ", ".5", "5.", "900 000"]) {
      assert.equal(revisedLow(value), null, JSON.stringify(value));
    }
    assert.equal(revisedLow(true), null);
    assert.equal(revisedLow(null), null);
  });

  it("falls back to a4 when a revised figure is a padded string the database refuses", () => {
    assert.deepEqual(espFrom(a4, { revisedEspLow: "900000\n", revisedEspHigh: "950000\n" }), {
      low: 750000,
      high: 790000,
      revised: false,
      revisedOn: null,
    });
  });

  it("reads a4's figures the same way", () => {
    assert.deepEqual(espFrom({ espLow: " 750000 ", espHigh: "790000\t" }, null), {
      low: 750000,
      high: null,
      revised: false,
      revisedOn: null,
    });
  });
});
