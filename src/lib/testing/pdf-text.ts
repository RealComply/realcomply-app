import { inflateSync } from "node:zlib";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream, PDFRef, type PDFObject } from "pdf-lib";

// The text drawn in a pdf-lib document, for tests: inflate each content
// stream and decode its hex strings. Moved here from draft-disclaimer.test.ts
// on 12 Oct 2026 so the price approval test can read the audit pack too.
// Each drawn line comes back separated by a space, so a phrase wrapped across
// two lines still reads whole.
export function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    let body: string;
    try {
      body = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
    } catch {
      body = m[1];
    }
    for (const hex of body.match(/<([0-9A-Fa-f\s]+)>\s*Tj/g) ?? []) {
      out.push(Buffer.from(hex.replace(/[<>\sTj]/g, ""), "hex").toString("latin1"));
    }
    for (const lit of body.match(/\((?:\\.|[^\\)])*\)\s*Tj/g) ?? []) out.push(lit.slice(1, lit.lastIndexOf(")")));
  }
  return out.join(" ");
}

/** The strings drawn by one content stream's show-text operators. */
function shownText(body: string): string[] {
  const out: string[] = [];
  for (const hex of body.match(/<([0-9A-Fa-f\s]+)>\s*Tj/g) ?? []) {
    out.push(Buffer.from(hex.replace(/[<>\sTj]/g, ""), "hex").toString("latin1"));
  }
  for (const lit of body.match(/\((?:\\.|[^\\)])*\)\s*Tj/g) ?? []) out.push(lit.slice(1, lit.lastIndexOf(")")));
  return out;
}

/**
 * The text drawn on each page, one string per page, in order (12 Oct 2026,
 * for the footer on every page of the audit pack). Reads each page's own
 * content streams through pdf-lib, rather than scanning the whole file, so a
 * test can say which page something is on.
 */
export async function pdfPageTexts(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const refs: PDFObject[] = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    const parts: string[] = [];
    for (const ref of refs) {
      const stream = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
      if (!(stream instanceof PDFRawStream)) continue;
      parts.push(...shownText(Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1")));
    }
    return parts.join(" ");
  });
}
