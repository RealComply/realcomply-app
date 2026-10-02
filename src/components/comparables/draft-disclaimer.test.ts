import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { inflateSync } from "node:zlib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { draftEspReasoning, type EspDraft, type EspDraftInput } from "@/lib/data/esp-draft";
import { DISCLAIMER, a4cSave } from "@/lib/rules/esp-reasoning-adoption";
import { buildComplianceRecordPdf } from "@/lib/pdf/compliance-record";
import type { Comparable, SubjectAttributes } from "@/lib/data/comparables";
import type { Property } from "@/lib/types";

// The disclaimer: shown with every draft, exactly as worded, and never in what
// is saved or printed. The components are .tsx, which Node will not compile
// itself, so a load hook using the repo's TypeScript compiler is registered
// before they are imported.
register("../../../scripts/tsx-hooks.mjs", import.meta.url);

type Ui = typeof import("./ReasoningAssist");
let ui: Ui;
before(async () => {
  ui = await import("./ReasoningAssist.tsx" as string) as Ui;
});

const subject: SubjectAttributes = {
  bedrooms: 4, bathrooms: 2, carSpaces: 2, landSizeSqm: 600, internalAreaSqm: 210, conditionNote: null,
  address: "42 Landra Ave, Mount Colah", addressSuburb: "mount colah", propertyType: "House",
  suggestions: null, confirmedAt: "2026-09-07",
};
const sale = (id: string, address: string, salePrice: number): Comparable => ({
  id, address, salePrice, saleDate: "2026-06-14", bedrooms: 4, bathrooms: 2, carSpaces: 2, landSizeSqm: 600,
  internalAreaSqm: 210, distanceM: 400, propertyType: "House", source: "report", weighting: null, agentNote: null, position: 0,
});
const input = (prices: number[]): EspDraftInput => ({
  esp: { low: 1_300_000, high: 1_400_000 },
  subject,
  subjectType: "House",
  comparables: prices.map((p, i) => sale(`s${i}`, `${i + 10} Smith St, Mount Colah`, p)),
  listings: [],
  agreementDate: "2026-08-12",
  noneOnMarketConfirmed: false,
});
const draftsOfEveryKind = (): EspDraft[] =>
  [input([1_350_000, 1_385_000]), input([1_450_000, 1_490_000]), input([1_150_000, 1_190_000]), input([1_350_000])]
    .map((i) => draftEspReasoning(i))
    .filter((d): d is EspDraft => d.kind === "draft");

describe("the disclaimer", () => {
  it("is exactly as worded", () => {
    assert.equal(
      DISCLAIMER,
      "Draft only. RealComply wrote this from your report as an example. Check it, change it, and confirm it as your own. You are responsible for your reasoning.",
    );
    assert.ok(renderToStaticMarkup(createElement(ui.Disclaimer)).includes(DISCLAIMER));
  });

  it("is shown directly above every draft, whatever the evidence says", () => {
    const drafts = draftsOfEveryKind();
    assert.equal(drafts.length, 4);
    for (const d of drafts) {
      const html = renderToStaticMarkup(createElement(ui.DraftPreview, { draft: d }));
      const at = html.indexOf(DISCLAIMER);
      const firstWords = d.text.slice(0, 30).replace(/'/g, "&#x27;");
      assert.ok(at >= 0, `no disclaimer on the ${d.evidence} draft`);
      assert.ok(at < html.indexOf(firstWords), `the disclaimer is not above the ${d.evidence} draft`);
    }
  });

  it("is never part of the draft text, so it cannot travel with it", () => {
    for (const d of draftsOfEveryKind()) assert.ok(!d.text.includes(DISCLAIMER));
  });

  it("is absent from the saved text and from the audit pack", async () => {
    const d = draftsOfEveryKind()[0];
    // The agent edits (and, say, pastes the disclaimer in by mistake), then confirms.
    const typed = `${DISCLAIMER}\n${d.text} Pennantville presentation tipped it to the upper half.`;
    const saved = a4cSave({
      note: typed,
      pending: { source: "realcomply_draft", text: d.text, generatedAt: "2026-10-02T00:00:00Z", evidence: d.evidence },
      confirmed: true,
      previous: null,
      user: { id: "u1", name: "Sam Agent" },
      now: "2026-10-02T00:00:00Z",
    }) as { data: { note: string } };
    assert.ok(!saved.data.note.includes(DISCLAIMER), "not in the saved reasoning");

    // The pack prints the a4c note, exactly as the summary route passes it.
    const pdf = await buildComplianceRecordPdf({
      property: { id: "p1", address: "42 Landra Ave, Mount Colah", stage: 1, created_at: "2026-08-01" } as unknown as Property,
      agencyName: "Hornsby Realty",
      agentName: "Sam Agent",
      logo: null,
      items: [],
      byKey: {},
      espReasoning: saved.data.note,
      comparables: [],
      signatures: { agent: null, licensee: null },
      attachments: [],
      rulesetVersion: "test",
      preparedFor: "test",
      generatedAt: new Date("2026-10-02T00:00:00Z"),
    });
    const text = pdfText(pdf);
    assert.ok(text.includes("Pennantville"), "positive control: the reasoning itself is in the pack");
    for (const word of ["RealComply wrote this", "responsible for your reasoning", "Draft only"]) {
      assert.ok(!text.includes(word), `the pack contains "${word}"`);
    }
  });
});

/** The text drawn in a pdf-lib document: inflate each content stream and decode its hex strings. */
function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    let body: string;
    try {
      body = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
    } catch {
      body = m[1];
    }
    for (const hex of body.match(/<([0-9A-Fa-f\s]+)>\s*Tj/g) ?? []) {
      out.push(Buffer.from(hex.replace(/[<>\sTj]/g, ""), "hex").toString("latin1"));
    }
    for (const lit of body.match(/\((?:\\.|[^\\)])*\)\s*Tj/g) ?? []) out.push(lit.slice(1, lit.lastIndexOf(")")));
  }
  return out.join(" ");
}
