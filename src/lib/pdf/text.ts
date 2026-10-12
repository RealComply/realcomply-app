import type { PDFFont } from "pdf-lib";

// Typed text on a PDF page: names, addresses, notes, file names.
//
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
//
// ONE HELPER FOR EVERY PDF (code review fixes, part C, 12 Oct 2026). The
// signed copy had this since 10 Oct; the compliance record and the deletion
// certificate still flattened typed text to plain ASCII, so the same agency
// was spelt one way on the signed copy and another on its own record. All
// three now draw typed text through here.

function drawable(ch: string, font: PDFFont): boolean {
  try {
    font.encodeText(ch);
    return true;
  } catch {
    return false;
  }
}

/** The text as near as this font can draw it. Never throws. */
export function pdfText(text: string, font: PDFFont): string {
  const cleaned = text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    // A line break in a note is a gap between words, not nothing.
    .replace(/[\t\n\r]+/g, " ")
    .replace(/[\x00-\x1F\x7F]/g, "");
  let out = "";
  for (const ch of cleaned) {
    if (drawable(ch, font)) {
      out += ch;
      continue;
    }
    for (const bare of ch.normalize("NFD").replace(/[̀-ͯ]/g, "")) {
      if (drawable(bare, font)) out += bare;
    }
  }
  return out;
}
