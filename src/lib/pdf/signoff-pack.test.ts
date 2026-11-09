import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSignoffPackPdf, flagLine, type PackPdfInput } from "@/lib/pdf/signoff-pack";
import { PACK_TICK, UNSIGNED_MARK } from "@/lib/licensee-signoff/model";
import { pdfPageTexts, pdfText } from "@/lib/testing/pdf-text";

// The monthly sign-off pack as a PDF (Adam, 3 Nov 2026): "PDF before signing:
// every page 'For review. Not yet signed.', items with group/details/flags/
// notes, no documents; signed PDF same + signature".

const many = Array.from({ length: 60 }, (_, n) => ({
  title: `${n + 1} Example Street, Exampleton NSW 2000`,
  details: `Alex Agent · sent for sign-off 1 Oct 2026`,
  flagText: n === 0 ? "1 flag: Price advertised outside the estimate" : null,
  note: n === 0 ? "Vendor asked to hold the photos." : null,
  noteBy: n === 0 ? "Mel Carter" : null,
  heldBackNote: null,
}));

const input: PackPdfInput = {
  officeName: "Made Up Realty",
  month: "2026-10-01",
  licenseeName: "Priya Nandakumar",
  preparedLine: "Prepared by Mel Carter, office manager.",
  sentLine: "Sent by Mel Carter on 2 Nov 2026.",
  groups: [
    { heading: "Sales files ready for final sign-off", items: many },
    { heading: "Property management", items: [] },
    {
      heading: "Trust accounts",
      items: [{ title: "Sales trust: October 2026 reconciliation", details: "Uploaded by Mel Carter", flagText: null, note: null, noteBy: null, heldBackNote: null }],
    },
    { heading: "Office", items: [] },
  ],
  signature: null,
};

describe("the sign-off pack PDF", () => {
  it("marks every page 'For review. Not yet signed.' before signing, with each item, flag and note", async () => {
    const bytes = await buildSignoffPackPdf(input);
    const pages = await pdfPageTexts(bytes);
    assert.ok(pages.length > 1, "60 items run to more than one page");
    for (const page of pages) assert.ok(page.includes(UNSIGNED_MARK), "every page");
    const text = (await pdfText(bytes)).replace(/\s+/g, " ");
    assert.ok(text.includes("October sign-off pack"));
    assert.ok(text.includes("Prepared by Mel Carter, office manager."));
    assert.ok(text.includes("1 flag: Price advertised outside the estimate"));
    assert.ok(!text.includes("Flag: 1 flag"), "the flag line says it once (Adam, 9 Nov 2026)");
    assert.ok(text.includes("Note from Mel Carter: Vendor asked to hold the photos."));
    assert.ok(text.includes("Property management (0)"));
    assert.ok(text.includes("Nothing waiting this month."));
    assert.ok(text.includes("ABN 61 700 934 792"));
    assert.ok(!text.includes("—"), "no em dashes");
  });

  it("the signed copy has the same items, the signature, and no 'not yet signed' mark", async () => {
    const bytes = await buildSignoffPackPdf({
      ...input,
      groups: input.groups.map((g) => ({
        ...g,
        items: g.items.map((i, n) => (n === 1 ? { ...i, heldBackNote: "Missing the vendor's ID.", outcome: "held" as const } : { ...i, outcome: "signed" as const })),
      })),
      signature: { name: "Priya Nandakumar", dateLabel: "4 Nov 2026", tick: PACK_TICK, signedCount: 60, heldCount: 1, how: "signed in RealComply" },
    });
    const pages = await pdfPageTexts(bytes);
    for (const page of pages) assert.ok(!page.includes(UNSIGNED_MARK));
    const text = (await pdfText(bytes)).replace(/\s+/g, " ");
    assert.ok(text.includes(PACK_TICK));
    assert.ok(text.includes("Priya Nandakumar, licensee in charge, 4 Nov 2026 (signed in RealComply)."));
    assert.ok(text.includes("60 items signed. 1 held back, with the licensee's note above; it goes back to the office"));
    assert.ok(text.includes("Held back: Missing the vendor's ID."));
    assert.ok(text.includes("Signed in this pack"));
  });
});

describe("flagLine", () => {
  it("says a counted flag once, and puts Flag: in front of anything else", () => {
    assert.equal(flagLine("1 flag: Price advertised outside the estimate"), "1 flag: Price advertised outside the estimate");
    assert.equal(flagLine("3 flags: No signed agency agreement"), "3 flags: No signed agency agreement");
    assert.equal(flagLine("Review"), "Flag: Review");
  });
});
