import type Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { askParts, buildDocumentBlock } from "@/lib/documents/read-core";
import { docxParagraphs, type DocxParagraph } from "@/lib/sg-document/docx";
import { readPartOf, type ReadParagraph, type ReadPartResult } from "@/lib/sg-document/sections";

// Reading an office's supervision guidelines into sections (part 1, 10 Nov
// 2026). Word or PDF, as the mockup says.
//
// A PDF is read a few pages at a time: the reader writes out every paragraph
// word for word and marks each top-level heading. Small parts keep every
// answer well inside the reader's length limit, and each part is kept as soon
// as it's read (lib/sg-document/advance.ts), so a long manual is never read
// twice and never runs into a time limit.
//
// A Word document's words are read in the app (lib/sg-document/docx.ts); the
// reader only says which paragraphs are the top-level headings, so the text
// is exactly as written.

export const PDF_PAGES_PER_PART = 4;
export const DOCX_PARAGRAPHS_PER_PART = 800;
const PDF_MAX_TOKENS = 16000;
const DOCX_MAX_TOKENS = 8000;

export type SgFile = { kind: "pdf"; pages: number; pdf: PDFDocument } | { kind: "docx"; paragraphs: DocxParagraph[] };

export class SgFileUnreadable extends Error {
  readonly plain: string;
  constructor(plain: string) {
    super(plain);
    this.plain = plain;
  }
}

export function sgFileKind(fileName: string): "pdf" | "docx" | null {
  const ext = fileName.toLowerCase().split(".").pop();
  return ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : null;
}

/** Opens the file to count its parts. Throws SgFileUnreadable with plain words when it can't be opened. */
export async function openSgFile(bytes: Uint8Array, fileName: string): Promise<SgFile> {
  const kind = sgFileKind(fileName);
  if (kind === "pdf") {
    try {
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      const pages = pdf.getPageCount();
      if (pages > 0) return { kind, pages, pdf };
    } catch {
      // locked or damaged
    }
    throw new SgFileUnreadable("This PDF is locked or damaged, so it couldn't be read. Upload an unlocked copy, or the Word version.");
  }
  if (kind === "docx") {
    let paragraphs: DocxParagraph[];
    try {
      paragraphs = docxParagraphs(bytes);
    } catch {
      throw new SgFileUnreadable("This Word file couldn't be opened. Check it opens in Word, then upload it again, or upload a PDF.");
    }
    if (paragraphs.length === 0) throw new SgFileUnreadable("This Word file has no text in it to read.");
    return { kind, paragraphs };
  }
  throw new SgFileUnreadable("Upload a Word (.docx) or PDF file.");
}

export function partCount(file: SgFile): number {
  return file.kind === "pdf"
    ? Math.ceil(file.pages / PDF_PAGES_PER_PART)
    : Math.max(1, Math.ceil(file.paragraphs.length / DOCX_PARAGRAPHS_PER_PART));
}

const SYSTEM =
  "You read a NSW real estate agency's own supervision guidelines and operational procedures manual, so it can be shown to the office section by section. " +
  "A top-level section is a main heading of the document, such as '1. Introduction' or '4. Trust money', or an unnumbered main heading such as 'Complaints'. " +
  "Clauses and sub-headings inside a section, such as '4.1' or '4.2 Receipts', are not top-level sections. " +
  "Never add, summarise or correct anything: the office's own words are kept exactly.";

const PDF_TOOL: Anthropic.Messages.Tool = {
  name: "pages_read",
  description: "Every paragraph of these pages, word for word, in reading order.",
  input_schema: {
    type: "object",
    properties: {
      paragraphs: {
        type: "array",
        description:
          "Every paragraph of body text on these pages, word for word, in reading order. Leave out running headers and footers, page numbers, and the table of contents. Keep clause numbers such as '4.2' at the start of their paragraph. A list item or a table row is a paragraph of its own.",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "The paragraph, word for word." },
            section: {
              type: "object",
              description:
                "Only when this paragraph is the heading that starts a top-level section. Leave out for every other paragraph.",
              properties: {
                number: { type: "string", description: "The section's number as printed, such as '4'. Leave out when it has none." },
                title: { type: "string", description: "The heading's words without the number, such as 'Trust money'." },
              },
              required: ["title"],
            },
          },
          required: ["text"],
        },
      },
      continues: {
        type: "boolean",
        description: "True when the first paragraph on these pages carries on a sentence from the page before.",
      },
      version: {
        type: "string",
        description:
          "The document's version number or label as printed (for example 'v7.3', 'Version 2', '2026.1'), when these pages show it. Leave out when they don't.",
      },
    },
    required: ["paragraphs"],
  },
};

const DOCX_TOOL: Anthropic.Messages.Tool = {
  name: "sections_marked",
  description: "Which paragraphs start a top-level section, and the document's version.",
  input_schema: {
    type: "object",
    properties: {
      sections: {
        type: "array",
        description: "Each top-level section that starts in these paragraphs, in order.",
        items: {
          type: "object",
          properties: {
            start: { type: "integer", description: "The paragraph number (in square brackets) of the section's heading." },
            number: {
              type: "string",
              description:
                "The section's number: as written in the heading, or, when the heading is an item in Word's numbered list (marked 'numbered'), the number Word shows for it. Leave out when it has none.",
            },
            title: { type: "string", description: "The heading's words without the number." },
          },
          required: ["start", "title"],
        },
      },
      version: {
        type: "string",
        description:
          "The document's version number or label as written (for example 'v7.3', 'Version 2', '2026.1'), when these paragraphs show it. Leave out when they don't.",
      },
    },
    required: ["sections"],
  },
};

type Asker = (parts: Parameters<typeof askParts>[1], question: Parameters<typeof askParts>[2]) => Promise<Array<Record<string, unknown>>>;

/** The default: one part to the reader, through the one way every document is read. */
export function readerAsker(anthropic: Anthropic): Asker {
  return (parts, question) => askParts(anthropic, parts, question);
}

async function pdfPartBytes(pdf: PDFDocument, from: number, to: number): Promise<Uint8Array> {
  const part = await PDFDocument.create({ updateMetadata: false });
  const indices = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  for (const page of await part.copyPages(pdf, indices)) part.addPage(page);
  return part.save();
}

/** Reads one part (0-based) of the file. Throws what the reader throws. */
export async function readSgPart(file: SgFile, index: number, fileName: string, ask: Asker): Promise<ReadPartResult> {
  const total = partCount(file);
  if (file.kind === "pdf") {
    const from = index * PDF_PAGES_PER_PART;
    const to = Math.min(file.pages, from + PDF_PAGES_PER_PART) - 1;
    const bytes = await pdfPartBytes(file.pdf, from, to);
    const note = `These are pages ${from + 1} to ${to + 1} of ${file.pages}${total > 1 ? ", one part of the whole document" : ""}.`;
    const [answer] = await ask([{ block: buildDocumentBlock("application/pdf", bytes, fileName)!, note }], {
      system: SYSTEM,
      text: "Write out every paragraph of these pages word for word, and mark each paragraph that is the heading of a top-level section.",
      tool: PDF_TOOL,
      maxTokens: PDF_MAX_TOKENS,
    });
    const read = readPartOf(answer);
    if (!read) throw new SgFileUnreadable("Part of it couldn't be read. Try again.");
    return read;
  }

  const first = index * DOCX_PARAGRAPHS_PER_PART;
  const chunk = file.paragraphs.slice(first, first + DOCX_PARAGRAPHS_PER_PART);
  const lines = chunk.map((p, i) => {
    const marks = [p.heading ? "heading style" : null, p.numbered ? "numbered" : null].filter(Boolean).join(", ");
    return `[${first + i}]${marks ? ` (${marks})` : ""} ${p.text}`;
  });
  const note = total > 1 ? `These are paragraphs ${first} to ${first + chunk.length - 1} of a document with ${file.paragraphs.length}.` : null;
  const [answer] = await ask(
    [{ block: { type: "text", text: `Document "${fileName}", one paragraph a line:\n\n${lines.join("\n")}` }, note }],
    {
      system: SYSTEM,
      text: "Say which of these paragraphs is the heading of each top-level section, and give the document's version if it's shown.",
      tool: DOCX_TOOL,
      maxTokens: DOCX_MAX_TOKENS,
    },
  );
  const marks = new Map<number, { number: string | null; title: string }>();
  for (const s of (answer.sections as unknown[]) ?? []) {
    const m = s as { start?: unknown; number?: unknown; title?: unknown };
    const start = typeof m.start === "number" ? Math.trunc(m.start) : NaN;
    if (!Number.isFinite(start) || start < first || start >= first + chunk.length) continue;
    const title = typeof m.title === "string" ? m.title.replace(/\s+/g, " ").trim() : "";
    marks.set(start, { number: typeof m.number === "string" && m.number.trim() ? m.number.trim() : null, title: title || chunk[start - first].text });
  }
  const paragraphs: ReadParagraph[] = chunk.map((p, i) => ({ text: p.text, section: marks.get(first + i) ?? null }));
  return {
    paragraphs,
    continues: false,
    version: typeof answer.version === "string" && answer.version.trim() ? answer.version.trim().slice(0, 40) : null,
  };
}
