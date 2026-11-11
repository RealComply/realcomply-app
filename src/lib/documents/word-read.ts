import type Anthropic from "@anthropic-ai/sdk";
import { DocxUnreadable, documentXmlParagraphs, zipEntry, zipEntryNames } from "@/lib/sg-document/docx";

// Word files on listing cards (Adam, 11 Nov 2026; Master: "read them with the
// same Word reading as the supervision guidelines upload"). A .docx is read
// in the app, as the supervision guidelines are (lib/sg-document/docx.ts):
// its words, in order. Two things more, because the files that come in on
// listing cards are forms and letters, not manuals:
//
//   * A table keeps each row together, its cells joined by " | ". An
//     identity check form is a table of labels and answers; read as loose
//     paragraphs, "Name" and "Jo Bennett" would be lines apart.
//   * The pictures in it go to the reader too, as pictures (PNG, JPEG and
//     GIF, a few at most). A photo of a licence pasted into a Word form is
//     the same as a photo of a licence uploaded: the identity card's check
//     must see it.
//
// The file itself is kept exactly as uploaded; this only decides what the
// reader is shown. The old Word format (.doc) isn't a zip and isn't read.

export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** At most this many pictures from one Word file go to the reader. */
export const WORD_PICTURES_MAX = 6;

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/**
 * Whether a file is a Word document the app can read: by its name or type,
 * or, whatever it's called, a zip holding word/document.xml (Word opens an
 * old .doc saved as .docx, so a misnamed one is read too).
 */
export function isReadableWord(args: { contentType: string; fileName: string; bytes: Uint8Array }): boolean {
  const ext = args.fileName.toLowerCase().split(".").pop() ?? "";
  if (!isZip(args.bytes)) return false;
  if (ext === "docx" || args.contentType === DOCX_TYPE) return true;
  if (ext === "doc" || args.contentType === "application/msword" || args.contentType === "application/octet-stream") {
    try {
      return zipEntry(args.bytes, "word/document.xml") !== null;
    } catch {
      return false;
    }
  }
  return false;
}

/** The elements of one kind at the top level of some XML (a table inside a table stays inside its cell). */
export function topLevel(xml: string, tag: string): Array<{ start: number; end: number; inner: string }> {
  const open = new RegExp(`<${tag}(?=[\\s>])[^>]*>|</${tag}>`, "g");
  const out: Array<{ start: number; end: number; inner: string }> = [];
  let depth = 0;
  let start = -1;
  let innerStart = -1;
  for (const m of xml.matchAll(open)) {
    if (m[0].startsWith("</")) {
      if (depth === 0) continue;
      depth--;
      if (depth === 0) {
        const end = (m.index ?? 0) + m[0].length;
        out.push({ start, end, inner: xml.slice(innerStart, m.index) });
      }
    } else if (!m[0].endsWith("/>")) {
      if (depth === 0) {
        start = m.index ?? 0;
        innerStart = start + m[0].length;
      }
      depth++;
    }
  }
  return out;
}

const textOf = (xml: string) =>
  documentXmlParagraphs(xml)
    .map((p) => p.text)
    .join(" ")
    .trim();

/** A table as lines: each row's cells joined by " | ", empty cells left out. */
function tableLines(tableXml: string): string[] {
  return topLevel(tableXml, "w:tr")
    .map((row) =>
      topLevel(row.inner, "w:tc")
        .map((cell) => textOf(cell.inner))
        .filter(Boolean)
        .join(" | "),
    )
    .filter(Boolean);
}

/** The words of word/document.xml as lines: paragraphs in order, each table row on one line. */
export function documentXmlLines(xml: string): string[] {
  const lines: string[] = [];
  let at = 0;
  for (const t of topLevel(xml, "w:tbl")) {
    lines.push(...documentXmlParagraphs(xml.slice(at, t.start)).map((p) => p.text));
    lines.push(...tableLines(t.inner));
    at = t.end;
  }
  lines.push(...documentXmlParagraphs(xml.slice(at)).map((p) => p.text));
  return lines;
}

type Picture = { mediaType: "image/png" | "image/jpeg" | "image/gif"; bytes: Uint8Array };

export function pictureType(b: Uint8Array): Picture["mediaType"] | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  return null;
}

export type WordForReader = {
  /** The text block: the file's words, said to be from a Word file. */
  text: string;
  /** The file's own words only, for "too short to be a real document" checks. */
  words: string;
  /** Its pictures the reader can look at, in the file's order. */
  pictures: Picture[];
  /** Pictures left out: a kind the reader can't open (such as Word's own drawings), too large, or past the limit. */
  picturesLeftOut: number;
};

/**
 * What the reader is shown of a Word file. Throws DocxUnreadable when the
 * file can't be opened as Word.
 */
export function wordForReader(bytes: Uint8Array, fileName: string, limits: { pictureMaxBytes: number; totalMaxBytes: number }): WordForReader {
  const xml = zipEntry(bytes, "word/document.xml");
  if (!xml) throw new DocxUnreadable("no word/document.xml");
  const lines = documentXmlLines(Buffer.from(xml).toString("utf8"));

  const pictures: Picture[] = [];
  let leftOut = 0;
  let total = 0;
  for (const name of zipEntryNames(bytes).filter((n) => n.startsWith("word/media/"))) {
    let data: Uint8Array | null = null;
    try {
      data = zipEntry(bytes, name);
    } catch {
      data = null;
    }
    const type = data ? pictureType(data) : null;
    if (!data || !type || data.length > limits.pictureMaxBytes || pictures.length >= WORD_PICTURES_MAX || total + data.length > limits.totalMaxBytes) {
      leftOut++;
      continue;
    }
    total += data.length;
    pictures.push({ mediaType: type, bytes: data });
  }

  const about =
    pictures.length > 0
      ? ` It has ${pictures.length} ${pictures.length === 1 ? "picture" : "pictures"}, shown after the words.`
      : "";
  const missing =
    leftOut > 0 ? ` ${leftOut} more ${leftOut === 1 ? "picture" : "pictures"} in it couldn't be shown, so say nothing about ${leftOut === 1 ? "it" : "them"}.` : "";
  const words = lines.join("\n");
  return {
    text: `Document "${fileName}", a Word file, read as text (table rows are on one line, cells separated by " | ").${about}${missing}\n\n${words || "(No words in the file.)"}`,
    words,
    pictures,
    picturesLeftOut: leftOut,
  };
}

/** The pictures as blocks for the reader. */
export function pictureBlocks(pictures: WordForReader["pictures"]): Anthropic.Messages.ContentBlockParam[] {
  return pictures.map((p) => ({
    type: "image",
    source: { type: "base64", media_type: p.mediaType, data: Buffer.from(p.bytes).toString("base64") },
  }));
}
