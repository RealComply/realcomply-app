import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";
import { MRS_SAINT_DELAFIELD_TTF_BASE64 } from "./fonts/mrs-saint-delafield";

// The handwriting face for a signature (Adam, 12 Oct 2026: "I'd like it to look
// more like a signature rather than just a typed out name"; he chose Mrs Saint
// Delafield from five). Used on the audit pack and on the trust reconciliation
// sign-off page, so a RealComply signature looks the same everywhere.
//
// It is still a typed name adopted as a signature, and both documents say so
// directly under it. The face makes it read as the signature it is, not as one
// more line of the form.

export async function embedSignatureFont(doc: PDFDocument): Promise<PDFFont> {
  doc.registerFontkit(fontkit);
  return doc.embedFont(Buffer.from(MRS_SAINT_DELAFIELD_TTF_BASE64, "base64"), { subset: true });
}

/**
 * Whether the handwriting face can draw every character of this name. It
 * covers the Latin alphabet with accents; a name in another script falls back
 * to the plain italic, so it is never drawn as empty boxes.
 */
export function signatureFontCanDraw(font: PDFFont, text: string): boolean {
  const supported = new Set(font.getCharacterSet());
  for (const ch of text) {
    if (ch === " ") continue;
    if (!supported.has(ch.codePointAt(0)!)) return false;
  }
  return text.trim().length > 0;
}
