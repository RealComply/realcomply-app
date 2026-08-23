import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { STAGE_LABELS, type Property, type PropertyItem, type PropertyStage } from "@/lib/types";
import type { ComplianceItem } from "@/lib/rules/nsw-sales";
import { formatAuDate } from "@/lib/format-date";

// The finalised compliance record, as an actual PDF file.
//
// WHY THIS EXISTS AT ALL.
//
// The summary page used to carry a button reading "Use your browser's Print →
// Save as PDF" — which had no click handler, so it was a label instructing the
// agent to go and use a browser menu. Adam, 23 Aug 2026: "I'm sure there will
// be a number of agents that are a little bit older and might not know exactly
// how to do that. They're not very tech savvy. Can we change that button to
// just say save as PDF and have it automatically download."
//
// He is right, and the stakes are higher than convenience. This is the document
// handed to Fair Trading. A person who cannot work out the print dialog does not
// get a slightly worse experience — they get no document, at the exact moment
// they have been asked for one.
//
// WHY IT IS DRAWN RATHER THAN PRINTED FROM THE PAGE.
//
// The obvious alternative is a headless browser rendering the HTML. On Vercel
// that means bundling Chromium: a large function, slow cold starts, and a class
// of failure that shows up as a timeout rather than a document. Drawing the PDF
// from the same data the page uses keeps the function small, makes pagination
// deterministic, and means the output cannot silently change because a CSS rule
// moved.
//
// The trade-off, stated plainly: it does not look pixel-identical to the screen.
// It uses the standard PDF fonts rather than Plus Jakarta Sans, because
// embedding a font file into a filing document is weight for a difference no
// regulator will notice.

const GREEN = rgb(0.047, 0.651, 0.471); // #0ca678
const INK = rgb(0.051, 0.122, 0.098); // #0d1f19
const MUTED = rgb(0.361, 0.435, 0.408); // #5c6f68
const FAINT = rgb(0.561, 0.639, 0.608); // #8fa39b
const AMBER = rgb(0.753, 0.49, 0.098); // #c07d19
const BORDER = rgb(0.894, 0.914, 0.902); // #e4e9e6

const PAGE_W = 595.28; // A4 portrait, points
const PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = 64; // leave room for the footer rule and page number

type Fonts = { regular: PDFFont; bold: PDFFont };

/** Greedy wrap. pdf-lib has no text layout, so lines are measured by hand. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

// Standard PDF fonts are WinAnsi-encoded and throw on characters outside it —
// including the en dashes and curly quotes used throughout the app's copy. A
// compliance export must never fail because someone typed a nice apostrophe, so
// everything is flattened on the way in.
function ascii(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E]/g, "");
}

class Cursor {
  doc: PDFDocument;
  fonts: Fonts;
  page: PDFPage;
  y: number;
  pageNo = 1;

  constructor(doc: PDFDocument, fonts: Fonts) {
    this.doc = doc;
    this.fonts = fonts;
    this.page = doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }

  /** Start a new page if the next block would not fit. */
  need(height: number) {
    if (this.y - height < BOTTOM) {
      this.stampFooter();
      this.page = this.doc.addPage([PAGE_W, PAGE_H]);
      this.pageNo += 1;
      this.y = PAGE_H - MARGIN;
    }
  }

  stampFooter() {
    this.page.drawLine({
      start: { x: MARGIN, y: BOTTOM - 14 },
      end: { x: PAGE_W - MARGIN, y: BOTTOM - 14 },
      thickness: 0.5,
      color: BORDER,
    });
    this.page.drawText(ascii(`Page ${this.pageNo}`), {
      x: PAGE_W - MARGIN - this.fonts.regular.widthOfTextAtSize(`Page ${this.pageNo}`, 8),
      y: BOTTOM - 26,
      size: 8,
      font: this.fonts.regular,
      color: FAINT,
    });
  }

  text(
    content: string,
    opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {},
  ) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    const indent = opts.indent ?? 0;
    const lineHeight = size * 1.4;
    const lines = wrap(ascii(content), font, size, CONTENT_W - indent);
    this.need(lines.length * lineHeight);
    for (const line of lines) {
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.y - size,
        size,
        font,
        color: opts.color ?? INK,
      });
      this.y -= lineHeight;
    }
    this.y -= opts.gap ?? 0;
  }

  rule(gapAbove = 6, gapBelow = 8) {
    this.need(gapAbove + gapBelow + 1);
    this.y -= gapAbove;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.75,
      color: BORDER,
    });
    this.y -= gapBelow;
  }
}

export type ComplianceRecordInput = {
  property: Property;
  items: ComplianceItem[];
  byKey: Record<string, PropertyItem | undefined>;
  rulesetVersion: string;
  preparedFor: string;
  generatedAt: Date;
};

export async function buildComplianceRecordPdf(input: ComplianceRecordInput): Promise<Uint8Array> {
  const { property, items, byKey, rulesetVersion, preparedFor, generatedAt } = input;

  const doc = await PDFDocument.create();
  doc.setTitle(`RealComply compliance record - ${property.address}`);
  doc.setSubject(rulesetVersion);
  doc.setProducer("RealComply");
  doc.setCreationDate(generatedAt);

  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  const c = new Cursor(doc, fonts);

  // Masthead
  c.page.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: GREEN });
  c.text("RealComply", { size: 20, bold: true, color: GREEN });
  c.text("Finalised compliance record", { size: 14, bold: true });
  c.y -= 4;
  c.text(property.address, { size: 11, color: MUTED });
  c.text(
    `Generated ${formatAuDate(generatedAt.toISOString().slice(0, 10))} · ${rulesetVersion}`,
    { size: 8.5, color: FAINT },
  );
  c.text("Diligence support - verify with your adviser; the licensee decides.", {
    size: 8.5,
    color: FAINT,
  });
  c.rule(10, 14);

  // Open flags first, because a document read back to front should still put
  // the outstanding items in front of whoever opened it. This is the only part
  // a regulator is looking for, and burying it inside six stage headings is
  // exactly how a file gets handed over with something open in it.
  const openFlags = items.filter((i) => byKey[i.key]?.status === "flagged");
  if (openFlags.length > 0) {
    c.text(`Open flags (${openFlags.length})`, { size: 11, bold: true, color: AMBER, gap: 4 });
    for (const item of openFlags) {
      const note = (byKey[item.key]?.data as { note?: string } | undefined)?.note;
      c.text(`• ${item.label}`, { size: 9.5, color: AMBER, indent: 4 });
      if (note) c.text(note, { size: 8.5, color: MUTED, indent: 16 });
    }
    c.rule(10, 14);
  }

  for (const stage of [0, 1, 2, 3, 4, 5] as PropertyStage[]) {
    const stageItems = items.filter((i) => i.stage === stage);
    if (stageItems.length === 0) continue;

    // Keep a heading with at least its first item, so a stage never ends up
    // stranded alone at the foot of a page.
    c.need(46);
    c.text(STAGE_LABELS[stage], { size: 11, bold: true, gap: 2 });
    c.rule(2, 8);

    for (const item of stageItems) {
      const current = byKey[item.key];
      const status = current?.status ?? "open";
      const dated = current?.event_date ? ` · ${formatAuDate(current.event_date)}` : "";
      c.text(item.label, { size: 9.5, bold: true, indent: 4 });
      c.text(`${status}${dated}`, {
        size: 9,
        color: status === "flagged" ? AMBER : MUTED,
        indent: 12,
      });
      if (item.legalBasis) c.text(item.legalBasis, { size: 8, color: FAINT, indent: 12 });
      c.y -= 5;
    }
    c.y -= 8;
  }

  c.rule(8, 10);
  c.text(
    `Prepared for ${preparedFor}. This record reflects diligence-support content maintained in RealComply and is not legal advice.`,
    { size: 8, color: FAINT },
  );

  c.stampFooter();
  return doc.save();
}

/** A filename that survives Windows, macOS and email. */
export function complianceRecordFilename(property: Property, generatedAt: Date): string {
  const address = ascii(property.address)
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const stamp = generatedAt.toISOString().slice(0, 10);
  return `RealComply compliance record - ${address} - ${stamp}.pdf`;
}
