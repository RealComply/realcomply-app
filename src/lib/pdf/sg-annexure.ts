import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { pdfText } from "@/lib/pdf/text";
import { formatSignedAt } from "@/lib/pdf/sign-stamp";
import { embedSignatureFont, signatureFontCanDraw } from "@/lib/pdf/signature-font";
import {
  SG_ANNEXURE_ADOPTION,
  SG_ANNEXURE_AGENT_STATEMENT,
  SG_ANNEXURE_FOOTER,
  SG_ANNEXURE_NOTICE,
  SG_ANNEXURE_SCHEDULE_1_HEADING,
  SG_ANNEXURE_SCHEDULE_1_LINE,
  SG_ANNEXURE_SCHEDULE_2,
  SG_ANNEXURE_SCHEDULE_2_HEADING,
  SG_ANNEXURE_SECTIONS_AFTER_SCHEDULES,
  SG_ANNEXURE_SECTIONS_BEFORE_SCHEDULES,
  SG_ANNEXURE_SUBTITLE,
  SG_ANNEXURE_TITLE,
  scheduleOne,
  type AnnexureSection,
} from "@/lib/legal/sg-annexure";
import { checkedPdf } from "@/lib/pdf/checked-pdf";

// The annexure as a PDF: the "Download the full annexure" copy (adoption
// section blank) and the signed copy (adoption section filled in), from the
// same text, so the two can never say different things.
//
// Layout follows the approved 6-page PDF: the office's logo or the RealComply
// wordmark, the title, Agency / Licence number / Effective date, the yellow
// notice, the clauses, the two schedules as tables, the adoption, the agent
// statement, and the RealComply footer with "Page N of M" on every page.
//
// Everything a person typed (the agency's name, the name signed, the licence
// number) goes through pdfText, so a curly apostrophe can never stop the
// document being produced.

export type SgAnnexurePdfInput = {
  /**
   * The Agency line: "[licensed entity name] trading as [trading name]", or
   * the trading name alone (lib/agency-names.ts formalAgencyName). Empty for
   * the blank version. Wraps onto more lines when it is long.
   */
  agencyName: string;
  /** Null when none is on file; the box is left blank to fill in. */
  licenceNumber: string | null;
  /** The effective date as printed ("14 October 2026"), or null for blank. */
  effectiveDate: string | null;
  /** The office's own logo, if it has saved one. Otherwise the RealComply wordmark. */
  logo: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  /** Filled in on the signed copy. */
  adoption: {
    signedName: string;
    licenceNumber: string;
    sentTo: string;
    signedAt: string;
    version: string;
  } | null;
};

const PAGE: [number, number] = [595.28, 841.89];
const LEFT = 50;
const RIGHT = PAGE[0] - 50;
const WIDTH = RIGHT - LEFT;
const TOP = PAGE[1] - 48;
const BOTTOM = 64;

const INK = rgb(0.051, 0.122, 0.098); // #0d1f19
const BODY = rgb(0.11, 0.169, 0.149);
const MUTED = rgb(0.361, 0.435, 0.408); // #5c6f68
const FAINT = rgb(0.541, 0.604, 0.576);
const LINE = rgb(0.894, 0.914, 0.902);
const GREEN = rgb(0.047, 0.651, 0.471); // #0ca678
const HOUSE = rgb(0.086, 0.188, 0.165); // #16302a
const NOTICE_FILL = rgb(0.996, 0.965, 0.886);
const NOTICE_LINE = rgb(0.941, 0.851, 0.627);
const GROUP_FILL = rgb(0.957, 0.973, 0.965);

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont; signature: PDFFont };

class Cursor {
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

  /** Room for `height` more points on this page, or a new page. */
  need(height: number) {
    if (this.y - height < BOTTOM) this.newPage();
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const words = pdfText(text, font).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [""];
    const lines: string[] = [];
    let line = words[0];
    for (const word of words.slice(1)) {
      const candidate = `${line} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
    return lines;
  }

  /** Wrapped text. Each line breaks to a new page on its own if it must. */
  text(
    text: string,
    opts: { size?: number; font?: PDFFont; color?: RGB; x?: number; width?: number; leading?: number; after?: number } = {},
  ) {
    const size = opts.size ?? 9.5;
    const font = opts.font ?? this.fonts.regular;
    const x = opts.x ?? LEFT;
    const width = opts.width ?? RIGHT - x;
    const leading = opts.leading ?? size * 1.42;
    for (const line of this.wrap(text, font, size, width)) {
      this.need(leading);
      this.y -= leading;
      this.page.drawText(line, { x, y: this.y + (leading - size) / 2, size, font, color: opts.color ?? BODY });
    }
    this.y -= opts.after ?? 0;
  }

  rule(before = 6, after = 10) {
    this.y -= before;
    this.page.drawLine({ start: { x: LEFT, y: this.y }, end: { x: RIGHT, y: this.y }, thickness: 0.6, color: LINE });
    this.y -= after;
  }
}

function drawWordmark(c: Cursor, x: number, y: number, size: number) {
  c.page.drawText("Real", { x, y, size, font: c.fonts.bold, color: HOUSE });
  c.page.drawText("Comply", {
    x: x + c.fonts.bold.widthOfTextAtSize("Real", size),
    y,
    size,
    font: c.fonts.bold,
    color: GREEN,
  });
}

function masthead(c: Cursor, input: SgAnnexurePdfInput, logo: PDFImage | null) {
  if (logo) {
    const scale = Math.min(160 / logo.width, 44 / logo.height, 1);
    const w = logo.width * scale;
    const h = logo.height * scale;
    c.page.drawImage(logo, { x: LEFT, y: c.y - h, width: w, height: h });
    c.y -= h + 18;
  } else {
    drawWordmark(c, LEFT, c.y - 16, 16);
    c.y -= 34;
  }

  c.text(SG_ANNEXURE_TITLE, { size: 18, font: c.fonts.bold, color: INK, leading: 24 });
  c.text(SG_ANNEXURE_SUBTITLE, { size: 11, color: MUTED, leading: 16, after: 14 });

  // Agency / Licence number / Effective date, side by side.
  const cols = [
    { label: "Agency:", value: input.agencyName, width: WIDTH * 0.42 },
    { label: "Licence number:", value: input.licenceNumber ?? "", width: WIDTH * 0.29 },
    { label: "Effective date:", value: input.effectiveDate ?? "", width: WIDTH * 0.29 },
  ];
  const valueLines = cols.map((col) => c.wrap(col.value, c.fonts.bold, 10, col.width - 10));
  const rows = Math.max(1, ...valueLines.map((l) => l.length));
  const height = 14 + rows * 13 + 6;
  c.need(height);
  let x = LEFT;
  cols.forEach((col, i) => {
    c.page.drawText(col.label, { x, y: c.y - 10, size: 8.5, font: c.fonts.regular, color: MUTED });
    valueLines[i].forEach((line, n) => {
      if (line) c.page.drawText(line, { x, y: c.y - 24 - n * 13, size: 10, font: c.fonts.bold, color: INK });
    });
    // The line to write on, for a blank box.
    c.page.drawLine({
      start: { x, y: c.y - height + 4 },
      end: { x: x + col.width - 12, y: c.y - height + 4 },
      thickness: 0.6,
      color: LINE,
    });
    x += col.width;
  });
  c.y -= height + 14;

  // The yellow notice.
  const lines = c.wrap(SG_ANNEXURE_NOTICE, c.fonts.regular, 9.5, WIDTH - 24);
  const boxHeight = lines.length * 13.5 + 18;
  c.need(boxHeight);
  c.page.drawRectangle({
    x: LEFT,
    y: c.y - boxHeight,
    width: WIDTH,
    height: boxHeight,
    color: NOTICE_FILL,
    borderColor: NOTICE_LINE,
    borderWidth: 0.8,
  });
  lines.forEach((line, n) => {
    c.page.drawText(line, { x: LEFT + 12, y: c.y - 20 - n * 13.5, size: 9.5, font: c.fonts.regular, color: BODY });
  });
  c.y -= boxHeight + 18;
}

function section(c: Cursor, s: AnnexureSection) {
  c.need(40);
  c.text(`${s.num}. ${s.heading}`, { size: 12.5, font: c.fonts.bold, color: INK, leading: 18, after: 4 });
  for (const clause of s.clauses) {
    const first = c.wrap(clause.text, c.fonts.regular, 9.5, WIDTH - 26);
    c.need(Math.min(first.length, 2) * 13.5);
    const startY = c.y;
    const startPage = c.page;
    c.text(clause.text, { x: LEFT + 26, size: 9.5, leading: 13.5, after: 6 });
    startPage.drawText(clause.num, { x: LEFT, y: startY - 13.5 + 2, size: 9.5, font: c.fonts.bold, color: INK });
  }
  c.y -= 8;
}

/** A two-column table with a header row that repeats on each new page. */
function table(
  c: Cursor,
  headers: [string, string],
  split: number,
  groups: Array<{ heading?: string; rows: Array<[string, string]> }>,
) {
  const w1 = WIDTH * split;
  const w2 = WIDTH - w1;
  const pad = 6;
  const size = 9;
  const leading = 12;

  const header = () => {
    c.need(20);
    c.page.drawRectangle({ x: LEFT, y: c.y - 18, width: WIDTH, height: 18, color: GROUP_FILL });
    c.page.drawText(headers[0], { x: LEFT + pad, y: c.y - 12.5, size: 8.5, font: c.fonts.bold, color: MUTED });
    c.page.drawText(headers[1], { x: LEFT + w1 + pad, y: c.y - 12.5, size: 8.5, font: c.fonts.bold, color: MUTED });
    c.y -= 18;
  };

  header();
  for (const group of groups) {
    if (group.heading) {
      if (c.y - 30 < BOTTOM) {
        c.newPage();
        header();
      }
      c.y -= 6;
      c.page.drawText(pdfText(group.heading, c.fonts.bold), {
        x: LEFT + pad,
        y: c.y - 11,
        size: 10,
        font: c.fonts.bold,
        color: INK,
      });
      c.y -= 16;
    }
    for (const [a, b] of group.rows) {
      const la = c.wrap(a, c.fonts.regular, size, w1 - pad * 2);
      const lb = c.wrap(b, c.fonts.regular, size, w2 - pad * 2);
      const height = Math.max(la.length, lb.length) * leading + 8;
      if (c.y - height < BOTTOM) {
        c.newPage();
        header();
      }
      la.forEach((line, n) =>
        c.page.drawText(line, { x: LEFT + pad, y: c.y - 12 - n * leading, size, font: c.fonts.regular, color: BODY }),
      );
      lb.forEach((line, n) =>
        c.page.drawText(line, { x: LEFT + w1 + pad, y: c.y - 12 - n * leading, size, font: c.fonts.regular, color: BODY }),
      );
      c.y -= height;
      c.page.drawLine({ start: { x: LEFT, y: c.y }, end: { x: RIGHT, y: c.y }, thickness: 0.5, color: LINE });
    }
  }
  c.y -= 18;
}

/** A labelled line to write on, with the value printed when there is one. */
function field(c: Cursor, label: string, value: string | null, opts: { signature?: boolean } = {}) {
  c.need(34);
  c.page.drawText(label, { x: LEFT, y: c.y - 12, size: 9, font: c.fonts.regular, color: MUTED });
  if (value) {
    const sigFont = opts.signature && signatureFontCanDraw(c.fonts.signature, value) ? c.fonts.signature : null;
    const font = sigFont ?? (opts.signature ? c.fonts.italic : c.fonts.bold);
    const size = sigFont ? 20 : 10.5;
    c.page.drawText(pdfText(value, font), { x: LEFT + 150, y: c.y - 14, size, font, color: INK });
  }
  c.page.drawLine({
    start: { x: LEFT + 150, y: c.y - 20 },
    end: { x: RIGHT, y: c.y - 20 },
    thickness: 0.6,
    color: LINE,
  });
  c.y -= 32;
}

function stampFooters(c: Cursor) {
  const total = c.pages.length;
  c.pages.forEach((page, i) => {
    page.drawLine({ start: { x: LEFT, y: 46 }, end: { x: RIGHT, y: 46 }, thickness: 0.6, color: LINE });
    page.drawText(pdfText(SG_ANNEXURE_FOOTER, c.fonts.regular), { x: LEFT, y: 32, size: 8, font: c.fonts.regular, color: MUTED });
    const label = `Page ${i + 1} of ${total}`;
    page.drawText(label, {
      x: RIGHT - c.fonts.regular.widthOfTextAtSize(label, 8),
      y: 32,
      size: 8,
      font: c.fonts.regular,
      color: FAINT,
    });
  });
}

export async function buildSgAnnexurePdf(input: SgAnnexurePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(SG_ANNEXURE_TITLE);
  doc.setAuthor("RealComply");
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    signature: await embedSignatureFont(doc),
  };

  // A logo that will not embed must never cost the licensee their document.
  let logo: PDFImage | null = null;
  if (input.logo) {
    try {
      logo = input.logo.type === "jpg" ? await doc.embedJpg(input.logo.bytes) : await doc.embedPng(input.logo.bytes);
    } catch {
      logo = null;
    }
  }

  const c = new Cursor(doc, fonts);
  masthead(c, input, logo);

  for (const s of SG_ANNEXURE_SECTIONS_BEFORE_SCHEDULES) section(c, s);

  c.need(60);
  c.text(SG_ANNEXURE_SCHEDULE_1_HEADING, { size: 12.5, font: fonts.bold, color: INK, leading: 18 });
  c.text(SG_ANNEXURE_SCHEDULE_1_LINE, { size: 9, color: MUTED, leading: 13, after: 8 });
  table(
    c,
    ["Record", "Provision it relates to"],
    0.52,
    scheduleOne().map((g) => ({ heading: g.heading, rows: g.rows.map((r) => [r.record, r.provision] as [string, string]) })),
  );

  c.need(60);
  c.text(SG_ANNEXURE_SCHEDULE_2_HEADING, { size: 12.5, font: fonts.bold, color: INK, leading: 18, after: 6 });
  table(c, ["Register", "What it holds"], 0.32, [
    { rows: SG_ANNEXURE_SCHEDULE_2.map((r) => [r.register, r.holds] as [string, string]) },
  ]);

  for (const s of SG_ANNEXURE_SECTIONS_AFTER_SCHEDULES) section(c, s);

  // 6. Adoption by the licensee in charge.
  c.need(200);
  c.text(SG_ANNEXURE_ADOPTION.heading, { size: 12.5, font: fonts.bold, color: INK, leading: 18, after: 4 });
  c.text(SG_ANNEXURE_ADOPTION.declaration, { leading: 13.5, after: 10 });
  const a = input.adoption;
  field(c, "Name", a?.signedName ?? null);
  field(c, "Licence number", a?.licenceNumber ?? null);
  field(c, "Signature", a?.signedName ?? null, { signature: true });
  field(c, "Date", a ? formatSignedAt(a.signedAt) : null);
  c.text(SG_ANNEXURE_ADOPTION.electronic, { size: 9, color: MUTED, leading: 13, after: 8 });
  if (a) {
    // What the electronic adoption recorded, in full, under the signature.
    const recordLines = [
      "Adopted electronically through RealComply.",
      `Name typed: ${a.signedName}`,
      `Licence number given: ${a.licenceNumber}`,
      `Adoption request sent to: ${a.sentTo}`,
      `Signed: ${formatSignedAt(a.signedAt)} (Sydney)`,
      `Annexure version adopted: ${a.version}`,
    ];
    const height = recordLines.length * 13 + 14;
    c.need(height);
    c.page.drawRectangle({
      x: LEFT,
      y: c.y - height,
      width: WIDTH,
      height,
      color: GROUP_FILL,
      borderColor: LINE,
      borderWidth: 0.6,
    });
    recordLines.forEach((line, n) =>
      c.page.drawText(pdfText(line, n === 0 ? fonts.bold : fonts.regular), {
        x: LEFT + 10,
        y: c.y - 17 - n * 13,
        size: 9,
        font: n === 0 ? fonts.bold : fonts.regular,
        color: n === 0 ? INK : BODY,
      }),
    );
    c.y -= height + 16;
  }

  // 7. Agent operating statement (optional, left blank).
  c.need(170);
  c.text(SG_ANNEXURE_AGENT_STATEMENT.heading, { size: 12.5, font: fonts.bold, color: INK, leading: 18, after: 2 });
  c.text(SG_ANNEXURE_AGENT_STATEMENT.note, { size: 9, font: fonts.italic, color: MUTED, leading: 13, after: 4 });
  c.text(SG_ANNEXURE_AGENT_STATEMENT.statement, { leading: 13.5, after: 10 });
  for (const label of SG_ANNEXURE_AGENT_STATEMENT.fields) field(c, label, null);

  stampFooters(c);
  return checkedPdf(await doc.save(), "SG annexure");
}

/** "SG annexure - Harbour Realty.pdf", or "... (signed).pdf". Safe in a header and a zip. */
export function sgAnnexureFilename(agencyName: string, signed: boolean): string {
  const name = agencyName.replace(/[^\p{L}\p{N} &'().,-]+/gu, " ").replace(/\s+/g, " ").trim() || "Agency";
  return `SG annexure - ${name}${signed ? " (signed)" : ""}.pdf`;
}
