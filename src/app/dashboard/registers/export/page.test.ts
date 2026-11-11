import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The printed registers export (Adam, 11 Nov 2026): "No em dashes anywhere."
// The lines read "Jamie Licensee, Class 1 licence · ..." and "04/11/2026,
// Jamie Licensee · ...", not with a dash after the name or the date. Insurance
// expiry dates are written out ("expires 31 August 2027"), never the stored
// 2027-08-31, and a missing one says so in words rather than with a dash.

const source = readFileSync(join(process.cwd(), "src/app/dashboard/registers/export/page.tsx"), "utf8");
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
  .join("\n");

describe("registers export: no dashes, dates in words", () => {
  it("no em dash or en dash in anything the page prints", () => {
    assert.doesNotMatch(code, /[–—]|&mdash;|&ndash;/);
  });
  it("every insurance expiry goes through the written-date formatter", () => {
    assert.doesNotMatch(code, /expires \$\{[^}]*(expiry)[^}]*\?\?/);
    for (const field of ["agency.pi_expiry", "agency.cyber_expiry", "agency.icare_expiry", "p.expiry"]) {
      assert.ok(code.includes(`expiryText(${field})`), field);
    }
    assert.match(code, /expires \$\{formatAuDate\(expiry\)\}/);
  });
});
