import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { pdfText } from "@/lib/pdf/text";
import { checkedPdf } from "@/lib/pdf/checked-pdf";
import { PACK_PDF_FOOTER } from "@/lib/pdf/signoff-pack";
import type { ChangeLogRow } from "@/lib/sg-document/change-log";

// Export PDF (Adam's mockup, signed off 6 Nov 2026, screens 2 and 5;
// Master, 10 Nov 2026; part 4b): the office's supervision guidelines as they
// stand, with every approved amendment merged into its place, then the
// change log at the back. Each amended paragraph has a short line under it
// saying which amendment and from when. Names and wording are printed as
// plain text; no internal ids anywhere.

export type SgPdfParagraph = { text: string; amendedLine: string | null };

export type SgPdfInput = {
  officeName: string;
  /** "Supervision guidelines and procedures manual" */
  title: string;
  /** "v7.3", "Version 3", or null. */
  versionSaid: string | null;
  /** "2 amendments merged in", "Next review due 14 August 2027". */
  details: string[];
  /** "Saved to RealComply 14 August 2026 by Priya Nair." */
  savedLine: string | null;
  /** "Exported 11 November 2026 by Priya Nair." */
  exportedLine: string;
  sections: Array<{ heading: string; paragraphs: SgPdfParagraph[] }>;
  changeLog: ChangeLogRow[];
};

const PAGE: [number, number] = [595.28, 841.89];
const LEFT = 50;
const RIGHT = PAGE[0] - 50;
const TOP = PAGE[1] - 60;
const BOTTOM = 70;
const INK = rgb(0.051, 0.122, 0.098);
const BODY = rgb(0.11, 0.169, 0.149);
const MUTED = rgb(0.361, 0.435, 0.408);
const AMBER = rgb(0.718, 0.475, 0.122);
const LINE = rgb(0.867, 0.89, 0.878);

type Color = ReturnType<typeof rgb>;
type Fonts = { regular: PDFFont; bold: PDFFont };

/** Words wrapped to a width. A word longer than the width is broken, so nothing runs off the page. */
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  const push = (word: string) => {
    const next = line ? `${line} ${word}` : word;
    if (!line || font.widthOfTextAtSize(next, size) <= width) {
      line = next;
      return;
    }
    out.push(line);
    line = word;
  };
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    let word = raw;
    while (font.widthOfTextAtSize(word, size) > width && word.length > 1) {
      let cut = word.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > width) cut--;
      if (line) {
        out.push(line);
        line = "";
      }
      out.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    push(word);
  }
  if (line) out.push(line);
  return out.length > 0 ? out : [""];
}

class Canvas {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = TOP;
  doc: PDFDocument;
  fonts: Fonts;
  constructor(doc: PDFDocument, fonts: Fonts) {
    this.doc = doc;
    this.fonts = fonts;
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage(PAGE);
    this.pages.push(this.page);
    this.y = TOP;
  }
  need(h: number) {
    if (this.y - h < BOTTOM) this.newPage();
  }
  text(s: string, o: { size?: number; bold?: boolean; color?: Color; x?: number; gap?: number; keep?: number } = {}) {
    const size = o.size ?? 10;
    const font = o.bold ? this.fonts.bold : this.fonts.regular;
    const x = o.x ?? LEFT;
    const lines = wrapText(pdfText(s, font), font, size, RIGHT - x);
    // A heading is kept with what follows it.
    this.need(size * 1.45 * Math.min(lines.length, 2) + (o.keep ?? 0));
    for (const line of lines) {
      this.need(size * 1.45);
      this.y -= size * 1.45;
      this.page.drawText(line, { x, y: this.y, size, font, color: o.color ?? BODY });
    }
    this.y -= o.gap ?? 0;
  }
  rule(before = 6, after = 8) {
    this.need(before + after + 1);
    this.y -= before;
    this.page.drawLine({ start: { x: LEFT, y: this.y }, end: { x: RIGHT, y: this.y }, thickness: 0.6, color: LINE });
    this.y -= after;
  }
}

// The change log's columns, as the page shows them (screen 5).
const COLUMNS: Array<{ head: string; width: number; cell: (r: ChangeLogRow) => string; bold?: boolean }> = [
  { head: "Starts", width: 58, cell: (r) => r.starts },
  { head: "Ref", width: 38, cell: (r) => r.ref, bold: true },
  { head: "Document", width: 82, cell: (r) => r.document },
  { head: "What changed", width: 117, cell: (r) => r.whatChanged },
  { head: "Reason", width: 60, cell: (r) => r.reason },
  { head: "Approved by", width: 85, cell: (r) => r.approvedBy },
  { head: "Staff signed", width: 55, cell: (r) => r.staffSigned },
];
const CELL_SIZE = 8;
const CELL_LINE = CELL_SIZE * 1.4;
const CELL_PAD = 4;

function drawChangeLog(c: Canvas, rows: ChangeLogRow[]) {
  const header = () => {
    c.y -= CELL_LINE;
    let x = LEFT;
    for (const col of COLUMNS) {
      c.page.drawText(col.head.toUpperCase(), { x, y: c.y, size: 7, font: c.fonts.bold, color: MUTED });
      x += col.width;
    }
    c.y -= CELL_PAD;
    c.page.drawLine({ start: { x: LEFT, y: c.y }, end: { x: RIGHT, y: c.y }, thickness: 0.6, color: LINE });
  };
  c.need(CELL_LINE * 4);
  header();
  for (const r of rows) {
    const cells = COLUMNS.map((col) => {
      const font = col.bold ? c.fonts.bold : c.fonts.regular;
      return { font, lines: wrapText(pdfText(col.cell(r), font), font, CELL_SIZE, col.width - CELL_PAD) };
    });
    const height = Math.max(...cells.map((x) => x.lines.length)) * CELL_LINE + CELL_PAD * 2;
    if (c.y - height < BOTTOM) {
      c.newPage();
      c.text("Change log (continued)", { size: 10, bold: true, color: INK, gap: 2 });
      header();
    }
    let x = LEFT;
    cells.forEach((cell, i) => {
      let y = c.y - CELL_PAD;
      for (const line of cell.lines) {
        y -= CELL_LINE;
        c.page.drawText(line, { x, y: y + 2, size: CELL_SIZE, font: cell.font, color: i === 1 ? INK : BODY });
      }
      x += COLUMNS[i].width;
    });
    c.y -= height;
    c.page.drawLine({ start: { x: LEFT, y: c.y }, end: { x: RIGHT, y: c.y }, thickness: 0.4, color: LINE });
  }
}

export async function buildSgDocumentPdf(input: SgPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfTitle(input));
  doc.setProducer("RealComply");
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const c = new Canvas(doc, fonts);

  c.text(input.officeName, { size: 11, bold: true, color: MUTED });
  c.text(input.title, { size: 18, bold: true, color: INK, gap: 2 });
  const subline = [input.versionSaid, ...input.details].filter(Boolean).join(" · ");
  if (subline) c.text(subline, { color: MUTED });
  if (input.savedLine) c.text(input.savedLine, { color: MUTED });
  c.text(input.exportedLine, { color: MUTED, gap: 4 });
  c.text("The current wording, with every approved amendment in its place. The change log is at the back.", { size: 9, color: MUTED });

  for (const s of input.sections) {
    c.rule(10, 4);
    c.text(s.heading, { size: 12, bold: true, color: INK, gap: 3, keep: 30 });
    for (const p of s.paragraphs) {
      c.text(p.text, { size: 10, gap: p.amendedLine ? 0 : 5 });
      if (p.amendedLine) c.text(p.amendedLine, { size: 8.5, color: AMBER, gap: 5 });
    }
  }

  c.newPage();
  c.text("Change log", { size: 16, bold: true, color: INK, gap: 2 });
  c.text('Every version, amendment and "Reviewed, no changes needed", with the date it starts.', { size: 9, color: MUTED, gap: 4 });
  if (input.changeLog.length === 0) c.text("Nothing recorded yet.", { color: MUTED });
  else drawChangeLog(c, input.changeLog);

  const total = c.pages.length;
  const head = pdfText(`${input.officeName} · ${pdfTitle(input)}`, fonts.regular);
  c.pages.forEach((page, i) => {
    if (i > 0) page.drawText(head, { x: LEFT, y: PAGE[1] - 36, size: 8, font: fonts.regular, color: MUTED });
    page.drawLine({ start: { x: LEFT, y: 48 }, end: { x: RIGHT, y: 48 }, thickness: 0.6, color: LINE });
    page.drawText(pdfText(PACK_PDF_FOOTER, fonts.regular), { x: LEFT, y: 34, size: 8, font: fonts.regular, color: MUTED });
    const label = `Page ${i + 1} of ${total}`;
    page.drawText(label, { x: RIGHT - fonts.regular.widthOfTextAtSize(label, 8), y: 34, size: 8, font: fonts.regular, color: MUTED });
  });

  return checkedPdf(await doc.save(), "the supervision guidelines");
}

/** "Supervision guidelines and procedures manual v7.3" */
export function pdfTitle(input: Pick<SgPdfInput, "title" | "versionSaid">): string {
  return input.versionSaid ? `${input.title} ${input.versionSaid}` : input.title;
}
