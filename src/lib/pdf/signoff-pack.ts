import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { pdfText } from "@/lib/pdf/text";
import { checkedPdf } from "@/lib/pdf/checked-pdf";
import { NOTHING_WAITING, UNSIGNED_MARK, monthName } from "@/lib/licensee-signoff/model";

// The monthly licensee sign-off pack as a PDF (Adam, 3 Nov 2026; 0109): for
// the office to print and take in before signing, and the signed copy filed
// in Sign-offs after. Each item with its group, details, flags and notes; not
// each file's documents (a sales file's own audit pack still downloads from
// that file), so it stays small. Signing still happens in RealComply.
//
// Before signing, every page is marked "For review. Not yet signed." The
// signed copy has the same layout plus the signature: the licensee's name,
// the date, the tick's words and what was signed and held back. No internal
// ids anywhere; names and notes are printed as plain text.

export const PACK_PDF_FOOTER = "RealComply Pty Ltd · ABN 61 700 934 792 · Diligence support, not legal advice";

export type PackPdfItem = {
  title: string;
  details: string;
  flagText: string | null;
  note: string | null;
  noteBy: string | null;
  heldBackNote: string | null;
  /** On the signed copy: signed in this pack, or held back. */
  outcome?: "signed" | "held" | "already" | null;
};

export type PackPdfInput = {
  officeName: string;
  month: string;
  licenseeName: string;
  /** "Prepared by Mel Carter, office manager." */
  preparedLine: string | null;
  /** "Sent by Mel Carter on 2 Nov 2026." */
  sentLine: string | null;
  groups: Array<{ heading: string; items: PackPdfItem[] }>;
  signature: null | { name: string; dateLabel: string; tick: string; signedCount: number; heldCount: number; how: string };
};

const PAGE: [number, number] = [595.28, 841.89];
const LEFT = 50;
const RIGHT = PAGE[0] - 50;
const TOP = PAGE[1] - 70;
const BOTTOM = 70;
const INK = rgb(0.051, 0.122, 0.098);
const BODY = rgb(0.11, 0.169, 0.149);
const MUTED = rgb(0.361, 0.435, 0.408);
const AMBER = rgb(0.718, 0.475, 0.122);
const GREEN = rgb(0.043, 0.49, 0.314);
const LINE = rgb(0.867, 0.89, 0.878);

type Fonts = { regular: PDFFont; bold: PDFFont };

class Canvas {
  doc: PDFDocument;
  fonts: Fonts;
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = TOP;
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
  text(s: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; gap?: number } = {}) {
    const size = o.size ?? 10;
    const font = o.bold ? this.fonts.bold : this.fonts.regular;
    const x = o.x ?? LEFT;
    for (const line of wrap(pdfText(s, font), font, size, RIGHT - x)) {
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

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > width) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/**
 * The flag line under an item (Adam, 9 Nov 2026: "Flag: 1 flag: ..." didn't
 * read cleanly). "1 flag: Price advertised outside the estimate" already says
 * what it is; anything else, such as a gift's "Review", gets "Flag:" in front.
 */
export function flagLine(flagText: string): string {
  return /^\d+ flags?: /.test(flagText) ? flagText : `Flag: ${flagText}`;
}

export async function buildSignoffPackPdf(input: PackPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${input.officeName}: ${monthName(input.month)} sign-off pack`);
  doc.setProducer("RealComply");
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const c = new Canvas(doc, fonts);

  c.text(input.officeName, { size: 11, bold: true, color: MUTED });
  c.text(`${monthName(input.month)} sign-off pack`, { size: 18, bold: true, color: INK, gap: 4 });
  if (input.preparedLine) c.text(input.preparedLine, { color: MUTED });
  if (input.sentLine) c.text(input.sentLine, { color: MUTED });
  c.text(`For ${input.licenseeName}, licensee in charge.`, { color: MUTED, gap: 6 });

  for (const g of input.groups) {
    c.rule(8, 4);
    c.text(`${g.heading} (${g.items.length})`, { size: 11, bold: true, color: INK, gap: 2 });
    if (g.items.length === 0) {
      c.text(NOTHING_WAITING, { color: MUTED, gap: 2 });
      continue;
    }
    for (const item of g.items) {
      c.need(40);
      c.y -= 4;
      c.text(item.title, { bold: true, color: item.flagText ? AMBER : INK });
      if (item.details) c.text(item.details, { size: 9, color: MUTED, x: LEFT + 10 });
      if (item.flagText) c.text(flagLine(item.flagText), { size: 9, color: AMBER, x: LEFT + 10 });
      if (item.note) c.text(`Note${item.noteBy ? ` from ${item.noteBy}` : ""}: ${item.note}`, { size: 9, x: LEFT + 10 });
      if (item.heldBackNote) c.text(`Held back: ${item.heldBackNote}`, { size: 9, color: AMBER, x: LEFT + 10 });
      if (item.outcome === "signed") c.text("Signed in this pack", { size: 9, color: GREEN, x: LEFT + 10 });
      if (item.outcome === "already") c.text("Already signed on its own before the pack was signed", { size: 9, color: MUTED, x: LEFT + 10 });
    }
  }

  if (input.signature) {
    const s = input.signature;
    c.rule(14, 6);
    c.text("Signed", { size: 12, bold: true, color: INK, gap: 2 });
    c.text(`"${s.tick}"`, { gap: 2 });
    c.text(`${s.name}, licensee in charge, ${s.dateLabel} (${s.how}).`, { bold: true });
    const held =
      s.heldCount === 0
        ? "Nothing held back."
        : s.heldCount === 1
          ? "1 held back, with the licensee's note above; it goes back to the office and into next month's pack."
          : `${s.heldCount} held back, each with the licensee's note above; they go back to the office and into next month's pack.`;
    c.text(`${s.signedCount} ${s.signedCount === 1 ? "item" : "items"} signed. ${held}`, { color: MUTED });
  }

  const total = c.pages.length;
  c.pages.forEach((page, i) => {
    if (!input.signature) {
      page.drawText(UNSIGNED_MARK, { x: LEFT, y: PAGE[1] - 40, size: 11, font: fonts.bold, color: AMBER });
    }
    page.drawLine({ start: { x: LEFT, y: 48 }, end: { x: RIGHT, y: 48 }, thickness: 0.6, color: LINE });
    page.drawText(pdfText(PACK_PDF_FOOTER, fonts.regular), { x: LEFT, y: 34, size: 8, font: fonts.regular, color: MUTED });
    const label = `Page ${i + 1} of ${total}`;
    page.drawText(label, { x: RIGHT - fonts.regular.widthOfTextAtSize(label, 8), y: 34, size: 8, font: fonts.regular, color: MUTED });
  });

  return checkedPdf(await doc.save(), "the sign-off pack");
}
