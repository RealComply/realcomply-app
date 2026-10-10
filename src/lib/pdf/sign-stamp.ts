import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Putting the signature ON the document.
//
// Adam, 8 Sep 2026: "there's no signature on these documents. We have a button
// that says sign. It labels the document as being signed. And then when you
// open it, there's no signature."
//
// He is right and it mattered. Signing recorded a row in signoff_signatures
// and left the uploaded PDF untouched, so RealComply knew the reconciliation
// was signed and the document itself did not. Hand that PDF to an auditor, an
// accountant or Fair Trading and it is an unsigned reconciliation statement —
// the register's own knowledge does not travel with the file, and the file is
// what gets sent.
//
// A signature that exists only in our database is evidence WE hold; a
// signature on the page is evidence the AGENCY holds. They should not be
// different things.
//
// WHAT THIS SIGNATURE IS, AND IS NOT (Adam asked, 8 Sep 2026, and the answer
// changed the wording on the page). Nothing in the trust provisions requires a
// reconciliation statement to be signed. cl 27(5)(b) says the licensee must
// "prepare a statement reconciling" — prepare, not sign. cl 30(2)(a) asks the
// trial balance to specify its month and date of preparation and is silent on
// signatures. The only signature the trust provisions require is on a cheque,
// cl 25(3)(d).
//
// So this page is not evidence of a signing obligation. It is evidence of
// REVIEW, which is what s32(3)(b) and (c) ask of a licensee in charge —
// establish procedures and monitor that they are followed — and what an
// auditor under s111 actually looks for. The page says that in terms, and
// deliberately does not claim cl 27 required it.
//
// THE ORIGINAL IS NEVER MODIFIED. This writes a NEW file and the upload stays
// exactly as it arrived, byte for byte. Two reasons, and the second is the
// real one. First, a stamped copy that goes wrong must not take the only copy
// of the report with it. Second, "the document as uploaded" and "the document
// as signed" are different records and an auditor may reasonably want to see
// that they differ only by the page we added.
//
// A PAGE APPENDED, NOT A BLOCK OVERLAID. Property Tree and its peers produce
// reports of unpredictable layout; stamping into a corner works until the
// month a table runs long and the signature lands on top of the figures.
// Covering a number on a trust reconciliation to make room for a signature is
// a far worse outcome than an extra page.
//
// Electronic Transactions Act 2000 (NSW) s9 is what makes a typed, adopted
// name a signature here: the method identifies the person and indicates their
// approval, and it is as reliable as appropriate for the purpose. The page
// says so in terms, because the page has to stand up on its own once it has
// left this system.

const INK = rgb(0.051, 0.122, 0.098);
const MUTED = rgb(0.361, 0.435, 0.408);
const FAINT = rgb(0.561, 0.639, 0.608);
const GREEN = rgb(0.047, 0.651, 0.471);
const BORDER = rgb(0.894, 0.914, 0.902);

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 56;

export type Signatory = {
  /** The signer's name, off their authenticated profile. */
  name: string;
  /** Printed instead when the font cannot draw any of the name (see pdfText). */
  email?: string | null;
  /** Their role, e.g. "Licensee in charge". */
  role: string;
  /** ISO timestamp of the signature. */
  signedAt: string;
};

export type SignatureStamp = {
  /** What was signed, e.g. "PM Trust Account reconciliation — July 2026". */
  title: string;
  /** The agency's own name. This is their record. */
  agencyName: string;
  /**
   * EVERYONE who has signed so far, not just the person who signed last.
   *
   * The single-signer version of this was a bug waiting for the Supervision
   * Guidelines. A reconciliation is signed by the licensee alone, so one name
   * was enough; an SG version is published for all staff, and each signature
   * rebuilt the copy naming only that person — so after three people signed,
   * the document showed the third and the first two were nowhere on it. That
   * is the exact fault Adam reported on 8 Sep, re-created one document type
   * over. The copy is now rebuilt from the untouched original on every
   * signature, listing everyone recorded to date.
   */
  signatories: Signatory[];
  /** The uploaded file this signature applies to. */
  documentFileName: string;
  /** The legal basis line for the underlying obligation. */
  legalBasis?: string;
};

// Standard PDF fonts are WinAnsi-encoded and throw on anything outside it.
// A compliance document must never fail to produce because somebody's name or
// a file name carries a curly apostrophe.
//
// KEEP WHAT THE FONT CAN DRAW (10 Oct 2026). This used to strip everything
// outside plain ASCII, so "José Müller" signed as "Jos Mller" and a name
// written in Chinese left an empty signature line — the page naming the signer
// wrongly, or not at all. WinAnsi covers é, ü, ë and the rest of Western
// European Latin, so those now stay. A letter it cannot draw is tried without
// its accent (ễ → e, Ş → S) before it is dropped, so a name is spelt as near
// as the font allows rather than with holes in it.
function drawable(ch: string, font: PDFFont): boolean {
  try {
    font.encodeText(ch);
    return true;
  } catch {
    return false;
  }
}

function pdfText(text: string, font: PDFFont): string {
  const cleaned = text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[\x00-\x1F\x7F]/g, "");
  let out = "";
  for (const ch of cleaned) {
    if (drawable(ch, font)) {
      out += ch;
      continue;
    }
    for (const bare of ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "")) {
      if (drawable(bare, font)) out += bare;
    }
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = pdfText(text, font).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

function formatSignedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Sydney, because that is where the licensee signed and where the obligation
  // sits. A UTC timestamp on a NSW trust record invites an argument about
  // whether something was done inside the 21 days.
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/**
 * Draws the signature page into an existing document.
 *
 * Exported separately so a non-PDF upload (a spreadsheet export, a scan saved
 * as .xlsx) can still get a signature certificate of its own — see
 * buildSignatureCertificate.
 */
async function drawSignaturePage(pdf: PDFDocument, stamp: SignatureStamp): Promise<void> {
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const many = stamp.signatories.length > 1;
  const contentW = A4.w - MARGIN * 2;
  const top = A4.h - MARGIN;

  // AS MANY PAGES AS IT TAKES (10 Oct 2026). This drew everything onto one
  // A4 page with nothing watching the bottom margin. An SG version is signed
  // by the whole office, so from about six signers the closing paragraphs ran
  // into the footer, and from nine the later names were drawn below the edge
  // of the page — a signed copy, the file handed to an auditor, that did not
  // show everyone who signed. Each block now checks it fits and starts a new
  // page when it does not, and every page carries the footer.
  const pages: PDFPage[] = [];
  let page = pdf.addPage([A4.w, A4.h]);
  pages.push(page);
  let y = top;

  const line = (
    text: string,
    opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number } = {},
  ) => {
    const size = opts.size ?? 10;
    const font = opts.font ?? regular;
    const lines = wrap(text, font, size, contentW);
    // A paragraph moves to the next page whole rather than splitting.
    fit(lines.length * size * 1.45);
    for (const l of lines) {
      fit(size * 1.45);
      page.drawText(l, { x: MARGIN, y: y - size, size, font, color: opts.color ?? INK });
      y -= size * 1.45;
    }
    y -= opts.gap ?? 0;
  };

  // A continuation page names the document again, so it still says what was
  // signed if it is ever separated from the page before it.
  const newPage = () => {
    page = pdf.addPage([A4.w, A4.h]);
    pages.push(page);
    y = top;
    line(`${many ? "Signatures" : "Signature"}, continued: ${stamp.title}`, {
      size: 9,
      font: bold,
      color: FAINT,
      gap: 14,
    });
  };

  const fit = (height: number) => {
    if (y - height < MARGIN) newPage();
  };

  const rule = (gapAbove = 8, gapBelow = 10) => {
    // A divider at the foot of a page divides nothing; the new page is the break.
    if (y - gapAbove - gapBelow < MARGIN) {
      newPage();
      return;
    }
    y -= gapAbove;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: A4.w - MARGIN, y },
      thickness: 0.75,
      color: BORDER,
    });
    y -= gapBelow;
  };

  line(many ? "Signatures" : "Signature", { size: 20, font: bold, gap: 2 });
  line(stamp.agencyName, { size: 11, color: MUTED, gap: 6 });
  rule(4, 14);

  line("Document reviewed and signed", { size: 8.5, font: bold, color: FAINT });
  line(stamp.title, { size: 13, font: bold, gap: 4 });
  line(`File: ${stamp.documentFileName}`, { size: 9, color: MUTED, gap: 2 });
  // The clause the DOCUMENT answers, labelled as such. Nothing in the trust
  // provisions requires this statement to be signed — see the note above
  // SIGNED_BASIS in signoffs.ts — so the page must not imply that it does.
  if (stamp.legalBasis) line(`Record required by ${stamp.legalBasis}`, { size: 9, color: FAINT, gap: 0 });

  rule(16, 20);

  // Each signature drawn large and in the italic face so it reads as a
  // signature rather than another line of the form. It is a name adopted as a
  // signature and the page says exactly that underneath — dressing it up as
  // handwriting would misrepresent what happened.
  line(many ? "Reviewed and signed off by" : "Reviewed and signed off by", {
    size: 8.5,
    font: bold,
    color: FAINT,
    gap: 4,
  });

  // A name per signature, smaller where there are several, so a document
  // signed by eight people does not run to four pages of signature blocks.
  const sigSize = many ? 18 : 26;
  // One signer's name, line, role and time, kept together on one page.
  const blockHeight = sigSize * 1.3 + 12 + 9.5 * 1.45 + 1 + 9 * 1.45 + (many ? 12 : 0);
  for (const s of stamp.signatories) {
    fit(blockHeight);
    // A name the font cannot draw at all (one written in Chinese, say) would
    // leave the line blank; their account's email identifies them instead.
    const name = pdfText(s.name, italic).trim() || pdfText(s.email ?? "", italic).trim();
    page.drawText(name, { x: MARGIN, y: y - sigSize, size: sigSize, font: italic, color: INK });
    y -= sigSize * 1.3;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: MARGIN + Math.min(contentW, many ? 220 : 300), y },
      thickness: 1,
      color: GREEN,
    });
    y -= 12;
    line(s.role, { size: 9.5, font: bold, gap: 1 });
    line(`Signed ${formatSignedAt(s.signedAt)} (Sydney time)`, { size: 9, color: MUTED, gap: many ? 12 : 0 });
  }

  rule(20, 14);

  line(
    (many
      ? "Each person named above confirmed in RealComply, from their own authenticated account, that they had reviewed this document. Their names are taken from those accounts and each time was recorded by the system. "
      : "The person named above confirmed in RealComply, from their own authenticated account, that they had reviewed this document. Their name is taken from that account and the time was recorded by the system. ") +
      "Under section 9 of the Electronic Transactions Act 2000 (NSW), a method that identifies the person and indicates their approval of a document satisfies a requirement for a signature where the method is as reliable as appropriate for the purpose.",
    { size: 8.5, color: MUTED, gap: 8 },
  );
  line(
    "This sign-off records the review of the document by the people named. It is kept as evidence of proper supervision under section 32 of the Property and Stock Agents Act 2002 (NSW).",
    { size: 8.5, color: MUTED, gap: 8 },
  );
  // Room is made before the wording is chosen, so it can say "these pages"
  // when the signatures ran to more than one.
  const severalPages =
    "The pages before these signature pages are the document as it was uploaded. They have not been altered by the addition of these pages.";
  fit(wrap(severalPages, regular, 8.5, contentW).length * 8.5 * 1.45);
  line(
    pages.length > 1
      ? severalPages
      : "The pages before this one are the document as it was uploaded. They have not been altered by the addition of this page.",
    { size: 8.5, color: MUTED, gap: 0 },
  );

  const generated = `Generated by RealComply on ${formatSignedAt(new Date().toISOString())}`;
  pages.forEach((p, i) => {
    const footer = pages.length > 1 ? `${generated} - signature page ${i + 1} of ${pages.length}` : generated;
    p.drawText(pdfText(footer, regular), {
      x: MARGIN,
      y: MARGIN - 12,
      size: 7.5,
      font: regular,
      color: FAINT,
    });
  });
}

/**
 * The uploaded PDF with a signature page appended. Returns null when the bytes
 * are not a PDF we can open — the caller falls back to a standalone
 * certificate rather than failing the signature.
 */
export async function appendSignaturePage(
  original: Uint8Array,
  stamp: SignatureStamp,
): Promise<Uint8Array | null> {
  try {
    // Some agency software emits PDFs with minor structural faults that are
    // fine in a viewer. Better to accept those than refuse to sign.
    const pdf = await PDFDocument.load(original, { ignoreEncryption: true });
    await drawSignaturePage(pdf, stamp);
    return await pdf.save();
  } catch (e) {
    console.error("appendSignaturePage failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * A one-page signature certificate that stands alone.
 *
 * For an upload we cannot open and add to — a spreadsheet export, an encrypted
 * PDF. The signature still has to exist as a document somebody can file next
 * to the report, because the alternative is the state Adam found: a register
 * that says signed and a file that shows nothing.
 */
export async function buildSignatureCertificate(stamp: SignatureStamp): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  await drawSignaturePage(pdf, stamp);
  return await pdf.save();
}
