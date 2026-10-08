import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStoreZip, crc32, safeZipName } from "./store-zip";

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe("store zip", () => {
  it("computes the standard CRC-32", () => {
    assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  });

  it("writes a central directory that points back at every file", () => {
    const zip = concat(
      buildStoreZip([
        { path: "a.txt", bytes: new TextEncoder().encode("hello") },
        { path: "Listings/12 O'Brien St/record.pdf", bytes: new Uint8Array([1, 2, 3]) },
      ]),
    );
    const view = new DataView(zip.buffer);
    const end = zip.length - 22;
    assert.equal(view.getUint32(end, true), 0x06054b50);
    assert.equal(view.getUint16(end + 10, true), 2);
    const centralStart = view.getUint32(end + 16, true);
    assert.equal(view.getUint32(centralStart, true), 0x02014b50);
    // The first local header is at offset 0 and holds the first file's bytes.
    assert.equal(view.getUint32(0, true), 0x04034b50);
    assert.equal(new TextDecoder().decode(zip.slice(30 + 5, 30 + 5 + 5)), "hello");
  });

  it("keeps folder separators out of names", () => {
    assert.equal(safeZipName("7/15 Orara Street, Waitara"), "7-15 Orara Street, Waitara");
  });
});
