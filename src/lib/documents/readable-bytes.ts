// Turning whatever an agent uploaded into something the reader can open.
//
// WHY THIS EXISTS, 26 August 2026.
//
// On 16 Greenmount Way the ESP was revised, the notice was attached, and the
// item stayed open with a flag at settlement. Nothing was wrong with the
// reading of the notice — the extractor handles that document properly, with
// its own tool and its own prompt. The file was `IMG_9352.HEIC`: a photograph
// taken on an iPhone.
//
// HEIC is the iPhone's default capture format and has been for years. The
// reader accepted PDF, JPEG, PNG, GIF and WebP, so the document block came back
// empty, the read returned nothing, and the revised figures were never written.
// Every underquoting check then went on measuring against the superseded price.
//
// Agents photograph paperwork. They do it at the kitchen table, at an open
// home, in the car between appointments. A compliance product that cannot read
// a phone photo of a signed notice is a compliance product that will be worked
// around, and being worked around is worse than being slow.
//
// THIS IS THE SECOND OF TWO CONVERSIONS, and it is the belt rather than the
// braces. heic-in-the-browser.ts now converts on the way in, so anything
// uploaded from here on is already a JPEG in Storage — which is what makes a
// preview render and an audit pack able to embed it.
//
// This one stays, and is not redundant, for three reasons:
//
//   * every HEIC uploaded before 26 Aug 2026 is still HEIC in the bucket,
//     including the notice on 16 Greenmount Way,
//   * browser-side conversion is allowed to fail — a decoder that cannot run
//     uploads the original rather than costing someone their evidence, and
//     this is what catches that,
//   * and it is the only one of the two that cannot be skipped by anything
//     writing to Storage by another route.
//
// Reading must not depend on an upload path having done the right thing.

import { Buffer } from "node:buffer";
import { looksLikeHeic } from "@/lib/documents/heic-detect";

export type ReadableBytes = {
  base64: string;
  /** The type as the reader should treat it — JPEG once a HEIC has been converted. */
  contentType: string;
  /** True when this arrived as HEIC and was converted, so callers can say so. */
  convertedFromHeic: boolean;
};

/**
 * Reads a downloaded evidence object into something the model can be handed.
 *
 * Anything that is not HEIC passes through untouched — this must not become a
 * place where a contract for sale quietly gets re-encoded on its way to being
 * read. Only the one format the reader genuinely cannot open is converted.
 *
 * A conversion that fails returns the original bytes rather than throwing. The
 * caller already handles "this file type can't be read" and says so usefully;
 * an exception here would turn a readable failure into a 500.
 */
export async function readableBytes(
  blob: Blob,
  fileName: string,
): Promise<ReadableBytes> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const declared = blob.type || "application/octet-stream";

  if (!looksLikeHeic({ contentType: declared, fileName, bytes })) {
    return {
      base64: Buffer.from(arrayBuffer).toString("base64"),
      contentType: declared,
      convertedFromHeic: false,
    };
  }

  try {
    // Imported at call time, not at the top of the file. It pulls in a wasm
    // HEIF decoder, and the overwhelming majority of uploads are PDFs that
    // should never pay for loading it.
    const convert = (await import("heic-convert")).default;
    const jpeg = await convert({
      buffer: Buffer.from(bytes),
      format: "JPEG",
      // High enough that small print in a photographed notice survives. The
      // figures on this document become the price every underquoting check
      // measures against, so compression artefacts on a digit are not a
      // cosmetic problem.
      quality: 0.92,
    });

    return {
      base64: Buffer.from(jpeg).toString("base64"),
      contentType: "image/jpeg",
      convertedFromHeic: true,
    };
  } catch (err) {
    console.error("HEIC conversion failed:", fileName, err);
    return {
      base64: Buffer.from(arrayBuffer).toString("base64"),
      contentType: declared,
      convertedFromHeic: false,
    };
  }
}
