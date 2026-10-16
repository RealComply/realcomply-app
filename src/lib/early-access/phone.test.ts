import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanPhone, looksAustralianPhone } from "./phone";

describe("the optional mobile on the early access form", () => {
  it("keeps what was typed, tidied", () => {
    assert.equal(cleanPhone("  0412 345 678 "), "0412 345 678");
    assert.equal(cleanPhone("(02)  9876-5432"), "(02) 9876-5432");
    assert.equal(cleanPhone("+61 412 345 678"), "+61 412 345 678");
    assert.equal(cleanPhone("call me 0412345678!"), "0412345678");
  });

  it("nothing usable is nothing", () => {
    assert.equal(cleanPhone(""), null);
    assert.equal(cleanPhone("   "), null);
    assert.equal(cleanPhone(null), null);
    assert.equal(cleanPhone("n/a"), null);
  });

  it("caps a paste accident", () => {
    assert.ok((cleanPhone("0".repeat(80)) ?? "").length <= 30);
  });

  it("recognises Australian mobiles and landlines, spaces allowed", () => {
    for (const ok of ["0412 345 678", "0412345678", "+61 412 345 678", "61412345678", "(02) 9876 5432", "03 9123 4567", "07-3123-4567", "08 8123 4567", "+61 2 9876 5432"]) {
      assert.ok(looksAustralianPhone(ok), ok);
    }
  });

  it("anything else is only flagged, never refused", () => {
    for (const odd of ["12345", "0412 345 67", "+44 20 7946 0958", "1300 123 456", ""]) {
      assert.equal(looksAustralianPhone(odd), false, odd);
    }
  });
});
