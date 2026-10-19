import { PDFDocument } from "pdf-lib";
import { fileCutShort } from "@/lib/storage/file-check";

// EVERY PDF REALCOMPLY MAKES IS CHECKED BEFORE IT LEAVES THE BUILDER (Adam,
// 19 Oct 2026: "let's not leave these potential gaps").
//
// The annexure, the agent acknowledgement, a signed copy and its signature
// certificate, the compliance file and the end-of-subscription certificate
// are stored, emailed or handed over as the record of something that
// happened. A builder that produced an empty or broken one would leave a
// record that says signed and a file that shows nothing, which is the gap
// empty uploads were closed for (lib/storage/file-check.ts).
//
// Checked inside each builder, at the one place every use passes through, so
// a new place that stores or sends one is covered without anybody having to
// remember. What is checked: something in it, the start and end a reader
// needs, and that it opens again with at least one page. This one is opened
// in full, unlike an upload: RealComply made it with this same library, so a
// refusal here can only mean the file really is broken.

/** Why a PDF RealComply made cannot be used, or null when it is sound. */
export async function generatedPdfProblem(bytes: Uint8Array | null | undefined): Promise<string | null> {
  if (!bytes || bytes.length === 0) return "it came out empty";
  const readAt = async (offset: number, length: number) => bytes.slice(offset, offset + length);
  if (await fileCutShort({ name: "made.pdf", type: "application/pdf", size: bytes.length }, readAt)) {
    return "it came out incomplete";
  }
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (doc.getPageCount() < 1) return "it has no pages";
  } catch (e) {
    return `it does not open (${e instanceof Error ? e.message.slice(0, 120) : "unknown"})`;
  }
  return null;
}

export class GeneratedPdfError extends Error {}

/**
 * The PDF a builder made, once checked. Throws instead of handing on one that
 * is empty or will not open; `what` names the document in the error, which
 * reaches the error alerts (never a person's or a client's name).
 */
export async function checkedPdf(bytes: Uint8Array, what: string): Promise<Uint8Array> {
  const problem = await generatedPdfProblem(bytes);
  if (problem) throw new GeneratedPdfError(`${what}: ${problem}`);
  return bytes;
}
