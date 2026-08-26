// Converting an iPhone photo before it is uploaded, in the browser.
//
// WHY HERE AND NOT ON THE SERVER, 26 August 2026.
//
// lib/documents/readable-bytes.ts already converts HEIC on the server so the
// AI can read it, and that fixed the failure on 16 Greenmount Way. It does not
// fix everything, because the object sitting in Storage is still HEIC:
//
//   * a browser preview of the evidence shows nothing — Chrome, Firefox and
//     Edge do not render HEIC at all,
//   * a settlement audit pack cannot embed it,
//   * and an agent who downloads their own evidence on a Windows machine gets
//     a file that will not open.
//
// Converting at upload fixes all three, and there is nowhere else it can
// happen: uploads go straight from the browser to Supabase Storage, because
// Vercel caps every request body at 4.5MB and a real contract for sale is
// routinely larger than that. Nothing server-side ever sees these bytes on the
// way in.
//
// NATIVE FIRST, LIBRARY SECOND. Most HEIC files reaching this product come off
// an iPhone, and a good share of those are uploaded from that same iPhone or a
// Mac — where Safari decodes HEIC natively, so a canvas round-trip costs
// nothing and downloads nothing. The 2.7MB decoder is imported only when the
// native path fails, which is the Windows-and-Chrome case. Most agents will
// never fetch it.
//
// FAILURE IS NOT FATAL, deliberately. If both paths fail, the original file is
// uploaded unchanged and the server-side conversion still lets the document be
// read. A conversion problem must never cost someone their evidence.

// From heic-detect, deliberately, and not from readable-bytes: that module
// imports node:buffer and a wasm decoder, and pulling either into the client
// bundle to ask one boolean question would defeat the point of the dynamic
// import below.
import { looksLikeHeic } from "@/lib/documents/heic-detect";

// 0.92 for the same reason as the server side: the figures on a photographed
// notice become the price every underquoting check measures against, so
// compression artefacts on a digit are not a cosmetic problem.
const JPEG_QUALITY = 0.92;

function jpegName(name: string): string {
  return name.replace(/\.(heic|heif)$/i, "") + ".jpg";
}

/** Safari and any other browser that decodes HEIC itself. Costs no download. */
async function nativeDecode(file: File): Promise<Blob | null> {
  if (typeof window === "undefined" || typeof createImageBitmap !== "function") return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // The expected outcome on a browser without HEIC support. Not an error
    // worth logging — it is simply the question being answered "no".
    return null;
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", JPEG_QUALITY);
    });
  } finally {
    bitmap.close();
  }
}

/** The fallback, downloaded only when the browser cannot decode HEIC itself. */
async function libraryDecode(file: File): Promise<Blob | null> {
  try {
    const heic2any = (await import("heic2any")).default;
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: JPEG_QUALITY });
    // Returns a Blob for a single image and an array for a burst or a
    // multi-image container. The first frame is the photograph of the
    // document; there is nothing sensible to do with the rest.
    return Array.isArray(out) ? out[0] ?? null : out;
  } catch (err) {
    console.error("HEIC conversion in the browser failed:", file.name, err);
    return null;
  }
}

/**
 * Returns the file that should actually be uploaded.
 *
 * Anything that is not HEIC is returned exactly as it came in — this must not
 * become a place where a contract for sale is quietly re-encoded on its way to
 * Storage. Only the one format nothing downstream can open is touched.
 */
export async function fileForUpload(file: File): Promise<File> {
  if (!looksLikeHeic({ contentType: file.type, fileName: file.name })) {
    return file;
  }

  const converted = (await nativeDecode(file)) ?? (await libraryDecode(file));
  if (!converted) return file;

  return new File([converted], jpegName(file.name), {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });
}
