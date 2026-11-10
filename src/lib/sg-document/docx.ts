import { inflateRawSync } from "node:zlib";

// The paragraphs of a Word document (.docx), read in the app itself: a .docx
// is a zip of XML files, and the text is in word/document.xml. Nothing else
// in RealComply reads Word files (the reader takes PDFs and photos), and the
// supervision guidelines are often kept in Word, so this reads just enough:
// each paragraph's text, whether it's styled as a heading, and whether it's
// an item in Word's own numbered list (whose numbers aren't in the text).
// The old Word format (.doc) isn't a zip and isn't read.

export type DocxParagraph = {
  text: string;
  /** Styled as a heading or title in Word. */
  heading: boolean;
  /** An item in one of Word's automatic numbered lists. */
  numbered: boolean;
};

export class DocxUnreadable extends Error {}

/** One file out of a zip, or null when it isn't there. Stored or deflated entries; no zip64. */
export function zipEntry(zip: Uint8Array, name: string): Uint8Array | null {
  const buf = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  // The end of central directory record: the last thing in the file, before
  // an optional comment of up to 65535 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new DocxUnreadable("not a zip");
  const entries = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  for (let e = 0; e < entries; e++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) throw new DocxUnreadable("damaged zip");
    const method = buf.readUInt16LE(at + 10);
    const compressed = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const entryName = buf.toString("utf8", at + 46, at + 46 + nameLength);
    if (entryName === name) {
      if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new DocxUnreadable("damaged zip");
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + compressed);
      if (method === 0) return new Uint8Array(data);
      if (method === 8) return new Uint8Array(inflateRawSync(data));
      throw new DocxUnreadable(`compression ${method}`);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(xml: string): string {
  return xml.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, code: string) => {
    if (code.startsWith("#x")) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return ENTITIES[code] ?? whole;
  });
}

/** The paragraphs of word/document.xml, in order. Empty paragraphs are left out. */
export function documentXmlParagraphs(xml: string): DocxParagraph[] {
  const out: DocxParagraph[] = [];
  const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];
  for (const p of paragraphs) {
    let text = "";
    // Text, tabs and line breaks, in the order they come.
    for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)(?:\s[^>]*)?\/>/g)) {
      text += m[1] !== undefined ? decode(m[1]) : " ";
    }
    text = text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const style = /<w:pStyle\s+w:val="([^"]*)"/.exec(p)?.[1]?.toLowerCase() ?? "";
    out.push({
      text,
      heading: /^(heading|title|berschrift|titre)/.test(style) || /<w:outlineLvl\s+w:val="[0-8]"/.test(p),
      numbered: /<w:numPr>/.test(p),
    });
  }
  return out;
}

/** A .docx file's paragraphs. Throws DocxUnreadable when it isn't a Word document that can be opened. */
export function docxParagraphs(bytes: Uint8Array): DocxParagraph[] {
  const xml = zipEntry(bytes, "word/document.xml");
  if (!xml) throw new DocxUnreadable("no word/document.xml");
  return documentXmlParagraphs(Buffer.from(xml).toString("utf8"));
}
