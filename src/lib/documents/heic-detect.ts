// Is this an iPhone photo? Asked on both sides of the wire.
//
// Kept in its own module with no Node imports on purpose. The server-side
// converter (readable-bytes.ts) pulls in node:buffer and a wasm decoder, and
// the browser-side converter (heic-in-the-browser.ts) must not drag either of
// those into the client bundle just to ask this one question.

const HEIC_CONTENT_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

const HEIC_EXTENSIONS = [".heic", ".heif"];

// ISO base media format brands that decode as HEIC. mif1 matters as much as
// heic: plenty of iPhone photos carry it rather than the brand people expect.
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]);

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/**
 * Three ways of spotting a HEIC, because any one of them can be absent.
 *
 * The declared content type is what the browser put on the file, and it is
 * usually right — but an older browser, or a file that has been renamed, can
 * produce application/octet-stream. The extension is what the agent sees and is
 * often all that is left. The magic bytes are the only one of the three that
 * cannot lie, and they are the only one available when neither of the others
 * survived a round trip through storage.
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
  if (bytes && bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    if (HEIC_BRANDS.has(ascii(bytes, 8, 12).toLowerCase())) return true;
  }

  return false;
}
