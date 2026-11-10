import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { buildComplianceRecordPdf } from "@/lib/pdf/compliance-record";
import { paragraphsOf } from "@/lib/pdf/text";
import { allItemsInRuleset } from "@/lib/rules/nsw-sales";
import type { Property } from "@/lib/types";

// The ESP reasoning in short paragraphs, a blank line between each (Adam, 10
// Nov 2026), on the compliance record and so on the audit pack, which is
// built from the same record (lib/pdf/audit-pack.ts). It used to be drawn as
// one block, every line break lost. Made-up data only.

/** Each line drawn on the record, with how far down the page it sits. */
async function drawnLines(espReasoning: string): Promise<{ y: number; text: string }[]> {
  const pdf = await buildComplianceRecordPdf({
    property: { id: "p1", address: "9 Made Up Parade, Sampleton", stage: 1, created_at: "2026-11-18" } as unknown as Property,
    agencyName: "Made Up Realty",
    agentName: "Ana Agent",
    logo: null,
    items: allItemsInRuleset().filter((i) => i.key === "a4c"),
    byKey: {},
    espReasoning,
    comparables: [],
    signatures: { agent: null, licensee: null },
    rulesetVersion: "test",
    preparedFor: "test",
    generatedAt: new Date("2026-11-26T00:00:00Z"),
  });
  const raw = Buffer.from(pdf).toString("latin1");
  const out: { y: number; text: string }[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    let body: string;
    try {
      body = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
    } catch {
      continue;
    }
    for (const t of body.matchAll(/1 0 0 1 [\d.]+ ([\d.]+) Tm\s*<([0-9A-Fa-f]+)> Tj/g)) {
      out.push({ y: Number(t[1]), text: Buffer.from(t[2], "hex").toString("latin1") });
    }
  }
  return out;
}

describe("the ESP reasoning on the compliance record", () => {
  it("is drawn in its paragraphs, each starting on a new line, with a gap between them", async () => {
    const reasoning = [
      "The sales I've drawn on most are 14 Smith St and 8 Jones Ave, the closest to this property in type, size, location and date.",
      "14 Smith St sold for $1,350,000 in June 2026, 2 months before the agreement. It is 400m away and in the same suburb.",
      "My estimated selling price, recorded in the agency agreement, is $1,300,000 to $1,400,000.",
    ].join("\n\n");
    const lines = await drawnLines(reasoning);
    const at = (start: string) => {
      const i = lines.findIndex((l) => l.text.startsWith(start));
      assert.ok(i >= 0, `no line starts "${start}": ${lines.map((l) => l.text).join(" | ")}`);
      return i;
    };

    const first = at("The sales I've drawn on most");
    const second = at("14 Smith St sold for");
    const third = at("My estimated selling price");
    assert.ok(first < second && second < third);

    // A line within a paragraph is 13.3pt below the one before; the first
    // line of the next paragraph is further down by the gap.
    const step = (i: number) => Number((lines[i - 1].y - lines[i].y).toFixed(1));
    const within = step(first + 1);
    assert.equal(within, 13.3, "the first paragraph wraps onto a second line");
    assert.ok(step(second) > within + 5, `gap before the second paragraph: ${step(second)}`);
    assert.ok(step(third) > within + 5, `gap before the third paragraph: ${step(third)}`);
  });

  it("keeps a line the agent typed on its own as its own line", async () => {
    const lines = await drawnLines("Comparable sales:\n14 Smith St, the closest.\n\nConclusion: within the range.");
    const texts = lines.map((l) => l.text);
    assert.ok(texts.includes("Comparable sales:"), texts.join(" | "));
    assert.ok(texts.includes("14 Smith St, the closest."));
    assert.ok(texts.includes("Conclusion: within the range."));
  });
});

describe("paragraphsOf", () => {
  it("splits on blank lines, keeps single line breaks, and drops empty ones", () => {
    assert.deepEqual(paragraphsOf("  One.\r\n\r\nTwo\nlines.\n \n\n\nThree.  \n"), [["One."], ["Two", "lines."], ["Three."]]);
    assert.deepEqual(paragraphsOf("   \n\n "), []);
    assert.deepEqual(paragraphsOf("Just one."), [["Just one."]]);
  });
});
