import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { DOCX_TYPE, WORD_PICTURES_MAX, documentXmlLines, isReadableWord, wordForReader } from "@/lib/documents/word-read";
import { askParts, prepareRead } from "@/lib/documents/read-core";
import { DocxUnreadable } from "@/lib/sg-document/docx";
import { zip } from "@/lib/testing/zip";

// Word files on listing cards (Adam, 11 Nov 2026): a .docx is read as its
// words, each table row on one line, with its pictures. Made-up people,
// addresses and documents throughout.

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (...paras: string[]) => `<w:tc><w:tcPr/>${paras.map(p).join("")}</w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`;
const table = (...rows: string[]) => `<w:tbl><w:tblPr/>${rows.join("")}</w:tbl>`;
const body = (inner: string) => `<?xml version="1.0"?><w:document><w:body>${inner}<w:sectPr/></w:body></w:document>`;

// A made-up identity check form: a heading, a table of labels and answers, a signature line.
const ID_FORM_XML = body(
  p("Verification of identity record (made up)") +
    table(
      row(cell("Vendor name"), cell("Jo Bennett")),
      row(cell("Document sighted"), cell("NSW driver licence")),
      row(cell("Verified by"), cell("Sam Lee, sales agent")),
      row(cell("Date verified"), cell("3 November 2026")),
      row(cell(""), cell("")),
    ) +
    p("Signed: Sam Lee"),
);

// A made-up solicitor's covering letter.
const LETTER_XML = body(
  p("Harbour Conveyancing (made up)") +
    p("4 November 2026") +
    p("Dear Sam,") +
    p("Re: 5 Test Parade, Sampleton NSW 2999 (made up). We enclose the draft contract for sale for your vendor."),
);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8]);
const EMF = new Uint8Array([1, 0, 0, 0, 9, 9, 9, 9]);

const limits = { pictureMaxBytes: 1_000_000, totalMaxBytes: 5_000_000 };

/** A downloaded file, as Storage hands it over. */
const blobOf = (bytes: Uint8Array, type: string) => new Blob([new Uint8Array(bytes)], { type });

describe("a Word file read as text", () => {
  it("keeps each table row on one line, and the paragraphs around the table in order", () => {
    assert.deepEqual(documentXmlLines(ID_FORM_XML), [
      "Verification of identity record (made up)",
      "Vendor name | Jo Bennett",
      "Document sighted | NSW driver licence",
      "Verified by | Sam Lee, sales agent",
      "Date verified | 3 November 2026",
      "Signed: Sam Lee",
    ]);
  });

  it("a table inside a cell stays in its cell", () => {
    const inner = table(row(cell("Licence"), cell("Passport")));
    const xml = body(table(row(`<w:tc>${p("Documents")}${inner}${p("both sighted")}</w:tc>`, cell("Yes"))));
    assert.deepEqual(documentXmlLines(xml), ["Documents Licence Passport both sighted | Yes"]);
  });

  it("says it's a Word file, with the file's own words, for the reader", () => {
    const w = wordForReader(zip({ "word/document.xml": LETTER_XML }), "Covering letter.docx", limits);
    assert.ok(w.text.startsWith('Document "Covering letter.docx", a Word file, read as text'));
    assert.ok(w.text.includes("4 November 2026\nDear Sam,"));
    assert.equal(w.words.split("\n")[1], "4 November 2026");
    assert.deepEqual(w.pictures, []);
    assert.equal(w.picturesLeftOut, 0);
  });

  it("brings its pictures, says which couldn't be shown, and keeps to the limit", () => {
    const files: Record<string, string | Uint8Array> = {
      "word/document.xml": ID_FORM_XML,
      "word/media/image1.png": PNG,
      "word/media/image2.jpeg": JPEG,
      "word/media/image3.emf": EMF,
    };
    for (let k = 0; k < WORD_PICTURES_MAX; k++) files[`word/media/more${k}.png`] = PNG;
    const w = wordForReader(zip(files), "ID check.docx", limits);
    assert.equal(w.pictures.length, WORD_PICTURES_MAX);
    assert.deepEqual(
      w.pictures.slice(0, 2).map((x) => x.mediaType),
      ["image/png", "image/jpeg"],
    );
    assert.equal(w.picturesLeftOut, 1 + 2, "the drawing (EMF) and the two past the limit");
    assert.ok(w.text.includes(`It has ${WORD_PICTURES_MAX} pictures, shown after the words. 3 more pictures in it couldn't be shown, so say nothing about them.`));
    const tight = wordForReader(zip({ "word/document.xml": ID_FORM_XML, "word/media/big.png": PNG }), "x.docx", { pictureMaxBytes: 5, totalMaxBytes: 100 });
    assert.equal(tight.pictures.length, 0);
    assert.equal(tight.picturesLeftOut, 1);
  });

  it("an empty document still says what it is", () => {
    const w = wordForReader(zip({ "word/document.xml": body("") }), "blank.docx", limits);
    assert.ok(w.text.endsWith("(No words in the file.)"));
    assert.equal(w.words, "");
  });

  it("a file that isn't a Word document throws, for the reader to say so", () => {
    assert.throws(() => wordForReader(zip({ "other.xml": "<x/>" }), "x.docx", limits), DocxUnreadable);
  });
});

describe("which files are read as Word", () => {
  const docx = zip({ "word/document.xml": LETTER_XML });
  it("a .docx, by its name or type", () => {
    assert.equal(isReadableWord({ contentType: DOCX_TYPE, fileName: "letter", bytes: docx }), true);
    assert.equal(isReadableWord({ contentType: "application/octet-stream", fileName: "Letter.DOCX", bytes: docx }), true);
  });
  it("a .docx called .doc (Word opens those), but never the old format itself", () => {
    assert.equal(isReadableWord({ contentType: "application/msword", fileName: "letter.doc", bytes: docx }), true);
    const oldDoc = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    assert.equal(isReadableWord({ contentType: "application/msword", fileName: "letter.doc", bytes: oldDoc }), false);
  });
  it("never a PDF, a photo, or another kind of zip", () => {
    assert.equal(isReadableWord({ contentType: "application/pdf", fileName: "a.pdf", bytes: new TextEncoder().encode("%PDF-1.7") }), false);
    const excel = zip({ "xl/workbook.xml": "<x/>" });
    assert.equal(isReadableWord({ contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName: "a.xlsx", bytes: excel }), false);
    assert.equal(isReadableWord({ contentType: "application/octet-stream", fileName: "a.doc", bytes: excel }), false);
  });
});

describe("what a listing card's reader is sent", () => {
  /** A stand-in for the Messages API that keeps what it was sent. */
  const standIn = () => {
    const sent: Anthropic.Messages.MessageCreateParams[] = [];
    const client = {
      messages: {
        create: async (params: Anthropic.Messages.MessageCreateParams) => {
          sent.push(params);
          return {
            id: "m",
            type: "message",
            role: "assistant",
            model: params.model,
            stop_reason: "tool_use",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
            content: [{ type: "tool_use", id: "t", name: (params.tool_choice as { name: string }).name, input: { letterDate: "2026-11-04" } }],
          };
        },
      },
    } as unknown as Anthropic;
    return { client, sent };
  };
  const tool: Anthropic.Messages.Tool = {
    name: "record_covering_letter_date",
    description: "d",
    input_schema: { type: "object", properties: { letterDate: { type: "string" } } },
  };

  it("a Word covering letter: its words, then the question", async () => {
    const blob = blobOf(zip({ "word/document.xml": LETTER_XML }), DOCX_TYPE);
    const prepared = await prepareRead(blob, "Covering letter.docx", { word: true });
    assert.ok(prepared.ok);
    if (!prepared.ok) return;
    assert.equal(prepared.contentType, "text/plain");
    assert.equal(prepared.pictures, 0);
    const { client, sent } = standIn();
    const [answer] = await askParts(client, prepared.parts, { system: "s", text: "Call record_covering_letter_date.", tool, maxTokens: 256 });
    assert.deepEqual(answer, { letterDate: "2026-11-04" });
    const content = sent[0].messages[0].content as Anthropic.Messages.ContentBlockParam[];
    assert.deepEqual(
      content.map((b) => b.type),
      ["text", "text"],
    );
    assert.ok((content[0] as { text: string }).text.includes("4 November 2026"));
  });

  it("a Word identity check form with a picture: its words, the picture, then the question", async () => {
    const blob = blobOf(zip({ "word/document.xml": ID_FORM_XML, "word/media/image1.jpeg": JPEG }), DOCX_TYPE);
    const prepared = await prepareRead(blob, "Identity check.docx", { word: true });
    assert.ok(prepared.ok);
    if (!prepared.ok) return;
    assert.equal(prepared.pictures, 1);
    const { client, sent } = standIn();
    await askParts(client, prepared.parts, { system: "s", text: "q", tool, maxTokens: 256 });
    const content = sent[0].messages[0].content as Anthropic.Messages.ContentBlockParam[];
    assert.deepEqual(
      content.map((b) => b.type),
      ["text", "image", "text"],
    );
    assert.ok((content[0] as { text: string }).text.includes("Vendor name | Jo Bennett"));
    assert.equal((content[1] as { source: { media_type: string } }).source.media_type, "image/jpeg");
  });

  it("a .docx that won't open: not read, said in words", async () => {
    const prepared = await prepareRead(blobOf(zip({ "x.xml": "<x/>" }), DOCX_TYPE), "broken.docx", { word: true });
    assert.deepEqual(prepared, { ok: false, problem: "unsupported", contentType: "a Word file that couldn't be opened" });
  });

  it("an old Word file (.doc) isn't read", async () => {
    const oldDoc = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    const prepared = await prepareRead(blobOf(oldDoc, "application/msword"), "letter.doc", { word: true });
    assert.equal(prepared.ok, false);
  });

  it("the registers and CPD don't read Word, as before", async () => {
    const prepared = await prepareRead(blobOf(zip({ "word/document.xml": LETTER_XML }), DOCX_TYPE), "certificate.docx");
    assert.deepEqual(prepared, { ok: false, problem: "unsupported", contentType: DOCX_TYPE });
  });

  it("a PDF is sent exactly as before", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.4\n%%EOF");
    const prepared = await prepareRead(blobOf(pdf, "application/pdf"), "contract.pdf", { word: true });
    // A file pdf-lib can't open isn't split; what matters is it isn't read as Word.
    if (prepared.ok) assert.equal(prepared.parts[0].extra, undefined);
    assert.notEqual(prepared.ok && prepared.contentType, "text/plain");
  });
});
