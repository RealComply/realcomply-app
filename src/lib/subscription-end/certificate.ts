import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { longDate, longDateTime, sydneyDate } from "./dates";

// The deletion certificate (brief, item 7; DPA cl 4.8).
//
// Categories and counts only, never contents. The same document goes to the
// account holder and licensee in charge as a PDF, and RealComply's copy is
// kept in the activity store (deletion_certificates), not with the deleted
// data.
//
// WHAT REALCOMPLY KEEPS is worded to DPA cl 4.9 and the Privacy Policy, not to
// the 8 Oct mockup: internal identifiers, no names or addresses (Adam, 8 Oct
// 2026, "stick to what the T's and C's say").

export type DeletionCounts = {
  listings: number;
  pm_properties: number;
  documents: number;
  gifts: number;
  complaints: number;
  breaches: number;
  training_and_cpd: number;
  licence_records: number;
  trust_reconciliations: number;
  trust_audits: number;
  other_signoff_documents: number;
  user_accounts: number;
};

/** The rows of the certificate's table, in the order shown. */
export function certificateRows(c: DeletionCounts): Array<[string, number]> {
  const rows: Array<[string, number]> = [
    ["Listings and their compliance records", c.listings],
    ["Managed properties (property management)", c.pm_properties],
    ["Uploaded documents", c.documents],
    ["Gift register entries", c.gifts],
    ["Complaint register entries", c.complaints],
    ["Breach register entries", c.breaches],
    ["Training and CPD records", c.training_and_cpd],
    ["Licence records", c.licence_records],
    ["Trust account reconciliations", c.trust_reconciliations],
    ["Trust account audits", c.trust_audits],
    ["Other signed-off documents", c.other_signoff_documents],
    ["User accounts", c.user_accounts],
  ];
  // Property management only appears for an agency that used it.
  return rows.filter(([label, n]) => !(label.startsWith("Managed properties") && n === 0));
}

export type CertificateInput = {
  certificateNumber: string;
  subscriberName: string;
  endedAt: Date;
  deletedAt: Date;
  counts: DeletionCounts;
  /** YYYY-MM-DD: when RealComply's activity record is deleted. */
  activityDeleteAfter: string;
};

export const CERTIFICATE_CLOSING =
  "This certificate records categories and counts only. It does not record the contents of anything deleted. A copy is kept by RealComply.";

export function backupsSentence(): string {
  return "Copies held in backups are deleted as those backups expire, within 90 days of the date above.";
}

export function keepsSentence(activityDeleteAfter: string): string {
  return (
    "An activity record of what was checked, flagged and signed off, and when. It uses internal " +
    "identifiers rather than names or addresses, and contains no uploaded documents. It is kept " +
    `until ${longDate(activityDeleteAfter)} and then deleted.`
  );
}

const INK = rgb(0.051, 0.122, 0.098);
const MUTED = rgb(0.361, 0.435, 0.408);
const LINE = rgb(0.867, 0.89, 0.878);
const GREEN = rgb(0.047, 0.651, 0.471);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

// Standard fonts are WinAnsi only. A subscriber name with a curly apostrophe
// must never stop a certificate being written.
function ascii(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7e]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = ascii(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = words[0];
  for (const word of words.slice(1)) {
    const next = `${line} ${word}`;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

export async function buildCertificatePdf(input: CertificateInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Certificate of deletion ${input.certificateNumber}`);
  pdf.setAuthor("RealComply Pty Ltd");
  const page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = PAGE_H - MARGIN;

  const text = (s: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number } = {}) => {
    page.drawText(ascii(s), {
      x: opts.x ?? MARGIN,
      y,
      size: opts.size ?? 10.5,
      font: opts.font ?? regular,
      color: opts.color ?? INK,
    });
  };

  const paragraph = (s: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) => {
    const size = opts.size ?? 10.5;
    for (const line of wrap(s, opts.font ?? regular, size, CONTENT_W)) {
      text(line, opts);
      y -= size * 1.45;
    }
  };

  text("Real", { size: 16, font: bold });
  text("Comply", { size: 16, font: bold, color: GREEN, x: MARGIN + bold.widthOfTextAtSize("Real", 16) });
  y -= 18;
  text("RealComply Pty Ltd, ABN 61 700 934 792", { size: 9.5, color: MUTED });
  y -= 34;

  text("Certificate of deletion", { size: 20, font: bold });
  y -= 30;

  const kv: Array<[string, string]> = [
    ["Subscriber", input.subscriberName],
    ["Subscription ended", longDate(sydneyDate(input.endedAt))],
    ["Records deleted", `${longDateTime(input.deletedAt)} (Sydney)`],
    ["Certificate number", input.certificateNumber],
  ];
  for (const [k, v] of kv) {
    text(k, { color: MUTED });
    text(v, { x: MARGIN + 150 });
    y -= 17;
  }
  y -= 12;

  paragraph("The following records were permanently deleted from RealComply's live systems:");
  y -= 6;

  // The table.
  text("Category", { size: 9.5, font: bold, color: MUTED });
  const countX = (s: string, f: PDFFont, size: number) => MARGIN + CONTENT_W - f.widthOfTextAtSize(s, size);
  text("Count", { size: 9.5, font: bold, color: MUTED, x: countX("Count", bold, 9.5) });
  y -= 8;
  for (const [label, n] of certificateRows(input.counts)) {
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_W, y }, thickness: 0.6, color: LINE });
    y -= 15;
    text(label);
    const count = String(n);
    text(count, { x: countX(count, regular, 10.5) });
    y -= 6;
  }
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_W, y }, thickness: 0.6, color: LINE });
  y -= 26;

  text("Backups.", { font: bold });
  y -= 15;
  paragraph(backupsSentence());
  y -= 8;

  text("What RealComply keeps.", { font: bold });
  y -= 15;
  paragraph(keepsSentence(input.activityDeleteAfter));
  y -= 14;

  paragraph(CERTIFICATE_CLOSING, { size: 9.5, color: MUTED });

  return pdf.save();
}
