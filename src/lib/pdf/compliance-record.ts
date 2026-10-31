import { photoNoticeRecordLines, type TenantPhotoData } from "@/lib/rules/tenant-photo-notice";
import { LineCapStyle, PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatSignedAt } from "./sign-stamp";
import { embedSignatureFont, signatureFontCanDraw } from "./signature-font";
import { pdfText } from "./text";
import { STAGE_LABELS, type Property, type PropertyItem, type PropertyStage } from "@/lib/types";
import type { ComplianceItem } from "@/lib/rules/nsw-sales";
import type { PriceApproval } from "@/lib/rules/price-statement";
import { saleRecordLines } from "@/lib/rules/sale-price";
import { formatAuDate } from "@/lib/format-date";
import { questionAndDocumentRecordLines } from "@/lib/rules/question-card";
import { naRecordLines, readNa } from "@/lib/rules/not-applicable";
import { checkedPdf } from "@/lib/pdf/checked-pdf";

/** The answer, tick or upload under a question or document card, with who and when (Sydney). */
const questionAndDocumentLines = (item: ComplianceItem, current: PropertyItem | undefined): string[] =>
  questionAndDocumentRecordLines(item, current, (iso) => `${formatSignedAt(iso)} (Sydney time)`);

/** "Not applicable" under a card that offers it, with who and when (Sydney). */
const notApplicableLines = (item: ComplianceItem, current: PropertyItem | undefined): string[] =>
  naRecordLines(item, current, (iso) => `${formatSignedAt(iso)} (Sydney time)`);

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
const HOUSE = rgb(0.086, 0.188, 0.165); // #16302a, RealComply's mark
const TICK = rgb(0.18, 0.8, 0.561); // #2ecc8f

const PAGE_W = 595.28; // A4 portrait, points
const PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BAND_H = 48; // the RealComply band at the foot of every page
const BOTTOM = 66; // content stops here, clear of the band

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont; signature: PDFFont };

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

// Text on the page goes through pdfText (./text.ts), which keeps every letter
// the font can draw. This plain-ASCII version is for the file name only, which
// has to survive every browser, mail client and zip tool it passes through.
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
  /** Every page of the record itself, for the footers stamped at the end. */
  pages: PDFPage[] = [];
  /**
   * Marks EVERY page when the file has not been signed off.
   *
   * Adam, 9 Sep 2026: "you can download the audit pack at any point in time in
   * the listing. I feel like we're missing the step where the audit pack
   * actually gets signed off." The sign-off step existed — what was missing is
   * that an unsigned pack said nothing about being unsigned, while its heading
   * read "Finalised compliance record".
   *
   * On every page rather than only the first, because pages get separated.
   * Somebody prints the pack, it sits in a folder, half of it is photocopied
   * for a solicitor — and any page that leaves on its own has to be able to say
   * what it is. Same reasoning as the signature page on a trust reconciliation:
   * the document has to carry its own status once it has left this system.
   */
  draftMark: string | null = null;

  constructor(doc: PDFDocument, fonts: Fonts) {
    this.doc = doc;
    this.fonts = fonts;
    this.page = doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - MARGIN;
  }

  /** Start a new page if the next block would not fit. */
  need(height: number) {
    if (this.y - height < BOTTOM) {
      this.page = this.doc.addPage([PAGE_W, PAGE_H]);
      this.pages.push(this.page);
      this.y = PAGE_H - MARGIN;
    }
  }

  /**
   * The RealComply band at the foot of every page of the record (Adam, 12 Oct
   * 2026): the agency leads at the top, and RealComply signs every page at the
   * bottom, "Page 1 of 6" beside it. Stamped once the record is finished,
   * because "of 6" is not known until then. Appended documents are other
   * people's pages and are left alone.
   */
  stampFooters() {
    const total = this.pages.length;
    this.pages.forEach((page, i) => this.footer(page, i + 1, total));
  }

  private footer(page: PDFPage, pageNo: number, total: number) {
    const { regular, bold } = this.fonts;
    page.drawLine({ start: { x: 0, y: BAND_H }, end: { x: PAGE_W, y: BAND_H }, thickness: 0.75, color: BORDER });

    // The mark, from the same paths as components/Logo.tsx, with its 1.2
    // horizontal stretch worked into the numbers. 48 units square.
    const MARK = 19.5;
    const s = MARK / 48;
    const top = BAND_H / 2 + MARK / 2;
    page.drawSvgPath("M10.8 43 L10.8 21 L6 21 L24 7 L42 21 L37.2 21 L37.2 43 Z", {
      x: MARGIN,
      y: top,
      scale: s,
      color: HOUSE,
    });
    page.drawSvgPath("M15.6 31 L21.6 36 L32.4 25.5", {
      x: MARGIN,
      y: top,
      scale: s,
      borderColor: TICK,
      borderWidth: 4,
      borderLineCap: LineCapStyle.Round,
    });

    const textX = MARGIN + MARK + 8;
    page.drawText("Real", { x: textX, y: 26, size: 10.5, font: bold, color: INK });
    page.drawText("Comply", { x: textX + bold.widthOfTextAtSize("Real", 10.5), y: 26, size: 10.5, font: bold, color: GREEN });
    page.drawText(pdfText("Compliance records for NSW real estate agencies · realcomply.com.au", regular), {
      x: textX,
      y: 15,
      size: 7.5,
      font: regular,
      color: MUTED,
    });

    const label = `Page ${pageNo} of ${total}`;
    const right = PAGE_W - MARGIN;
    page.drawText(label, {
      x: right - regular.widthOfTextAtSize(label, 8),
      y: this.draftMark ? 15 : 21,
      size: 8,
      font: regular,
      color: FAINT,
    });
    if (this.draftMark) {
      const mark = pdfText(this.draftMark, bold);
      page.drawText(mark, { x: right - bold.widthOfTextAtSize(mark, 8), y: 27, size: 8, font: bold, color: AMBER });
    }
  }

  text(
    content: string,
    opts: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      indent?: number;
      gap?: number;
      /** Narrower than the page, for the agency's name beside its logo. */
      width?: number;
    } = {},
  ) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    const indent = opts.indent ?? 0;
    const lineHeight = size * 1.4;
    const lines = wrap(pdfText(content, font), font, size, (opts.width ?? CONTENT_W) - indent);
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

export type Attachment = {
  /** What this document is, in the words the card uses. */
  title: string;
  fileName: string;
  /** Absent where the file could not be read, or is a kind we cannot append. */
  bytes: Uint8Array | null;
  kind: "pdf" | "png" | "jpg" | "other";
  /** Why it is not attached, where it is not. Shown in the index. */
  omittedBecause?: string;
  /**
   * The stored file itself is empty or will not open (19 Oct 2026), so
   * "held on file" would not be true: the index says it needs uploading
   * again instead.
   */
  needsUploadingAgain?: boolean;
};

export type ComplianceRecordInput = {
  property: Property;
  /** The agency's own (trading) name. This is their document; RealComply made it. */
  agencyName: string;
  /**
   * The name at the top of the cover: "[licensed entity name] trading as
   * [trading name]", or the trading name alone (brief, 14 Oct 2026). The
   * trading name when not given. The title, author and file name keep the
   * trading name.
   */
  agencyLine?: string;
  /**
   * The agent this listing belongs to. Shown under the office name, and it is
   * the whole masthead for an agency with no logo — the individual-agent case
   * (Adam, 23 Aug 2026: "the office name then the agent's name without a
   * logo").
   */
  agentName: string | null;
  /**
   * The agency's own logo, already fetched. PNG or JPEG only: pdf-lib embeds
   * those two and nothing else, which is why the upload control refuses SVG
   * rather than accepting it and failing here, where the agent cannot see it.
   *
   * Null means no logo, which is not a degraded state — it is the individual
   * agent, and the text masthead is the correct output for them.
   */
  logo: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  items: ComplianceItem[];
  byKey: Record<string, PropertyItem | undefined>;
  /**
   * The agent's own words on how the estimate was formed, reproduced in full.
   *
   * This is the one piece of free text in the whole file that a regulator is
   * likely to actually read: s72A(5) requires evidence the estimate was
   * reasonable, and s74 lets the Secretary demand it be substantiated. A record
   * that says "ESP reasoning recorded - done" and omits the reasoning proves
   * nothing at all.
   */
  espReasoning: string | null;
  /** Where the agent said their reasoning is held, when it is not in RealComply. */
  espReasoningElsewhere?: string | null;
  /**
   * The sales the agent weighed, and how they weighed them.
   *
   * Belongs in the pack for the same reason the reasoning does, and arguably
   * more so: "relied on these three, ruled that one out because it was
   * renovated" IS the methodology, and a reader asking under s74 how the
   * estimate was reached is asking exactly this. Stage 2 of the underquoting
   * reforms is expected to make a methodology record a statutory obligation.
   *
   * Sales the agent never marked are deliberately still listed. They were in
   * the report the file holds as evidence, and quietly printing only the
   * flattering ones would misrepresent what was in front of the agent.
   */
  comparables: ComparableForRecord[];
  /**
   * Properties on the market as at the agency agreement date, and how the
   * agent treated each (29 Sep 2026 — Stephen Borg's point that the ESP
   * reasoning should consider the competition as well as the sales).
   * Optional so older callers keep working; an empty list prints nothing.
   */
  marketListings?: MarketListingForRecord[];
  /** The agent confirmed nothing comparable was on the market at the agreement date (2 Oct 2026). */
  noneOnMarket?: boolean;
  /** The agency agreement date (a3), which the on-market list is "as at". */
  agreementDate?: string | null;
  /**
   * The licensee's approval of the price statement (b4): the words, who, when,
   * and whether in the app or through the emailed link (12 Oct 2026). Printed
   * under the b4 line, because a tick that says "approved" without saying what
   * was approved is the gap b4's note was added to close. Optional so older
   * callers keep working; null prints nothing.
   */
  priceApproval?: PriceApproval | null;
  /**
   * Complaints the office linked to this listing, with their files (0101,
   * Adam 30 Oct 2026). Only ever given where the caller may see complaints:
   * the licensee in charge, or an office manager since 0102 (the database
   * returns none to anyone else).
   * Optional so older callers keep working; an empty list prints nothing.
   */
  complaints?: ComplaintForRecord[];
  /** Typed-name attestations, reproduced with the date each was given. */
  signatures: {
    agent: { typedName: string; signedAt: string | null } | null;
    licensee: { typedName: string; signedAt: string | null } | null;
  };
  /**
   * Source documents appended after the summary (Adam, 24 Aug 2026).
   *
   * PDFs have their pages copied in; images become a page of their own.
   * Anything else is listed in the index as held-but-not-attached rather than
   * silently omitted — a document missing from a pack with no explanation is
   * worse than one the pack tells you to go and ask for.
   */
  attachments: Attachment[];
  rulesetVersion: string;
  preparedFor: string;
  generatedAt: Date;
};

export type ComplaintForRecord = {
  /** "12 October 2026" */
  received: string;
  complainant: string;
  nature: string;
  /** "Open", "Under review", "Resolved 28 October 2026" */
  status: string;
  /** "complaint-email.eml · Added 30 Oct 2026, 2:14 pm by Jordan Ellis" */
  files: string[];
  /** "photo.jpg · Removed 30 Oct 2026, 2:20 pm by Jordan Ellis" */
  removed: string[];
};

export type ComparableForRecord = {
  address: string;
  salePrice: number | null;
  saleDate: string | null;
  weighting: "relied" | "considered" | "not_comparable" | null;
  agentNote: string | null;
};

export type MarketListingForRecord = {
  address: string;
  askingPrice: string | null;
  saleMethod: string | null;
  listedDate: string | null;
  weighting: "competition" | "considered" | null;
  agentNote: string | null;
};

const LISTING_WEIGHTING_LABEL: Record<string, string> = {
  competition: "Direct competition",
  considered: "Considered",
};

const WEIGHTING_LABEL: Record<string, string> = {
  relied: "Relied on",
  considered: "Considered",
  not_comparable: "Not comparable",
};

export async function buildComplianceRecordPdf(input: ComplianceRecordInput): Promise<Uint8Array> {
  const {
    property,
    agencyName,
    agencyLine,
    agentName,
    logo,
    items,
    byKey,
    espReasoning,
    espReasoningElsewhere = null,
    comparables,
    marketListings = [],
    noneOnMarket = false,
    agreementDate = null,
    priceApproval = null,
    complaints = [],
    signatures,
    attachments,
    rulesetVersion,
    preparedFor,
    generatedAt,
  } = input;

  // SIGNED, OR NOT. Everything below turns on this one question.
  //
  // The pack can be produced at any point in a listing, and that is deliberate
  // — an agent checking their own work mid-campaign is a good thing. What was
  // wrong is that an unsigned pack was indistinguishable from a finished one:
  // same heading, same filename, and the signature block simply absent rather
  // than shown as outstanding. A missing section reads as "nothing to say
  // here", which on a compliance record is the wrong message entirely.
  //
  // Both signatures are required in every case. Where the agent IS the
  // licensee, they give both — send_licensee is the only step that disappears
  // in that arrangement (see nsw-sales.ts), not the signature.
  const missingSignatures = [
    signatures.agent ? null : "the agent",
    signatures.licensee ? null : "the licensee in charge",
  ].filter((s): s is string => s !== null);
  const isDraft = missingSignatures.length > 0;

  const doc = await PDFDocument.create();
  doc.setTitle(
    isDraft
      ? `DRAFT - ${agencyName} - compliance record - ${property.address}`
      : `${agencyName} - compliance record - ${property.address}`,
  );
  doc.setAuthor(agencyName);
  doc.setSubject(rulesetVersion);
  doc.setProducer("RealComply");
  doc.setCreationDate(generatedAt);

  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    signature: await embedSignatureFont(doc),
  };

  const c = new Cursor(doc, fonts);
  if (isDraft) c.draftMark = "DRAFT - not yet signed off";

  // Masthead.
  //
  // The AGENCY leads, not us (Adam, 23 Aug 2026): this is the document the
  // agency hands to Fair Trading and it should read as theirs. Laid out to
  // the design Adam approved on 12 Oct 2026 (audit pack 4): the office name
  // and the agent on the left, their logo on the right, level with them; the
  // title under both, then a line. RealComply is no longer a line up here: it
  // signs the foot of every page instead (Cursor.stampFooters).
  //
  // No logo is not a fallback. An individual agent has no office branding to
  // apply, and a text masthead is the right output for them rather than a
  // second-class version of somebody else's.
  c.page.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: GREEN });

  let nameWidth = CONTENT_W;
  let logoBottom = c.y;
  if (logo) {
    const image = logo.type === "png" ? await doc.embedPng(logo.bytes) : await doc.embedJpg(logo.bytes);
    // Fit inside a box rather than forcing a size, so a wide wordmark and a
    // square badge both come out looking deliberate. About the height of the
    // name and the agent's line beside it.
    const MAX_W = 160;
    const MAX_H = 44;
    const scale = Math.min(MAX_W / image.width, MAX_H / image.height, 1);
    const w = image.width * scale;
    const h = image.height * scale;
    c.page.drawImage(image, { x: PAGE_W - MARGIN - w, y: c.y - h, width: w, height: h });
    logoBottom = c.y - h;
    nameWidth = CONTENT_W - w - 20;
  }

  c.text(agencyLine ?? agencyName, { size: 17, bold: true, width: nameWidth });
  if (agentName) c.text(agentName, { size: 11, color: MUTED, width: nameWidth });
  c.y = Math.min(c.y, logoBottom) - 6;
  c.text(isDraft ? "Compliance record - DRAFT" : "Finalised compliance record", {
    size: 12.5,
    bold: true,
    color: isDraft ? AMBER : INK,
  });
  c.rule(6, 12);
  c.text(property.address, { size: 11, bold: true });
  c.text(
    `Generated ${formatAuDate(generatedAt.toISOString().slice(0, 10))} · ${rulesetVersion}`,
    { size: 8.5, color: FAINT },
  );
  c.text("Diligence support - verify with your adviser; the licensee decides.", {
    size: 8.5,
    color: FAINT,
  });
  c.y -= 16;

  // THE DRAFT NOTICE, above the open flags and above everything else.
  //
  // Stated positively — what this document IS and what is still outstanding —
  // rather than as a warning not to use it. Interim copies are a legitimate
  // thing to want: an agent checking their own file, a principal reviewing
  // before signing. What must not happen is one of those being mistaken for the
  // finished record, or handed to a regulator as one.
  //
  // Naming WHO has not signed rather than saying "unsigned", because that is
  // the actionable half. "Waiting on the licensee in charge" tells the agent
  // exactly what to chase; "not signed" leaves them to work it out.
  if (isDraft) {
    c.text("This is a draft, not the finalised record", { size: 11, bold: true, color: AMBER, gap: 4 });
    c.text(
      `Still to sign: ${missingSignatures.join(" and ")}. Until then this file is not closed out, ` +
        "and this copy should not be handed over as the completed compliance record.",
      { size: 9.5, color: MUTED },
    );
    c.text(
      "Everything below is accurate as at the date above. The finalised version carries both signatures.",
      { size: 8.5, color: FAINT },
    );
    c.rule(10, 14);
  }

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
      if (item.key === "t5") {
        const reasons = (byKey[item.key]?.data as { flagReasons?: string[] } | undefined)?.flagReasons ?? [];
        for (const r of reasons) c.text(r, { size: 8.5, color: MUTED, indent: 16 });
      }
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
      // A bare date under a status tells a reader nothing about what happened
      // on it. Where the card names its date — "Date the contract was
      // received" — the record says so too, because that is the whole reason
      // the field exists.
      const dated = current?.event_date
        ? item.dateLabel
          ? ` · ${item.dateLabel.toLowerCase()}: ${formatAuDate(current.event_date)}`
          : ` · ${formatAuDate(current.event_date)}`
        : "";
      c.text(item.label, { size: 9.5, bold: true, indent: 4 });
      // An optional upload card with nothing on it is optional, not "open"
      // (the Power of Attorney copy, 15 Oct 2026).
      // A card marked "Not applicable" says so rather than "done" (f4, 17 Oct 2026).
      const shownStatus =
        item.kind === "document" && status !== "done"
          ? "optional"
          : item.notApplicable && status === "done" && readNa(current?.data).notApplicable
            ? "not applicable"
            : status;
      c.text(`${shownStatus}${dated}`, {
        size: 9,
        color: status === "flagged" ? AMBER : MUTED,
        indent: 12,
      });
      // The Power of Attorney question: the answer and the tick, each with
      // who and when; and its document card: the upload, who and when.
      for (const line of questionAndDocumentLines(item, current)) {
        c.text(line, { size: 8.5, color: MUTED, indent: 12 });
      }
      for (const line of notApplicableLines(item, current)) {
        c.text(line, { size: 8.5, color: MUTED, indent: 12 });
      }
      if (item.key === "b4" && status === "done" && priceApproval) {
        // Two lines rather than one joined with a dot: the PDF's standard
        // fonts drop the dot, and the reader needs the words and the who on
        // their own lines anyway.
        if (priceApproval.text) {
          c.text(`Approved price statement: "${priceApproval.text}"`, { size: 9, indent: 12 });
        }
        const when = priceApproval.at ? `, ${formatSignedAt(priceApproval.at)} (Sydney time)` : "";
        c.text(
          priceApproval.via === "link"
            ? `Approved by ${priceApproval.name ?? "the licensee in charge"} through the emailed link to ${priceApproval.sentTo ?? "the licensee's email"}${when}`
            : `Approved in RealComply by the licensee in charge${when}`,
          { size: 8.5, color: MUTED, indent: 12 },
        );
      }
      // The sale price, what it was compared with, and any flag and the
      // agent's note (f0, 26 Oct 2026). The card no longer stays "flagged",
      // so this is where the record says it.
      if (item.key === "f0" && current) {
        for (const line of saleRecordLines(current.data)) c.text(line, { size: 8.5, color: MUTED, indent: 12 });
      }
      if (item.legalBasis) c.text(item.legalBasis, { size: 8, color: FAINT, indent: 12 });
      // t5 keeps its shoot date and the tenant's permission on the item, not
      // in the note, so the record prints them here.
      if (item.key === "t5" && current) {
        for (const line of photoNoticeRecordLines((current.data ?? {}) as TenantPhotoData, formatAuDate)) {
          c.text(line, { size: 8.5, color: MUTED, indent: 12 });
        }
      }
      c.y -= 5;
    }
    c.y -= 8;
  }

  // The agent's own reasoning, in full.
  //
  // Reproduced rather than summarised. s72A(5) wants evidence the estimate was
  // reasonable and s74 lets the Secretary demand it be substantiated, so a line
  // reading "ESP reasoning recorded - done" with the reasoning left out proves
  // nothing. If it runs to a page, it runs to a page.
  // The sales, and what the agent made of each one.
  //
  // Printed before the reasoning because that is the order the work happened
  // in: these are the facts the agent weighed, and the paragraph below is what
  // they concluded from them.
  if (comparables.length > 0) {
    c.rule(6, 10);
    c.text("Comparable sales considered", { size: 11, bold: true, gap: 4 });
    for (const comp of comparables) {
      c.need(30);
      const facts = [
        comp.salePrice !== null ? `$${Math.round(comp.salePrice).toLocaleString("en-AU")}` : null,
        comp.saleDate ? formatAuDate(comp.saleDate.slice(0, 10)) : null,
      ]
        .filter(Boolean)
        .join(", ");
      c.text(comp.address, { size: 9.5, bold: true });
      if (facts) c.text(facts, { size: 8.5, color: MUTED, indent: 12 });
      c.text(
        comp.weighting ? WEIGHTING_LABEL[comp.weighting] : "Not marked by the agent",
        { size: 8.5, color: comp.weighting ? MUTED : FAINT, indent: 12 },
      );
      if (comp.agentNote?.trim()) {
        c.text(comp.agentNote.trim(), { size: 8.5, color: MUTED, indent: 12 });
      }
      c.y -= 4;
    }
    c.text(
      "How the agent treated each sale, in their own words. Sales shown as not marked appeared in the comparable-sales report held on this file.",
      { size: 8, color: FAINT },
    );
  }

  // The competition, as at the agency agreement date (29 Sep 2026). Same
  // shape as the sales above, with one difference stated on the page: these
  // prices are other agents' advertised prices or guides, not sale prices,
  // and nothing here treats them as if they were.
  // When the agent confirmed nothing comparable was listed, the pack says so in
  // place of the list, rather than leaving the section out (2 Oct 2026). A
  // missing section reads as "never considered".
  if (marketListings.length > 0 || noneOnMarket) {
    c.rule(6, 10);
    const asAt = agreementDate ? formatAuDate(agreementDate.slice(0, 10)) : null;
    c.text(
      asAt ? `On the market as at ${asAt}` : "On the market as at the agency agreement date (not recorded)",
      { size: 11, bold: true, gap: 4 },
    );
    if (marketListings.length === 0) {
      c.text("The agent confirmed nothing comparable was on the market at this date.", {
        size: 9,
        color: MUTED,
      });
    }
    for (const l of marketListings) {
      c.need(30);
      const facts = [
        l.askingPrice?.trim() ? `Advertised: ${l.askingPrice.trim()}` : "No price advertised",
        l.saleMethod?.trim() || null,
        l.listedDate ? `listed ${formatAuDate(l.listedDate.slice(0, 10))}` : null,
      ]
        .filter(Boolean)
        .join(", ");
      c.text(l.address, { size: 9.5, bold: true });
      c.text(facts, { size: 8.5, color: MUTED, indent: 12 });
      c.text(l.weighting ? LISTING_WEIGHTING_LABEL[l.weighting] : "Not marked by the agent", {
        size: 8.5,
        color: l.weighting ? MUTED : FAINT,
        indent: 12,
      });
      if (l.agentNote?.trim()) {
        c.text(l.agentNote.trim(), { size: 8.5, color: MUTED, indent: 12 });
      }
      c.y -= 4;
    }
    c.text(
      "Properties for sale at the time, as listed in the comparable-sales report or added by the agent. Prices are other agents' advertised prices or guides, not sale prices.",
      { size: 8, color: FAINT },
    );
  }

  // Where the agent said their reasoning lives outside RealComply, the record
  // has to say so and say where. A record that simply omits this section
  // reads as "no reasoning was recorded", which is both wrong and the worst
  // possible thing for it to imply on the one item s74 is most likely to ask
  // about. Naming the location turns a silence into a pointer somebody can
  // follow. Where they also attached a copy, it is on the file already and
  // listed with the other evidence.
  if (espReasoningElsewhere) {
    c.rule(6, 10);
    c.text("How the estimated selling price was formed", { size: 11, bold: true, gap: 4 });
    c.text(`Recorded by the agent in: ${espReasoningElsewhere}`, {
      size: 9.5,
      color: MUTED,
      gap: 2,
    });
    c.text(
      "The agent recorded their reasoning outside this system and identified where it is held. s72A(5), Property and Stock Agents Act 2002 (NSW).",
      { size: 8, color: FAINT },
    );
  } else if (espReasoning && espReasoning.trim()) {
    c.rule(6, 10);
    c.text("How the estimated selling price was formed", { size: 11, bold: true, gap: 4 });
    c.text(espReasoning.trim(), { size: 9.5, color: MUTED, gap: 2 });
    c.text("In the agent's own words. s72A(5), Property and Stock Agents Act 2002 (NSW).", {
      size: 8,
      color: FAINT,
    });
  }

  // Signatures (Adam, 24 Aug 2026: "we should have signatures on the final
  // settlement PDF too").
  //
  // A typed name adopted as a signature, with the date it was given. Drawn as a
  // signature block rather than another checklist line, because that is what it
  // is: the two people who take responsibility for this file, named, on the
  // document handed over. A record that merely says "Licensee signature - done"
  // makes a reader go looking for who signed.
  // ALWAYS drawn, even when nobody has signed — which is the change of 9 Sep
  // 2026. It used to be skipped entirely when both were absent, so an unsigned
  // pack had no signature section at all. A missing section reads as "nothing
  // to say here"; an outstanding one that names who is still to sign says what
  // is actually true and what has to happen next.
  {
    // The heading goes with the first signature: on its own at the foot of a
    // page, with the signatures overleaf, it reads as a page left unsigned.
    c.need(10 + 12 + 11 * 1.4 + 6 + 46);
    c.rule(10, 12);
    c.text(isDraft ? "Signatures" : "Signed", { size: 11, bold: true, gap: 6 });

    const block = (role: string, sig: { typedName: string; signedAt: string | null } | null) => {
      c.need(46);
      if (!sig) {
        // Shown in the same shape as a real signature, so the space it will
        // occupy is visible and its absence is obvious at a glance.
        c.text("Not yet signed", { size: 12, bold: true, color: AMBER });
        c.text(role, { size: 8.5, color: FAINT });
        c.y -= 8;
        return;
      }
      // THE SIGNATURE ON THE PAGE (Adam, 12 Oct 2026: "There's no actual
      // signature on it ... same way we do for bank recs"). The adopted name
      // drawn large in the italic face on a green signature line, then the
      // role and the date and time it was given: the trust reconciliation's
      // signature block (sign-stamp.ts), so the two read the same.
      // In the handwriting face Adam chose (signature-font.ts), or the plain
      // italic for a name it cannot draw.
      const hand = signatureFontCanDraw(c.fonts.signature, sig.typedName);
      const SIG = hand ? 30 : 24;
      c.need(SIG * 1.3 + 12 + 9.5 * 1.45 + 9 * 1.45 + 10);
      c.page.drawText(hand ? sig.typedName.trim() : pdfText(sig.typedName, c.fonts.italic).trim(), {
        x: MARGIN,
        y: c.y - SIG,
        size: SIG,
        font: hand ? c.fonts.signature : c.fonts.italic,
        color: INK,
      });
      c.y -= SIG * 1.3;
      c.page.drawLine({ start: { x: MARGIN, y: c.y }, end: { x: MARGIN + 260, y: c.y }, thickness: 1, color: GREEN });
      c.y -= 12;
      c.text(role, { size: 9.5, bold: true });
      if (sig.signedAt) {
        c.text(`Signed ${formatSignedAt(sig.signedAt)} (Sydney time)`, { size: 9, color: MUTED });
      }
      c.y -= 12;
    };

    block("Agent", signatures.agent);
    block("Licensee in charge", signatures.licensee);

    c.text(
      "Typed names adopted as signatures in RealComply, recorded against this file and not editable once given.",
      { size: 8, color: FAINT },
    );
  }

  // Complaints linked to this listing, and their files (0101). After the
  // signatures: a complaint is not part of what was signed, and often arrives
  // after it. Each file is named, with who added it and when, and every file
  // removed from a complaint is listed with who removed it and when.
  if (complaints.length > 0) {
    c.rule(10, 12);
    c.text("Complaints about this listing", { size: 11, bold: true, gap: 4 });
    for (const k of complaints) {
      c.need(9.5 * 1.45 * 3);
      c.text(`Received ${k.received} · ${k.complainant} · ${k.status}`, { size: 9.5, bold: true, indent: 4 });
      c.text(k.nature, { size: 9, color: MUTED, indent: 14, gap: 1 });
      for (const f of k.files) c.text(`File: ${f}`, { size: 8.5, color: MUTED, indent: 14 });
      for (const f of k.removed) c.text(`Removed file: ${f}`, { size: 8.5, color: FAINT, indent: 14 });
      if (k.files.length === 0 && k.removed.length === 0) {
        c.text("No files.", { size: 8.5, color: FAINT, indent: 14 });
      }
      c.y -= 6;
    }
    c.text(
      "From the complaints register, kept by the licensee in charge. Files that are PDFs or photos are attached at the back; others are held on file in RealComply.",
      { size: 8, color: FAINT },
    );
  }

  // What is appended, listed before it appears.
  if (attachments.length > 0) {
    c.rule(10, 12);
    c.text(`Documents attached (${attachments.filter((a) => a.bytes).length})`, {
      size: 11,
      bold: true,
      gap: 4,
    });
    // Numbered as the Attachment pages below are, attached ones only: a
    // complaint email (.eml) is listed here but never attached (0101).
    let n = 0;
    attachments.forEach((a) => {
      if (a.bytes) {
        n += 1;
        c.text(`${n}. ${a.title}`, { size: 9.5, bold: true, indent: 4 });
        c.text(a.fileName, { size: 8.5, color: MUTED, indent: 14 });
      } else {
        c.text(`${a.title}`, { size: 9.5, bold: true, color: AMBER, indent: 4 });
        c.text(
          a.needsUploadingAgain
            ? `${a.fileName} - ${a.omittedBecause ?? "can't be opened"}. It needs uploading again.`
            : `${a.fileName} - ${a.omittedBecause ?? "not attached"}. Held on file.`,
          { size: 8.5, color: AMBER, indent: 14 },
        );
      }
    });
  }

  c.rule(8, 10);
  c.text(
    `Prepared for ${preparedFor}. This record reflects diligence-support content maintained in RealComply and is not legal advice.`,
    { size: 8, color: FAINT },
  );

  c.stampFooters();

  // ── Appended source documents ────────────────────────────────────────────
  //
  // Each gets a separator page naming it, so a thirty-page pack can be
  // navigated by someone who did not assemble it.
  //
  // A document that fails to open does NOT fail the export. An encrypted or
  // malformed PDF is entirely possible in a pile of files from solicitors and
  // valuers, and losing the whole record over one of them would be the worst
  // possible trade.
  let attachmentNo = 0;
  for (const a of attachments) {
    if (!a.bytes) continue;
    attachmentNo += 1;

    const sep = doc.addPage([PAGE_W, PAGE_H]);
    sep.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: GREEN });
    sep.drawText(`Attachment ${attachmentNo}`, {
      x: MARGIN,
      y: PAGE_H - 120,
      size: 9,
      font: fonts.regular,
      color: FAINT,
    });
    sep.drawText(pdfText(a.title, fonts.bold), {
      x: MARGIN,
      y: PAGE_H - 146,
      size: 18,
      font: fonts.bold,
      color: INK,
    });
    sep.drawText(pdfText(a.fileName, fonts.regular), {
      x: MARGIN,
      y: PAGE_H - 168,
      size: 9.5,
      font: fonts.regular,
      color: MUTED,
    });
    sep.drawText(pdfText(property.address, fonts.regular), {
      x: MARGIN,
      y: PAGE_H - 190,
      size: 9.5,
      font: fonts.regular,
      color: FAINT,
    });

    try {
      if (a.kind === "pdf") {
        const src = await PDFDocument.load(a.bytes);
        const copied = await doc.copyPages(src, src.getPageIndices());
        copied.forEach((pg) => doc.addPage(pg));
      } else if (a.kind === "png" || a.kind === "jpg") {
        const img = a.kind === "png" ? await doc.embedPng(a.bytes) : await doc.embedJpg(a.bytes);
        const page = doc.addPage([PAGE_W, PAGE_H]);
        const scale = Math.min((PAGE_W - MARGIN * 2) / img.width, (PAGE_H - MARGIN * 2) / img.height, 1);
        page.drawImage(img, {
          x: (PAGE_W - img.width * scale) / 2,
          y: (PAGE_H - img.height * scale) / 2,
          width: img.width * scale,
          height: img.height * scale,
        });
      }
    } catch {
      sep.drawText("This document could not be opened and is held on file in RealComply.", {
        x: MARGIN,
        y: PAGE_H - 220,
        size: 9.5,
        font: fonts.regular,
        color: AMBER,
      });
    }
  }

  return checkedPdf(await doc.save(), "compliance record");
}

/** A filename that survives Windows, macOS and email. */
export function complianceRecordFilename(
  property: Property,
  agencyName: string,
  generatedAt: Date,
  /**
   * Puts DRAFT at the FRONT of the filename when the file is not signed off.
   *
   * The front, not the end, because that is the half that survives: a file
   * listing truncates the middle, an email attachment shows the start, and a
   * folder sorted by name puts every draft together. A pack that is a draft
   * should be recognisable without opening it — which is the whole point, since
   * the moment somebody attaches one to an email is the moment nobody is
   * reading page one.
   */
  isDraft = false,
): string {
  const clean = (s: string) =>
    ascii(s)
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const stamp = generatedAt.toISOString().slice(0, 10);
  // Agency first, so a regulator with several agencies' packs in one folder can
  // sort them into piles without opening any of them.
  const base = `${clean(agencyName)} - compliance record - ${clean(property.address)} - ${stamp}.pdf`;
  return isDraft ? `DRAFT - ${base}` : base;
}
