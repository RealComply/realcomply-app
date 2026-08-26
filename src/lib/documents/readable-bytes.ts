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
// Conversion happens here, on the server, at read time — not in the browser.
// Uploads go straight from the browser to Storage (Vercel caps request bodies
// at 4.5MB, so a real contract can never travel through a Server Action), and
// putting a HEIC decoder into the client bundle to solve a server-side problem
// is the wrong trade.
//
// NOTE ON WHAT THIS DOES NOT FIX: the object in Storage is still HEIC, so a
// browser preview of that file, and any later audit pack that embeds it, still
// cannot display it. Reading is fixed; showing is not. See
// RealComply-current-state.md.

import { Buffer } from "node:buffer";

export type ReadableBytes = {
  base64: string;
  /** The type as the reader should treat it — JPEG once a HEIC has been converted. */
  contentType: string;
  /** True when this arrived as HEIC and was converted, so callers can say so. */
  convertedFromHeic: boolean;
};

const HEIC_CONTENT_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

const HEIC_EXTENSIONS = [".heic", ".heif"];

/**
 * Three ways of spotting a HEIC, because any one of them can be absent.
 *
 * The declared content type is what the browser put on the upload, and it is
 * usually right — but an upload from a file picker on an older browser, or a
 * file that has been renamed, can arrive as application/octet-stream. The
 * extension is what the agent sees and is often all that is left. The magic
 * bytes are the only one of the three that cannot lie.
 *
 * ISO base media format: bytes 4–8 are "ftyp", and the brand that follows says
 * which flavour. heic/heix/hevc/hevx/mif1/msf1 all decode through the same
 * library, and mif1 in particular is what a lot of iPhone photos actually carry
 * rather than the "heic" brand people expect.
 */
export function looksLikeHeic(params: {
  contentType?: string | null;
  fileName?: string | null;
  bytes?: Uint8Array;
}): boolean {
  const declared = (params.contentType ?? "").toLowerCase().split(";")[0].trim();
  if (HEIC_CONTENT_TYPES.has(declared)) return true;

  const name = (params.fileName ?? "").toLowerCase();
  if (HEIC_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;

  const bytes = params.bytes;
  if (bytes && bytes.length >= 12) {
    const ftyp = Buffer.from(bytes.subarray(4, 8)).toString("ascii");
    if (ftyp === "ftyp") {
      const brand = Buffer.from(bytes.subarray(8, 12)).toString("ascii").toLowerCase();
      if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return true;
    }
  }

  return false;
}

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
