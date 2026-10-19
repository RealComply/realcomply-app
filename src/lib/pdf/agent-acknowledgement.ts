import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { pdfText } from "@/lib/pdf/text";
import { formatSignedAt } from "@/lib/pdf/sign-stamp";
import { ACK_DOCUMENT_TITLE, ACK_INTRO, ACK_STATEMENTS, type AckRun } from "@/lib/agent-acknowledgement";
import { checkedPdf } from "@/lib/pdf/checked-pdf";

// The agent acknowledgement as a PDF, filed in Registers, Document sign-offs
// (job 7 brief, Part 2). The office's logo if it has saved one, otherwise the
// RealComply wordmark; the same footer as the annexure. What it shows is the
// record, word for word: the five boxes as they were shown and ticked, the
// numbers given, the name typed and when.

export const ACK_PDF_FOOTER = "RealComply Pty Ltd · ABN 61 700 934 792 · Not legal advice";

export type AgentAcknowledgementPdfInput = {
  agentName: string;
  agentLicenceNumber: string;
  agencyName: string;
  licenseeName: string;
  licenseeLicenceNumber: string;
  version: string;
  /** The five boxes as stored. When they match today's wording, the Act's name is set in italics. */
  statements: string[];
  confirmedAt: string;
  logo: { bytes: Uint8Array; type: "png" | "jpg" } | null;
};

const PAGE: [number, number] = [595.28, 841.89];
const LEFT = 50;
const RIGHT = PAGE[0] - 50;
const WIDTH = RIGHT - LEFT;
const TOP = PAGE[1] - 48;
const BOTTOM = 64;

const INK = rgb(0.051, 0.122, 0.098);
const BODY = rgb(0.11, 0.169, 0.149);
const MUTED = rgb(0.361, 0.435, 0.408);
const FAINT = rgb(0.541, 0.604, 0.576);
const LINE = rgb(0.894, 0.914, 0.902);
const GREEN = rgb(0.047, 0.651, 0.471);
const HOUSE = rgb(0.086, 0.188, 0.165);
const BOX_FILL = rgb(0.957, 0.973, 0.965);

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };
type Word = { text: string; italic: boolean };

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
  need(height: number) {
    if (this.y - height < BOTTOM) this.newPage();
  }
}

/** Words with their style, for wrapping text that mixes upright and italic. */
function wordsOf(runs: AckRun[], fonts: Fonts): Word[] {
  const words: Word[] = [];
  for (const run of runs) {
    const font = run.italic ? fonts.italic : fonts.regular;
    for (const w of pdfText(run.text, font).split(/\s+/).filter(Boolean)) words.push({ text: w, italic: Boolean(run.italic) });
  }
  return words;
}

function wrapWords(words: Word[], fonts: Fonts, size: number, width: number): Word[][] {
  const space = fonts.regular.widthOfTextAtSize(" ", size);
  const widthOf = (w: Word) => (w.italic ? fonts.italic : fonts.regular).widthOfTextAtSize(w.text, size);
  const lines: Word[][] = [];
  let line: Word[] = [];
  let used = 0;
  for (const w of words) {
    const add = (line.length ? space : 0) + widthOf(w);
    if (line.length && used + add > width) {
      lines.push(line);
      line = [w];
      used = widthOf(w);
    } else {
      line.push(w);
      used += add;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

function drawWords(c: Cursor, line: Word[], x: number, y: number, size: number) {
  const space = c.fonts.regular.widthOfTextAtSize(" ", size);
  let at = x;
  for (const w of line) {
    const font = w.italic ? c.fonts.italic : c.fonts.regular;
    c.page.drawText(w.text, { x: at, y, size, font, color: BODY });
    at += font.widthOfTextAtSize(w.text, size) + space;
  }
}

function paragraph(c: Cursor, runs: AckRun[], opts: { x?: number; size?: number; leading?: number; after?: number } = {}) {
  const x = opts.x ?? LEFT;
  const size = opts.size ?? 10;
  const leading = opts.leading ?? size * 1.45;
  for (const line of wrapWords(wordsOf(runs, c.fonts), c.fonts, size, RIGHT - x)) {
    c.need(leading);
    c.y -= leading;
    drawWords(c, line, x, c.y + (leading - size) / 2, size);
  }
  c.y -= opts.after ?? 0;
}

/** Today's wording with the Act in italics, when the stored text is today's. */
function runsFor(stored: string, i: number): AckRun[] {
  const today = ACK_STATEMENTS[i];
  return today && today.map((r) => r.text).join("") === stored ? today : [{ text: stored }];
}

function masthead(c: Cursor, logo: PDFImage | null) {
  if (logo) {
    const scale = Math.min(160 / logo.width, 44 / logo.height, 1);
    c.page.drawImage(logo, { x: LEFT, y: c.y - logo.height * scale, width: logo.width * scale, height: logo.height * scale });
    c.y -= logo.height * scale + 18;
  } else {
    c.page.drawText("Real", { x: LEFT, y: c.y - 16, size: 16, font: c.fonts.bold, color: HOUSE });
    c.page.drawText("Comply", {
      x: LEFT + c.fonts.bold.widthOfTextAtSize("Real", 16),
      y: c.y - 16,
      size: 16,
      font: c.fonts.bold,
      color: GREEN,
    });
    c.y -= 34;
  }
}

function row(c: Cursor, label: string, value: string) {
  const size = 10;
  const valueX = LEFT + 170;
  const lines = wrapWords(wordsOf([{ text: value }], c.fonts), c.fonts, size, RIGHT - valueX);
  const height = Math.max(1, lines.length) * 14 + 8;
  c.need(height);
  c.page.drawText(pdfText(label, c.fonts.regular), { x: LEFT, y: c.y - 13, size: 9, font: c.fonts.regular, color: MUTED });
  lines.forEach((line, n) => {
    const text = line.map((w) => w.text).join(" ");
    c.page.drawText(text, { x: valueX, y: c.y - 13 - n * 14, size, font: c.fonts.bold, color: INK });
  });
  c.y -= height;
  c.page.drawLine({ start: { x: LEFT, y: c.y + 3 }, end: { x: RIGHT, y: c.y + 3 }, thickness: 0.5, color: LINE });
}

export async function buildAgentAcknowledgementPdf(input: AgentAcknowledgementPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(ACK_DOCUMENT_TITLE);
  doc.setAuthor("RealComply");
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  let logo: PDFImage | null = null;
  if (input.logo) {
    try {
      logo = input.logo.type === "png" ? await doc.embedPng(input.logo.bytes) : await doc.embedJpg(input.logo.bytes);
    } catch {
      logo = null; // A logo that won't embed never stops the record.
    }
  }

  const c = new Cursor(doc, fonts);
  masthead(c, logo);
  c.y -= 4;
  c.page.drawText(ACK_DOCUMENT_TITLE, { x: LEFT, y: c.y - 18, size: 18, font: fonts.bold, color: INK });
  c.y -= 30;
  paragraph(c, [{ text: ACK_INTRO }], { size: 10.5, after: 12 });

  row(c, "Agent", input.agentName);
  row(c, "Licence or certificate number", input.agentLicenceNumber);
  row(c, "Agency", input.agencyName);
  row(c, "Licensee in charge", input.licenseeName);
  row(c, "Licensee’s licence number", input.licenseeLicenceNumber);
  row(c, "Confirmed", formatSignedAt(input.confirmedAt));
  row(c, "Wording version", input.version);
  c.y -= 14;

  c.need(24);
  c.page.drawText("Confirmed by ticking each box", { x: LEFT, y: c.y - 12, size: 11, font: fonts.bold, color: INK });
  c.y -= 22;

  input.statements.forEach((stored, i) => {
    const runs = runsFor(stored, i);
    const lines = wrapWords(wordsOf(runs, fonts), fonts, 10, WIDTH - 46);
    const height = lines.length * 14.5 + 14;
    c.need(height);
    c.page.drawRectangle({ x: LEFT, y: c.y - height, width: WIDTH, height, color: BOX_FILL });
    // The tick.
    c.page.drawRectangle({ x: LEFT + 10, y: c.y - 20, width: 11, height: 11, color: GREEN });
    c.page.drawLine({ start: { x: LEFT + 12.5, y: c.y - 14.5 }, end: { x: LEFT + 15, y: c.y - 17.5 }, thickness: 1.4, color: rgb(1, 1, 1) });
    c.page.drawLine({ start: { x: LEFT + 15, y: c.y - 17.5 }, end: { x: LEFT + 19, y: c.y - 11.5 }, thickness: 1.4, color: rgb(1, 1, 1) });
    lines.forEach((line, n) => drawWords(c, line, LEFT + 32, c.y - 17.5 - n * 14.5, 10));
    c.y -= height + 6;
  });

  c.y -= 10;
  c.need(30);
  c.page.drawText(pdfText(`Typed name: ${input.agentName}`, fonts.regular), { x: LEFT, y: c.y - 12, size: 9, font: fonts.regular, color: MUTED });
  c.page.drawText(pdfText(`Confirmed in RealComply, ${formatSignedAt(input.confirmedAt)}.`, fonts.regular), {
    x: LEFT,
    y: c.y - 26,
    size: 9,
    font: fonts.regular,
    color: MUTED,
  });
  c.y -= 34;

  const total = c.pages.length;
  c.pages.forEach((page, i) => {
    page.drawLine({ start: { x: LEFT, y: 46 }, end: { x: RIGHT, y: 46 }, thickness: 0.6, color: LINE });
    page.drawText(pdfText(ACK_PDF_FOOTER, fonts.regular), { x: LEFT, y: 32, size: 8, font: fonts.regular, color: MUTED });
    const label = `Page ${i + 1} of ${total}`;
    page.drawText(label, { x: RIGHT - fonts.regular.widthOfTextAtSize(label, 8), y: 32, size: 8, font: fonts.regular, color: FAINT });
  });

  return checkedPdf(await doc.save(), "agent acknowledgement");
}

/** "Agent acknowledgement - Jane Smith.pdf", plain ASCII for a download header. */
export function agentAcknowledgementFilename(agentName: string): string {
  const safe = agentName.normalize("NFKD").replace(/[^\x20-\x7E]/g, "").replace(/[\\/:*?"<>|]/g, "").trim();
  return `Agent acknowledgement${safe ? ` - ${safe}` : ""}.pdf`;
}
