import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { buildSoiPdf, soiFilename, SOI_FORM } from "@/lib/pdf/soi";
import { pdfText } from "@/lib/testing/pdf-text";
import type { SoiComparable, SoiContent } from "@/lib/rules/soi";

// The Statement of Information on the approved form (s72C(2)(a); Reg s12H;
// 0121). Made-up data only.

const comp = (address: string, over: Partial<SoiComparable> = {}): SoiComparable => ({
  address,
  bedrooms: 3,
  bathrooms: 2,
  parking: 1,
  landSizeSqm: 650,
  floorAreaSqm: null,
  soldPrice: 1250000,
  soldOn: "2027-01-10",
  reasons: "Same street and layout.",
  ...over,
});
const base: SoiContent = {
  address: "12 Harbour Street, Hornsby NSW 2077 (made up)",
  propertyType: "semi-detached",
  area: "metro",
  comparables: [comp("1 Near Street (made up)"), comp("2 Close Avenue (made up)", { soldPrice: 1180000 }), comp("3 Next Road (made up)")],
  fewerReason: null,
  reports: ["building", "strata_certificate"],
  preparedOn: "2027-02-12",
  preparedBy: "Ana Agent, Harbour Realty (made up)",
  espRevisionNo: 0,
};

const textOf = async (content: SoiContent) => (await pdfText(await buildSoiPdf(content))).replace(/\s+/g, " ");

describe("the Statement of Information PDF (s72C(2)(a))", () => {
  it("carries the form's own words, the property, Section A and who prepared it", async () => {
    const text = await textOf(base);
    for (const words of [
      "Statement of Information",
      "About this form",
      "has approved this form of the Statement of Information for section 72C of the Act.",
      "Address including suburb and postcode",
      "12 Harbour Street, Hornsby NSW 2077 (made up)",
      "Semi-detached",
      "in a metropolitan area, and this form provides information about comparable properties sold within 2 kilometres",
      "in the last 12 months, if less than 3 comparable properties were sold in the last 6 months.",
      "These are the 3 properties that the real estate agent considers to be most comparable",
      "1 Near Street (made up)",
      "$1,180,000",
      "10 January 2027",
      "Reasons why this is a comparable property (e.g. location, features, condition)",
      "Records of property reports and documents",
      "An association information certificate under s171 of the Community Land Management Act 2021",
      "This Statement of Information was prepared on:",
      "12 February 2027",
      "Ana Agent, Harbour Realty (made up)",
      "Factsheet: Property pricing and underquoting in NSW",
      "TTY: 1300 723 404 (for hearing impaired)",
    ]) {
      assert.ok(text.includes(words), `missing: ${words}`);
    }
    assert.ok(!text.includes(SOI_FORM.nonMetro.slice(0, 40)), "only the statement that applies");
    assert.ok(!text.includes("Section B"), "3 comparable: no Section B");
    assert.ok(!text.includes("[delete"), "the form's drafting notes are carried out, not printed");
    assert.ok(!text.includes("RealComply"), "the agent's document");
  });

  it("outside a metropolitan area, with 1 comparable: both sections", async () => {
    const text = await textOf({ ...base, area: "non_metro", comparables: [comp("1 Near Street (made up)")], fewerReason: "Only one sale within 5 km in 18 months." });
    assert.ok(text.includes("outside a metropolitan area, and this form provides information about comparable properties sold within 5 kilometres"));
    assert.ok(!text.includes("within 2 kilometres"));
    assert.ok(text.includes("Section A") && text.includes("Section B"));
    assert.ok(text.includes("The real estate agent reasonably believes that there are fewer than three comparable properties."));
    assert.ok(text.includes("Only one sale within 5 km in 18 months."));
  });

  it("with none: Section B only", async () => {
    const text = await textOf({ ...base, comparables: [], fewerReason: "No sales nearby." });
    assert.ok(!text.includes("Section A") && text.includes("Section B") && text.includes("No sales nearby."));
  });

  it("keeps long typed text whole, and starts the factsheet on its own page", async () => {
    const long = "A long reason. ".repeat(60);
    const pdf = await buildSoiPdf({ ...base, comparables: base.comparables.map((c) => ({ ...c, reasons: long })) });
    const doc = await PDFDocument.load(pdf);
    assert.ok(doc.getPageCount() >= 3);
    const text = (await pdfText(pdf)).replace(/\s+/g, " ");
    assert.ok(text.includes("Page 1 of"));
  });

  it("names the file after the street", () => {
    assert.equal(soiFilename("12 Harbour Street, Hornsby NSW 2077"), "Statement of Information, 12 Harbour Street.pdf");
    assert.equal(soiFilename(""), "Statement of Information.pdf");
  });
});
