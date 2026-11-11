import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDict, PDFName } from "pdf-lib";
import { DocxUnreadable } from "@/lib/sg-document/docx";
import { WORD_COPY_HEADER, documentRelationships, wordBlocks, wordCopyPdf } from "@/lib/pdf/word-copy";
import { pdfPageTexts } from "@/lib/testing/pdf-text";
import { zip } from "@/lib/testing/zip";

// A Word file in the audit pack (Adam, 11 Nov 2026, "Go with A"): a plain
// copy drawn by RealComply. Made-up people, addresses and documents.

const p = (text: string, props = "") => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (text: string, span = 1) => `<w:tc><w:tcPr>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}</w:tcPr>${p(text)}</w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`;
const table = (...rows: string[]) => `<w:tbl><w:tblPr/>${rows.join("")}</w:tbl>`;
const body = (inner: string) => `<?xml version="1.0"?><w:document><w:body>${inner}<w:sectPr/></w:body></w:document>`;
/** A paragraph holding one picture, shown at the given size in points. */
const picture = (rid: string, wPt = 144, hPt = 72) =>
  `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${wPt * 12700}" cy="${hPt * 12700}"/><a:graphic><pic:pic><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
const rels = (entries: Array<[string, string, string?]>) =>
  `<?xml version="1.0"?><Relationships>${entries
    .map(([id, target, mode]) => `<Relationship Id="${id}" Type="http://schemas/image" Target="${target}"${mode ? ` TargetMode="${mode}"` : ""}/>`)
    .join("")}</Relationships>`;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const LETTER = body(
  p("Harbour Conveyancing (made up)") +
    p("4 November 2026") +
    p("Re: 5 Test Parade, Sampleton NSW 2999 (made up)", '<w:pStyle w:val="Heading1"/>') +
    p("We enclose the draft contract for sale.") +
    p("Prescribed documents attached", '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
);

const ID_FORM = body(
  p("Verification of identity record (made up)") +
    table(row(cell("Vendor name"), cell("Jo Bennett (made up)")), row(cell("Notes across both columns", 2))) +
    p("Signed: Sam Lee"),
);

function imagesOn(page: { node: { Resources(): PDFDict | undefined } }): number {
  const xobjects = page.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
  return xobjects ? xobjects.keys().length : 0;
}

describe("what is drawn from a Word file", () => {
  it("paragraphs and tables in order, with headings, list items and spans", () => {
    const blocks = wordBlocks(ID_FORM + "", new Map());
    assert.deepEqual(
      blocks.map((b) => b.kind),
      ["paragraph", "table", "paragraph"],
    );
    const t = blocks[1];
    assert.ok(t.kind === "table");
    assert.deepEqual(
      t.rows.map((r) => r.map((c) => [c.lines.join(" "), c.span])),
      [
        [
          ["Vendor name", 1],
          ["Jo Bennett (made up)", 1],
        ],
        [["Notes across both columns", 2]],
      ],
    );
    const letter = wordBlocks(LETTER, new Map());
    const heading = letter[2];
    const item = letter[4];
    assert.ok(heading.kind === "paragraph" && heading.heading && !heading.numbered);
    assert.ok(item.kind === "paragraph" && item.numbered);
  });

  it("finds each picture through the document's relationships, at Word's size", () => {
    const docx = zip({
      "word/document.xml": body(p("Before") + picture("rId7", 200, 100) + p("After")),
      "word/_rels/document.xml.rels": rels([
        ["rId7", "media/image1.png"],
        ["rId8", "../customXml/item.xml"],
        ["rId9", "https://example.com/logo.png", "External"],
      ]),
      "word/media/image1.png": PNG,
    });
    const map = documentRelationships(docx);
    assert.equal(map.get("rId7"), "word/media/image1.png");
    assert.equal(map.get("rId8"), "customXml/item.xml");
    assert.equal(map.get("rId9"), "", "a picture on the web is never fetched");
    const blocks = wordBlocks(body(p("Before") + picture("rId7", 200, 100) + p("After")), map);
    const pic = blocks.find((b) => b.kind === "paragraph" && b.pictures.length > 0);
    assert.ok(pic && pic.kind === "paragraph");
    assert.deepEqual(pic.pictures, [{ target: "word/media/image1.png", widthPt: 200, heightPt: 100 }]);
  });
});

describe("the plain copy", () => {
  it("every page says it is a plain copy made by RealComply, with the file's name; the words follow in order", async () => {
    const copy = await wordCopyPdf(zip({ "word/document.xml": LETTER }), "Covering letter (made up).docx");
    const pages = await pdfPageTexts(await copy.save());
    assert.equal(pages.length, 1);
    const text = pages[0].replace(/\s+/g, " ");
    assert.ok(text.includes(`${WORD_COPY_HEADER} · Covering letter (made up).docx`), text);
    const order = ["Harbour Conveyancing (made up)", "4 November 2026", "Re: 5 Test Parade", "We enclose the draft contract for sale.", "Prescribed documents attached"];
    const at = order.map((s) => text.indexOf(s));
    assert.ok(at.every((i) => i >= 0), text);
    assert.deepEqual([...at].sort((a, b) => a - b), at, "in the file's order");
  });

  it("a table's cells are drawn, a label beside its answer", async () => {
    const copy = await wordCopyPdf(zip({ "word/document.xml": ID_FORM }), "Identity check form (made up).docx");
    const text = (await pdfPageTexts(await copy.save()))[0].replace(/\s+/g, " ");
    for (const s of ["Vendor name", "Jo Bennett (made up)", "Notes across both columns", "Signed: Sam Lee"]) assert.ok(text.includes(s), s);
  });

  it("a picture is drawn where it sits; one that can't be drawn, or isn't in the file, is said, not dropped", async () => {
    const docx = zip({
      "word/document.xml": body(p("Photo of the front of the house (made up)") + picture("rId1") + picture("rId2") + picture("rId3")),
      "word/_rels/document.xml.rels": rels([
        ["rId1", "media/image1.png"],
        ["rId2", "media/image2.gif"],
        ["rId3", "https://example.com/house.png", "External"],
      ]),
      "word/media/image1.png": PNG,
      "word/media/image2.gif": GIF,
    });
    const copy = await wordCopyPdf(docx, "Photos (made up).docx");
    assert.equal(imagesOn(copy.getPage(0)), 1);
    const text = (await pdfPageTexts(await copy.save()))[0].replace(/\s+/g, " ");
    assert.equal(text.split("(A picture here couldn't be shown in this copy.)").length - 1, 2, text);
  });

  it("a long document runs onto more pages, each with the plain copy line", async () => {
    const long = body(Array.from({ length: 120 }, (_, i) => p(`Clause ${i + 1}. The vendor and the agent agree to this made-up term.`)).join(""));
    const pages = await pdfPageTexts(await (await wordCopyPdf(zip({ "word/document.xml": long }), "Agreement (made up).docx")).save());
    assert.ok(pages.length > 1);
    for (const page of pages) assert.ok(page.includes(WORD_COPY_HEADER));
    assert.ok(pages.join(" ").includes("Clause 120."));
  });

  it("a table row too tall for a page goes in as lines, not off the page", async () => {
    const tall = body(table(row(cell(Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ")), cell("Short"))));
    const pages = await pdfPageTexts(await (await wordCopyPdf(zip({ "word/document.xml": tall }), "Tall (made up).docx")).save());
    const all = pages.join(" ");
    assert.ok(all.includes("word0") && all.includes("word399") && all.includes("Short"));
  });

  it("letters the font can't draw don't stop the copy", async () => {
    const docx = zip({ "word/document.xml": body(p("Vendor: Nguyễn Văn An 阮文安 (made up) – “quoted”")) });
    const text = (await pdfPageTexts(await (await wordCopyPdf(docx, "Ghi chú (made up).docx")).save()))[0];
    assert.ok(text.includes("Nguyen Van An"), text);
  });

  it("a file with no words says so", async () => {
    const text = (await pdfPageTexts(await (await wordCopyPdf(zip({ "word/document.xml": body("") }), "Empty.docx")).save()))[0];
    assert.ok(text.includes("(No words in the file.)"));
  });

  it("a file that isn't a Word file can't be drawn", async () => {
    await assert.rejects(wordCopyPdf(zip({ "notes.txt": "hello" }), "notes.docx"), DocxUnreadable);
    await assert.rejects(wordCopyPdf(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]), "old.doc"));
  });
});
