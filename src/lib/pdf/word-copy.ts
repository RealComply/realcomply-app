import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { DocxUnreadable, documentXmlParagraphs, zipEntry } from "@/lib/sg-document/docx";
import { pictureType, topLevel } from "@/lib/documents/word-read";
import { pdfText } from "@/lib/pdf/text";
import { wrapText } from "@/lib/pdf/sg-document";

// A Word file in the audit pack (Adam, 11 Nov 2026: "Go with A", step 2,
// option A: free, nothing leaves RealComply). RealComply draws a plain copy
// of a .docx itself: its words in order, its tables as tables, its pictures
// where they sit. Not Word's own layout (fonts, spacing, headers and the
// like), so every page of it says it is a plain copy made by RealComply, and
// the separator page before it says so too. The Word file itself is kept as
// uploaded.
//
// Made as a PDF of its own, then copied into the pack: a file that fails part
// way leaves nothing behind, and the pack names it instead (pack-documents.ts,
// notIncludedNote). The old Word format (.doc) isn't a zip and isn't drawn.

/** At the top of every page of the copy, with the file's name. */
export const WORD_COPY_HEADER = "Plain copy converted from Word by RealComply";

/** On the separator page before the copy. */
export const WORD_COPY_NOTE =
  "Plain copy converted from Word by RealComply: its words, tables and pictures, on the pages after this one. The Word file is kept in RealComply as uploaded.";

const PICTURE_LEFT_OUT = "(A picture here couldn't be shown in this copy.)";
const NO_WORDS = "(No words in the file.)";

const PAGE_W = 595.28; // A4, as the rest of the pack
const PAGE_H = 841.89;
const MARGIN = 56;
const TOP = PAGE_H - 78;
const BOTTOM = 60;
const WIDTH = PAGE_W - MARGIN * 2;
const INK = rgb(0.051, 0.122, 0.098);
const FAINT = rgb(0.561, 0.639, 0.608);
const MUTED = rgb(0.361, 0.435, 0.408);
const RULE = rgb(0.78, 0.82, 0.8);

const BODY = 10;
const HEADING = 12;
const CELL = 9;
const CELL_PAD = 4;
const lineHeight = (size: number) => size * 1.45;
const EMU_PER_POINT = 12700;

type PictureRef = { target: string; widthPt: number | null; heightPt: number | null };
type Cell = { lines: string[]; span: number };
export type WordBlock =
  | { kind: "paragraph"; text: string; heading: boolean; numbered: boolean; pictures: PictureRef[] }
  | { kind: "table"; rows: Cell[][]; pictures: PictureRef[] };

/** "word/../media/a.png" as "media/a.png". */
function normalisePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

/**
 * The document's relationships: id to the file in the zip it names. A link
 * to a file outside it (a picture on the web, or on someone's computer) is
 * kept as "": never fetched, and said in the copy as a picture not shown.
 */
export function documentRelationships(zip: Uint8Array): Map<string, string> {
  const map = new Map<string, string>();
  const rels = zipEntry(zip, "word/_rels/document.xml.rels");
  if (!rels) return map;
  for (const m of Buffer.from(rels).toString("utf8").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (!id || !target) continue;
    map.set(id, /\bTargetMode="External"/.test(m[0]) ? "" : normalisePath(target.startsWith("/") ? target : `word/${target}`));
  }
  return map;
}

/** The pictures in some of the document, in order, with the size Word shows them at. */
function pictureRefs(xml: string, rels: Map<string, string>): PictureRef[] {
  const out: PictureRef[] = [];
  for (const d of xml.matchAll(/<w:drawing\b[\s\S]*?<\/w:drawing>/g)) {
    const id = /<a:blip\b[^>]*\br:(?:embed|link)="([^"]+)"/.exec(d[0])?.[1];
    const target = id ? rels.get(id) : undefined;
    if (target === undefined) continue;
    const extent = /<wp:extent\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(d[0]);
    out.push({
      target,
      widthPt: extent ? Number(extent[1]) / EMU_PER_POINT : null,
      heightPt: extent ? Number(extent[2]) / EMU_PER_POINT : null,
    });
  }
  // Pictures in Word's older drawing format.
  for (const m of xml.matchAll(/<v:imagedata\b[^>]*\br:id="([^"]+)"/g)) {
    const target = rels.get(m[1]);
    if (target !== undefined) out.push({ target, widthPt: null, heightPt: null });
  }
  return out;
}

/** word/document.xml as what the copy draws: paragraphs and tables, in order. */
export function wordBlocks(xml: string, rels: Map<string, string>): WordBlock[] {
  const blocks: WordBlock[] = [];
  const paragraphs = (chunk: string) => {
    for (const m of chunk.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)) {
      const p = documentXmlParagraphs(m[0])[0];
      const pictures = pictureRefs(m[0], rels);
      if (!p && pictures.length === 0) continue;
      blocks.push({ kind: "paragraph", text: p?.text ?? "", heading: p?.heading ?? false, numbered: p?.numbered ?? false, pictures });
    }
  };
  let at = 0;
  for (const t of topLevel(xml, "w:tbl")) {
    paragraphs(xml.slice(at, t.start));
    const rows = topLevel(t.inner, "w:tr")
      .map((row) =>
        topLevel(row.inner, "w:tc").map((cell) => {
          const props = /^\s*<w:tcPr\b[\s\S]*?<\/w:tcPr>/.exec(cell.inner)?.[0] ?? "";
          const span = Number(/<w:gridSpan\s+w:val="(\d+)"/.exec(props)?.[1] ?? 1);
          return { lines: documentXmlParagraphs(cell.inner).map((p) => p.text), span: Math.max(1, Math.min(span, 20)) };
        }),
      )
      .filter((row) => row.length > 0);
    if (rows.length > 0) blocks.push({ kind: "table", rows, pictures: pictureRefs(t.inner, rels) });
    at = t.end;
  }
  paragraphs(xml.slice(at));
  return blocks;
}

class CopyCanvas {
  doc: PDFDocument;
  fonts: { regular: PDFFont; bold: PDFFont };
  header: string;
  page!: PDFPage;
  y = TOP;
  constructor(doc: PDFDocument, fonts: { regular: PDFFont; bold: PDFFont }, fileName: string) {
    this.doc = doc;
    this.fonts = fonts;
    this.header = `${WORD_COPY_HEADER} · ${fileName}`;
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    const font = this.fonts.regular;
    let text = pdfText(this.header, font);
    if (font.widthOfTextAtSize(text, 8) > WIDTH) {
      while (text.length > 1 && font.widthOfTextAtSize(`${text}...`, 8) > WIDTH) text = text.slice(0, -1);
      text = `${text}...`;
    }
    this.page.drawText(text, { x: MARGIN, y: PAGE_H - 40, size: 8, font, color: FAINT });
    this.page.drawLine({ start: { x: MARGIN, y: PAGE_H - 48 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - 48 }, thickness: 0.5, color: RULE });
    this.y = TOP;
  }
  need(h: number) {
    if (this.y - h < BOTTOM && this.y < TOP) this.newPage();
  }
  text(s: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number; bullet?: boolean; gapAfter?: number } = {}) {
    const size = o.size ?? BODY;
    const font = o.bold ? this.fonts.bold : this.fonts.regular;
    const indent = o.indent ?? 0;
    const lines = wrapText(pdfText(s, font), font, size, WIDTH - indent);
    lines.forEach((line, i) => {
      this.need(lineHeight(size));
      this.y -= lineHeight(size);
      if (o.bullet && i === 0) this.page.drawText("•", { x: MARGIN + indent - 10, y: this.y, size, font, color: o.color ?? INK });
      this.page.drawText(line, { x: MARGIN + indent, y: this.y, size, font, color: o.color ?? INK });
    });
    this.y -= o.gapAfter ?? 0;
  }
}

/** Draws one table; a row too tall for a page goes in as lines instead. */
function drawTable(c: CopyCanvas, rows: Cell[][]) {
  const font = c.fonts.regular;
  const columns = Math.max(...rows.map((r) => r.reduce((n, cell) => n + cell.span, 0)));
  const columnW = WIDTH / columns;
  c.y -= 4;
  for (const row of rows) {
    let x = MARGIN;
    const cells = row.map((cell, i) => {
      const w = i === row.length - 1 ? MARGIN + WIDTH - x : cell.span * columnW;
      const lines = cell.lines.flatMap((l) => wrapText(pdfText(l, font), font, CELL, Math.max(w - CELL_PAD * 2, 12)));
      const out = { x, w, lines };
      x += w;
      return out;
    });
    const h = Math.max(1, ...cells.map((cell) => cell.lines.length)) * lineHeight(CELL) + CELL_PAD * 2;
    if (h > TOP - BOTTOM) {
      for (const cell of row) c.text(cell.lines.join(" "), { size: CELL });
      continue;
    }
    c.need(h);
    const top = c.y;
    for (const cell of cells) {
      c.page.drawRectangle({ x: cell.x, y: top - h, width: cell.w, height: h, borderColor: RULE, borderWidth: 0.6 });
      cell.lines.forEach((line, i) => {
        c.page.drawText(line, { x: cell.x + CELL_PAD, y: top - CELL_PAD - lineHeight(CELL) * (i + 1) + 2, size: CELL, font, color: INK });
      });
    }
    c.y = top - h;
  }
  c.y -= 8;
}

/**
 * A plain copy of a Word file (.docx) as a PDF of its own. Throws
 * DocxUnreadable when the file can't be opened as Word.
 */
export async function wordCopyPdf(bytes: Uint8Array, fileName: string): Promise<PDFDocument> {
  const xml = zipEntry(bytes, "word/document.xml");
  if (!xml) throw new DocxUnreadable("no word/document.xml");
  const rels = documentRelationships(bytes);
  const blocks = wordBlocks(Buffer.from(xml).toString("utf8"), rels);

  const doc = await PDFDocument.create();
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const c = new CopyCanvas(doc, fonts, fileName);

  const images = new Map<string, PDFImage | null>();
  const picture = async (ref: PictureRef) => {
    if (!images.has(ref.target)) {
      let img: PDFImage | null = null;
      try {
        const data = ref.target ? zipEntry(bytes, ref.target) : null;
        const type = data ? pictureType(data) : null;
        if (data && type === "image/png") img = await doc.embedPng(data);
        else if (data && type === "image/jpeg") img = await doc.embedJpg(data);
      } catch {
        img = null;
      }
      images.set(ref.target, img);
    }
    const img = images.get(ref.target);
    if (!img) {
      c.text(PICTURE_LEFT_OUT, { size: 9, color: MUTED, gapAfter: 4 });
      return;
    }
    // Word's own size where it says, else the picture's at screen size; never wider or taller than a page.
    let w = ref.widthPt ?? img.width * 0.75;
    let h = ref.heightPt ?? img.height * 0.75;
    const scale = Math.min(WIDTH / w, (TOP - BOTTOM) / h, 1);
    w *= scale;
    h *= scale;
    c.need(h + 6);
    c.y -= h + 4;
    c.page.drawImage(img, { x: MARGIN, y: c.y, width: w, height: h });
    c.y -= 6;
  };

  if (blocks.length === 0) c.text(NO_WORDS, { color: MUTED });
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      if (block.text) {
        if (block.heading) {
          c.y -= 6;
          c.text(block.text, { size: HEADING, bold: true, gapAfter: 4 });
        } else {
          c.text(block.text, { indent: block.numbered ? 14 : 0, bullet: block.numbered, gapAfter: 6 });
        }
      }
      for (const ref of block.pictures) await picture(ref);
    } else {
      drawTable(c, block.rows);
      for (const ref of block.pictures) await picture(ref);
    }
  }
  return doc;
}
