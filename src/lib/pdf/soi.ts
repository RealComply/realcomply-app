import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { pdfText } from "@/lib/pdf/text";
import { formatAuDate } from "@/lib/format-date";
import { MAX_MOST_COMPARABLE } from "@/lib/rules/comparables-rules";
import { SOI_REPORTS, soiTypeLabel, type SoiComparable, type SoiContent } from "@/lib/rules/soi";

// The Statement of Information, filled in on Fair Trading's approved form
// (s72C(2)(a); Reg s12H; 0121). Every word that isn't the agent's is the
// form's own, in its order: "About this form", "Property for sale", the
// metropolitan area statement that applies, Sections A and B, the 7 reports,
// who prepared it and when, and the factsheet. The form's own drafting notes
// ("[delete 1 or 2 as applicable]", "Delete Sections A or B as applicable")
// are carried out rather than printed: only the statement that applies is
// left, and Section A or B is left out when it doesn't apply. With 1 or 2
// comparable properties both are kept (see lib/rules/soi.ts).
//
// The agent's document, not RealComply's: no RealComply mark, no internal
// numbers. Plain text only for anything typed.

const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.35, 0.35, 0.35);
const RULE = rgb(0.75, 0.75, 0.75);
const SHADE = rgb(0.95, 0.95, 0.95);

const PAGE_W = 595.28; // A4 portrait, points
const PAGE_H = 841.89;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = 56;

export const SOI_FORM = {
  title: "Statement of Information",
  aboutHeading: "About this form",
  about: [
    "The NSW Commissioner for Fair Trading, NSW Department of Customer Service, as Secretary under the NSW Property and Stock Agents Act 2002 (the Act), has approved this form of the Statement of Information for section 72C of the Act.",
    "The real estate agent engaged to sell residential property is required to prepare this Statement of Information, regardless of whether they advertise the property for sale.",
    "A copy of this Statement of Information must be provided to a prospective buyer within two business days of them requesting a copy of it or the proposed contract for the sale of the property. This Statement of Information must also be included in any online advertisement for the sale of the property, either by including a copy of it as part of an advertisement or including a copy of it on a website that is directly linked to from an advertisement. This Statement of Information must also be displayed in a prominent place at the property at all times when the property is inspected by members of the public.",
    "The real estate agent must revise the Statement of Information within two business days of revising the estimated selling price if the agent takes into account different comparable properties as part of that revision.",
  ],
  propertyHeading: "Property for sale",
  addressLabel: "Address including suburb and postcode",
  typeLabel:
    "Type of residential property (house, terrace house, semi-detached, duplex, townhouse, villa, apartment, unit, or vacant land)",
  areaQuestion: "Is the property located in or outside a metropolitan area?",
  located: "This property is located:",
  metro:
    "in a metropolitan area, and this form provides information about comparable properties sold within 2 kilometres of the property for sale:",
  metroWhen: ["in the last 6 months; and/or", "in the last 12 months, if less than 3 comparable properties were sold in the last 6 months."],
  nonMetro:
    "outside a metropolitan area, and this form provides information about comparable properties sold within 5 kilometres of the property for sale in the last 18 months.",
  salesHeading: "Comparable property sales",
  sectionA: "Section A",
  sectionAIntro: "These are the 3 properties that the real estate agent considers to be most comparable to the property for sale.",
  columns: ["Property 1", "Property 2", "Property 3"],
  rows: [
    "Address of comparable property",
    "No. of bedrooms",
    "No. of bathrooms",
    "No. of parking spaces",
    "Approximate land size (m²) (if known by the real estate agent)",
    "Approximate total floor area of dwelling/s (m²) (if known by the real estate agent)",
    "Sold price ($)",
    "Date of sale",
    "Reasons why this is a comparable property (e.g. location, features, condition)",
  ],
  sectionB: "Section B",
  sectionBIntro: "The real estate agent reasonably believes that there are fewer than three comparable properties.",
  sectionBReasons: "Reasons why there are fewer than 3 comparable properties (e.g. location, features, condition)",
  reportsHeading: "Records of property reports and documents",
  reportsIntro:
    "When this Statement of Information was first prepared, the real estate agent was aware of the following documents in relation to the sale property. You can ask the real estate agent if the documents are available for repurchase when you request a copy of the contract for the sale of the property.",
  preparedHeading: "Statement of information",
  preparedOn: "This Statement of Information was prepared on:",
  preparedBy: "This Statement of Information was prepared by:",
} as const;

type Block =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "p"; text: string; bold?: boolean }
  | { kind: "bullet"; text: string; bold?: boolean };

/** The factsheet, word for word, in the form's order. */
export const SOI_FACTSHEET: Block[] = [
  { kind: "h1", text: "Factsheet: Property pricing and underquoting in NSW" },
  { kind: "h2", text: "What buyers and sellers need to know" },
  {
    kind: "p",
    bold: true,
    text: "Underquoting happens when a property is advertised or represented at a price that is lower than an agent’s reasonable estimate of what it is likely to sell for. It can mislead buyers, waste buyer’s time and money, and reduce confidence in the property market. If a property sells above the advertised price, this does not automatically mean underquoting. A higher sale price may be the result of strong buyer competition or changing market conditions.",
  },
  { kind: "h3", text: "FOR BUYERS" },
  { kind: "p", bold: true, text: "What to check" },
  { kind: "bullet", text: "Read this Statement of Information – it includes recent sales of similar properties in the area." },
  { kind: "bullet", text: "Check if the price changes during the campaign and ask why." },
  { kind: "p", bold: true, text: "Signs that may raise questions" },
  { kind: "bullet", text: "A price or price range is missing where one appears to be required." },
  { kind: "bullet", text: "Phrases such as “offers over”, “offers above” and/or similar wording or symbols are used." },
  { kind: "bullet", text: "Price appears much lower than similar recent sales." },
  { kind: "bullet", text: "The price changes without explanation." },
  { kind: "p", bold: true, text: "Tips" },
  { kind: "bullet", text: "Ask questions and get the facts before you invest time and money." },
  { kind: "bullet", text: "Remember, the advertised price or range is a guide, not a guarantee." },
  { kind: "h3", text: "FOR SELLERS" },
  { kind: "p", bold: true, text: "Your agent must" },
  {
    kind: "bullet",
    text: "Before entering into an agency agreement with you, provide you with a reasonable estimate of the likely selling price or price range with supporting evidence. The estimated selling price must consider comparable sales and other relevant information.",
  },
  { kind: "bullet", text: "Ensure the estimated selling price remains reasonable throughout the campaign." },
  {
    kind: "bullet",
    text: "Include a selling price or price range in advertisements that is not below the agent’s estimated selling price in the agreement, the highest bid (not including a vendor bid) before the property was passed-in at auction and any written offers rejected by you where the only reason is that the amount was too low.",
  },
  { kind: "bullet", text: "Update or remove non-compliant advertising." },
  { kind: "p", bold: true, text: "If your expectations differ from the estimate" },
  {
    kind: "bullet",
    text: "You can discuss pricing strategy with your real estate agent, but your instructions do not override their legal obligations.",
  },
  { kind: "bullet", text: "The advertised price cannot fall below the legal thresholds." },
  { kind: "p", bold: true, text: "If market conditions change" },
  { kind: "bullet", text: "The estimated selling price may need to be revised and non-compliant advertising must be updated." },
  { kind: "h3", text: "IF SOMETHING DOESN’T SEEM RIGHT" },
  { kind: "p", text: "Ask the agent - Ask for the basis of the price or an explanation of any price change." },
  {
    kind: "p",
    text: "Keep records - Keep copies or screenshots of online listings, price changes, communications, auction results, offers and any information provided.",
  },
  { kind: "p", text: "Report a concern- Contact NSW Fair Trading if you believe an agent may have breached the laws." },
  { kind: "h3", text: "WHERE TO GET HELP" },
  { kind: "p", bold: true, text: "NSW Fair Trading" },
  { kind: "p", text: "Website: nsw.gov.au/fair-trading" },
  { kind: "p", text: "Phone: 13 32 20" },
  { kind: "p", text: "Language assistance: 13 14 50" },
  { kind: "p", text: "(ask for an interpreter in your language)" },
  { kind: "p", text: "TTY: 1300 723 404 (for hearing impaired)" },
];

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      // A word wider than the cell (a long address with no spaces) is broken.
      let w = word;
      while (font.widthOfTextAtSize(w, size) > maxWidth && w.length > 1) {
        let cut = w.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > maxWidth) cut -= 1;
        if (line) {
          out.push(line);
          line = "";
        }
        out.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      const candidate = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

class Writer {
  doc: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];

  constructor(doc: PDFDocument, regular: PDFFont, bold: PDFFont) {
    this.doc = doc;
    this.regular = regular;
    this.bold = bold;
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - MARGIN;
  }

  need(h: number) {
    if (this.y - h < BOTTOM) this.newPage();
  }

  lines(text: string, size: number, width: number, bold = false): string[] {
    const font = bold ? this.bold : this.regular;
    return wrap(pdfText(text, font), font, size, width);
  }

  text(text: string, opts: { size?: number; bold?: boolean; indent?: number; gap?: number; color?: ReturnType<typeof rgb> } = {}) {
    const size = opts.size ?? 9.5;
    const font = opts.bold ? this.bold : this.regular;
    const indent = opts.indent ?? 0;
    const lh = size * 1.32;
    for (const line of this.lines(text, size, CONTENT_W - indent, opts.bold)) {
      this.need(lh);
      this.page.drawText(line, { x: MARGIN + indent, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= lh;
    }
    this.y -= opts.gap ?? 4;
  }

  bullet(text: string, opts: { bold?: boolean; indent?: number; size?: number } = {}) {
    const size = opts.size ?? 9.5;
    const indent = opts.indent ?? 0;
    const font = opts.bold ? this.bold : this.regular;
    const lh = size * 1.32;
    const lines = this.lines(text, size, CONTENT_W - indent - 14, opts.bold);
    lines.forEach((line, i) => {
      this.need(lh);
      if (i === 0) this.page.drawCircle({ x: MARGIN + indent + 4, y: this.y - size * 0.68, size: 1.6, color: INK });
      this.page.drawText(line, { x: MARGIN + indent + 14, y: this.y - size, size, font, color: INK });
      this.y -= lh;
    });
    this.y -= 3;
  }

  heading(text: string, size = 12) {
    this.need(size * 1.4 + 24);
    this.y -= 6;
    this.text(text, { size, bold: true, gap: 5 });
  }

  /** How tall a row will be. */
  rowHeight(cells: string[], widths: number[], opts: { size?: number; header?: boolean } = {}): number {
    const size = opts.size ?? 8.5;
    const pad = 4;
    const wrapped = cells.map((c, i) => this.lines(c, size, widths[i] - pad * 2, i === 0 || opts.header));
    return Math.max(...wrapped.map((l) => l.length)) * size * 1.3 + pad * 2;
  }

  /** A table row: cells side by side, each wrapped, ruled. The first cell is the label. */
  row(cells: string[], widths: number[], opts: { size?: number; labelBold?: boolean; header?: boolean } = {}) {
    const size = opts.size ?? 8.5;
    const lh = size * 1.3;
    const pad = 4;
    const wrapped = cells.map((c, i) => this.lines(c, size, widths[i] - pad * 2, (i === 0 && opts.labelBold !== false) || opts.header));
    const h = Math.max(...wrapped.map((l) => l.length)) * lh + pad * 2;
    this.need(h);
    let x = MARGIN;
    const top = this.y;
    cells.forEach((_, i) => {
      if (i === 0 || opts.header) this.page.drawRectangle({ x, y: top - h, width: widths[i], height: h, color: SHADE });
      this.page.drawRectangle({ x, y: top - h, width: widths[i], height: h, borderColor: RULE, borderWidth: 0.6 });
      const font = (i === 0 && opts.labelBold !== false) || opts.header ? this.bold : this.regular;
      wrapped[i].forEach((line, j) => {
        this.page.drawText(line, { x: x + pad, y: top - pad - size - j * lh + 1.5, size, font, color: INK });
      });
      x += widths[i];
    });
    this.y = top - h;
  }

  box(label: string, ticked: boolean) {
    const size = 9.5;
    const lh = size * 1.32;
    const lines = this.lines(label, size, CONTENT_W - 20);
    this.need(lines.length * lh + 4);
    const top = this.y;
    this.page.drawRectangle({ x: MARGIN, y: top - 10.5, width: 9, height: 9, borderColor: INK, borderWidth: 0.8 });
    if (ticked) {
      this.page.drawLine({ start: { x: MARGIN + 1.8, y: top - 6.2 }, end: { x: MARGIN + 3.9, y: top - 8.8 }, thickness: 1.2, color: INK });
      this.page.drawLine({ start: { x: MARGIN + 3.9, y: top - 8.8 }, end: { x: MARGIN + 7.6, y: top - 2.8 }, thickness: 1.2, color: INK });
    }
    lines.forEach((line, i) => {
      this.page.drawText(line, { x: MARGIN + 20, y: top - size - i * lh, size, font: this.regular, color: INK });
    });
    this.y = top - lines.length * lh - 4;
  }
}

const money = (n: number | null) => (n === null ? "" : `$${Math.round(n).toLocaleString("en-AU")}`);
const num = (n: number | null) => (n === null ? "" : Number.isInteger(n) ? String(n) : n.toLocaleString("en-AU", { maximumFractionDigits: 1 }));

function cellsFor(c: SoiComparable | undefined): string[] {
  if (!c) return Array(SOI_FORM.rows.length).fill("");
  return [
    c.address,
    num(c.bedrooms),
    num(c.bathrooms),
    num(c.parking),
    num(c.landSizeSqm),
    num(c.floorAreaSqm),
    money(c.soldPrice),
    c.soldOn ? formatAuDate(c.soldOn) : "",
    c.reasons,
  ];
}

/** The statement as a PDF, on the approved form. */
export async function buildSoiPdf(content: SoiContent): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${SOI_FORM.title}: ${content.address}`);
  doc.setSubject(SOI_FORM.title);
  doc.setCreator("RealComply");
  doc.setProducer("RealComply");
  const w = new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));

  w.text(SOI_FORM.title, { size: 20, bold: true, gap: 10 });
  w.heading(SOI_FORM.aboutHeading);
  for (const p of SOI_FORM.about) w.text(p, { gap: 6 });

  w.heading(SOI_FORM.propertyHeading);
  const two = [190, CONTENT_W - 190];
  w.row([SOI_FORM.addressLabel, content.address], two, { size: 9 });
  w.row([SOI_FORM.typeLabel, soiTypeLabel(content.propertyType)], two, { size: 9 });
  w.y -= 6;

  w.heading(SOI_FORM.areaQuestion, 11);
  w.text(SOI_FORM.located, { bold: true });
  if (content.area === "metro") {
    w.text(SOI_FORM.metro, { bold: true, indent: 14 });
    for (const line of SOI_FORM.metroWhen) w.bullet(line, { bold: true, indent: 24 });
  } else {
    w.text(SOI_FORM.nonMetro, { bold: true, indent: 14 });
  }

  const comparables = content.comparables.slice(0, MAX_MOST_COMPARABLE);
  const label = 132;
  const col = (CONTENT_W - label) / 3;
  const widths = [label, col, col, col];
  const header = ["", ...SOI_FORM.columns];
  const columns = [0, 1, 2].map((i) => cellsFor(comparables[i]));
  const rows = SOI_FORM.rows.map((rowLabel, r) => [rowLabel, columns[0][r], columns[1][r], columns[2][r]]);
  // The heading and Section A on one page where they fit on one; otherwise
  // the table's heading row is repeated where it carries over.
  if (comparables.length > 0) {
    const tall = 90 + w.rowHeight(header, widths, { header: true }) + rows.reduce((h, r) => h + w.rowHeight(r, widths), 0);
    if (tall < PAGE_H - MARGIN - BOTTOM) w.need(tall);
  }
  w.heading(SOI_FORM.salesHeading);
  if (comparables.length > 0) {
    w.text(SOI_FORM.sectionA, { size: 11, bold: true });
    w.text(SOI_FORM.sectionAIntro, { bold: true, gap: 6 });
    w.row(header, widths, { header: true });
    for (const r of rows) {
      const page = w.page;
      w.need(w.rowHeight(r, widths));
      if (w.page !== page) w.row(header, widths, { header: true });
      w.row(r, widths);
    }
    w.y -= 8;
  }
  if (comparables.length < MAX_MOST_COMPARABLE) {
    w.text(SOI_FORM.sectionB, { size: 11, bold: true });
    w.text(SOI_FORM.sectionBIntro, { bold: true, gap: 6 });
    w.row([SOI_FORM.sectionBReasons, content.fewerReason ?? ""], two, { size: 9 });
    w.y -= 8;
  }

  w.heading(SOI_FORM.reportsHeading);
  w.text(SOI_FORM.reportsIntro, { bold: true, gap: 8 });
  const ticked = new Set<string>(content.reports);
  for (const r of SOI_REPORTS) w.box(r.label, ticked.has(r.key));

  w.heading(SOI_FORM.preparedHeading);
  w.row([SOI_FORM.preparedOn, formatAuDate(content.preparedOn)], two, { size: 9 });
  w.row([SOI_FORM.preparedBy, content.preparedBy], two, { size: 9 });

  // The factsheet starts on its own page, as on the form.
  w.newPage();
  for (const b of SOI_FACTSHEET) {
    if (b.kind === "h1") w.text(b.text, { size: 16, bold: true, gap: 4 });
    else if (b.kind === "h2") w.text(b.text, { size: 12, bold: true, color: MUTED, gap: 10 });
    else if (b.kind === "h3") w.heading(b.text, 10.5);
    else if (b.kind === "bullet") w.bullet(b.text, { bold: b.bold, size: 9 });
    else w.text(b.text, { bold: b.bold, size: 9, gap: 3 });
  }

  const total = w.pages.length;
  const font = w.regular;
  w.pages.forEach((page, i) => {
    const label = `Page ${i + 1} of ${total}`;
    page.drawText(label, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(label, 8), y: 28, size: 8, font, color: MUTED });
  });

  return doc.save();
}

/** The file name the PDF downloads as: "Statement of Information, 12 Harbour Street.pdf", plain ASCII. */
export function soiFilename(address: string): string {
  const street = address.split(",")[0]?.trim() || address.trim();
  const clean = street
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .'-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return clean ? `Statement of Information, ${clean}.pdf` : "Statement of Information.pdf";
}
