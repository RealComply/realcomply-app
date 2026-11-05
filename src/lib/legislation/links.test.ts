import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { legalReferenceLinks } from "./links";

// Every legal reference links to the law (Adam, 5 Nov 2026).

const NSW = "https://legislation.nsw.gov.au/view/html/inforce/current/";
const links = (text: string) => legalReferenceLinks(text).filter((p) => p.href).map((p) => [p.text, p.href]);

describe("live links on legal references", () => {
  it("links section 63 the way the contract card does", () => {
    assert.deepEqual(links("s63(2), Property and Stock Agents Act 2002 (NSW)"), [
      ["s63(2)", `${NSW}act-2002-066#sec.63`],
    ]);
  });

  it("links each section in a list, and a Regulation's clauses", () => {
    assert.deepEqual(links("ss 8, 9 Property and Stock Agents Act 2002 (NSW); reg cll 14(1), 16"), [
      ["ss 8", `${NSW}act-2002-066#sec.8`],
      ["9", `${NSW}act-2002-066#sec.9`],
      ["cll 14(1)", `${NSW}sl-2022-0501#sec.14`],
      ["16", `${NSW}sl-2022-0501#sec.16`],
    ]);
  });

  it("links a Schedule to the Schedule", () => {
    assert.deepEqual(links("Sch 2 r17, Property and Stock Agents Regulation 2022 (NSW)"), [
      ["Sch 2 r17", `${NSW}sl-2022-0501#sch.2`],
    ]);
    assert.deepEqual(links("s52A, Conveyancing Act 1919 (NSW); Conveyancing (Sale of Land) Regulation 2022, Sch 1"), [
      ["s52A", `${NSW}act-1919-006#sec.52A`],
      ["Sch 1", `${NSW}sl-2022-0485#sch.1`],
    ]);
  });

  it("reads property management's short names", () => {
    assert.deepEqual(links("PSA Reg Sch 2 s25; RTA ss163, 165"), [
      ["Sch 2 s25", `${NSW}sl-2022-0501#sch.2`],
      ["ss163", `${NSW}act-2010-042#sec.163`],
      ["165", `${NSW}act-2010-042#sec.165`],
    ]);
  });

  it("links a law named with no section, and a Commonwealth Act to the Act", () => {
    assert.deepEqual(links("Property and Stock Agents Act 2002 (NSW)"), [
      ["Property and Stock Agents Act 2002 (NSW)", `${NSW}act-2002-066`],
    ]);
    assert.deepEqual(links("AML/CTF Act 2006 (Cth), Tranche 2"), [
      ["AML/CTF Act 2006 (Cth)", "https://www.legislation.gov.au/C2006A00169/latest/text"],
    ]);
  });

  it("never guesses: a law with no address here stays plain text", () => {
    assert.deepEqual(links("RT Reg Sch 1 cl 46; Swimming Pools Act 1992"), []);
    assert.deepEqual(links("RTA s26(1); RT Reg cl 8"), [["s26(1)", `${NSW}act-2010-042#sec.26`]]);
  });

  it("keeps every card's reference word for word, and links all but the one with nothing to link to", () => {
    const src =
      readFileSync(new URL("../rules/nsw-sales.ts", import.meta.url), "utf8") +
      readFileSync(new URL("../rules/nsw-pm.ts", import.meta.url), "utf8");
    const refs = [...new Set([...src.matchAll(/(?:legalBasis|reference): *"([^"]*)"/g)].map((m) => m[1]))];
    assert.ok(refs.length > 60, `found ${refs.length}`);
    const unlinked: string[] = [];
    for (const r of refs) {
      const pieces = legalReferenceLinks(r);
      assert.equal(pieces.map((p) => p.text).join(""), r);
      if (!pieces.some((p) => p.href)) unlinked.push(r);
      for (const p of pieces) if (p.href) assert.match(p.href, /^https:\/\/(legislation\.nsw\.gov\.au|www\.legislation\.gov\.au)\//);
    }
    assert.deepEqual(unlinked, ["RT Reg Sch 1 cl 46; Swimming Pools Act 1992"]);
  });
});
