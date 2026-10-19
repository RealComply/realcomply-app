// What an upload has to be before it is kept: something in it, and whole.
//
// EMPTY FILES (Adam, 19 Oct 2026). Found on a live listing: an agency
// agreement and a market appraisal were saved as 0-byte files, the cards took
// them as done, and the comparables were never read because there was nothing
// to read. Most likely a file that lived in a cloud drive or an email and had
// not downloaded yet. The wording is Adam's.
//
// DAMAGED FILES (Adam, 19 Oct 2026: "let's not leave these potential gaps").
// The same cause, half finished: a file that only partly downloaded has
// something in it but cannot be opened. So is a page saved under the wrong
// name, like a portal's sign-in page saved as "Market Appraisal.pdf". Each
// kind of file is checked for the parts a reader needs to open it:
//   * PDF: "%PDF-" at the start and "%%EOF" at the end. A PDF cut short loses
//     its ending first, and a PDF reader will still half-open one that has
//     lost it, which is why the ending is checked rather than trusting a read;
//   * PNG: its signature, and its end marker (IEND);
//   * HEIC: every part it lists is there in full (cut short, the last runs
//     past the end of the file);
//   * Word, Excel and Outlook files: the new formats are zip files, which
//     keep their table of contents at the very end; the old formats keep a
//     map of where everything is, which has to point inside the file;
//   * JPEG: walked from the start to the picture's own end marker. Some
//     phones add video after the picture, so the last bytes of the file say
//     nothing reliable; a JPEG cut short would open with the bottom missing,
//     which on a photo of a contract is the signature page.
// An .eml (a saved email) is plain text, so there is nothing to check but
// that it is not empty.
//
// LENIENT WHERE THE PROGRAMS ARE. Word opens an old .doc saved as .docx and
// a photo viewer opens a PNG saved as .jpg, so those are accepted: a file is
// refused only when nothing that would open it could.
//
// Checked three times, because each catches what the one before cannot:
//   * on screen, the moment the file is chosen (chosenFileProblem);
//   * before the upload, in uploadEvidenceObject, so nothing broken is sent;
//   * on the server, against what Storage actually holds (storedFileProblem
//     in lib/storage/evidence.ts), whatever the browser claimed, so an old
//     open tab or a hand-made request cannot attach one either.
// Only a few small pieces of each file are read, its start and its end, so
// a 150 MB contract costs no more to check than a photo.
//
// Pure: no database, no browser-only imports, so the server, the browser and
// the plain rules files all use it.

export const EMPTY_FILE_MESSAGE =
  "This file came through empty. You may be trying to upload a file stored in a cloud-based location. Download it to your computer, check it opens, then upload it again.";

export const DAMAGED_FILE_MESSAGE =
  "This file didn't come through whole, so it can't be opened. You may be trying to upload a file stored in a cloud-based location. Download it to your computer, check it opens, then upload it again.";

/** Reads up to `length` bytes from `offset`; fewer at the end of the file. */
export type ReadAt = (offset: number, length: number) => Promise<Uint8Array>;

type Kind = "pdf" | "image" | "office" | "email" | null;

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "heic", "heif"]);
const OFFICE_EXT = new Set(["doc", "docx", "xls", "xlsx", "msg"]);
const OFFICE_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-outlook",
]);

/** What a file is meant to be, by its name first and then its type. */
export function fileKind(name: string, type: string): Kind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXT.has(ext)) return "image";
  if (OFFICE_EXT.has(ext)) return "office";
  if (ext === "eml") return "email";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/")) return "image";
  if (OFFICE_TYPES.has(type)) return "office";
  if (type === "message/rfc822") return "email";
  return null;
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

function indexOf(hay: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

const has = (hay: Uint8Array, needle: number[]) => indexOf(hay, needle) >= 0;
const startsWith = (hay: Uint8Array, needle: number[], at = 0) =>
  hay.length >= at + needle.length && needle.every((b, i) => hay[at + i] === b);

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

const PDF_START = ascii("%PDF-");
const PDF_END = ascii("%%EOF");
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// The end chunk, with the checksum it always has (an empty chunk named IEND).
const PNG_END = [...ascii("IEND"), 0xae, 0x42, 0x60, 0x82];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const FTYP = ascii("ftyp");
const ZIP_START = [0x50, 0x4b, 0x03, 0x04];
const ZIP_END = [0x50, 0x4b, 0x05, 0x06];
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
// Other pictures a viewer opens whatever they are named.
const OTHER_IMAGES = [ascii("GIF8"), ascii("BM"), [0x49, 0x49, 0x2a, 0x00], [0x4d, 0x4d, 0x00, 0x2a]];

// How far from the end to look. A zip's table of contents can sit up to
// 64 KB from the end (it may carry a comment); the PDF and PNG endings are in
// the last few bytes, give or take what some programs add after them.
const PDF_TAIL = 32 * 1024;
const PNG_TAIL = 32 * 1024;
const ZIP_TAIL = 64 * 1024 + 22;

const tail = (size: number, readAt: ReadAt, length: number) =>
  readAt(Math.max(0, size - length), Math.min(size, length));

// A photo larger than this is not walked for its end (see jpegCutShort).
const JPEG_WALK_LIMIT = 50 * 1024 * 1024;

/**
 * A JPEG is a run of labelled parts, then the picture itself, then an end
 * marker. Walked from the start, part by part, the way a viewer reads it, so
 * the end marker found is the picture's own: a thumbnail inside the photo
 * has one too, and some phones add video after the picture, so neither the
 * first marker seen nor the last bytes of the file can be trusted. Cut
 * short, the walk runs off the end before the picture's end marker.
 *
 * Refuses only when the file plainly stops early. Anything laid out in a
 * way this does not follow is left to the viewer: accepted. Photos over
 * 50 MB are not walked (no phone takes one).
 */
async function jpegCutShort(size: number, readAt: ReadAt): Promise<boolean> {
  if (size > JPEG_WALK_LIMIT) return false;
  const b = await readAt(0, size);
  if (b.length < size) return true;
  let pos = 2; // after the start marker
  for (let parts = 0; parts < 100_000; parts++) {
    if (pos >= size) return true;
    if (b[pos] !== 0xff) return false; // not a layout this follows
    while (pos + 1 < size && b[pos + 1] === 0xff) pos++; // fill bytes
    if (pos + 1 >= size) return true;
    const marker = b[pos + 1];
    pos += 2;
    if (marker === 0xd9) return false; // the end marker: whole
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue; // markers with no length
    if (pos + 2 > size) return true;
    const length = (b[pos] << 8) | b[pos + 1];
    if (length < 2) return false;
    if (pos + length > size) return true;
    pos += length;
    if (marker !== 0xda) continue;
    // The picture itself: runs until the next marker that is not part of it
    // (FF 00 is a data byte, FF D0 to D7 are restart markers within it).
    for (;;) {
      const next = b.indexOf(0xff, pos);
      if (next < 0 || next + 1 >= size) return true;
      const after = b[next + 1];
      if (after === 0x00 || (after >= 0xd0 && after <= 0xd7) || after === 0xff) {
        pos = next + 1;
        continue;
      }
      pos = next;
      break;
    }
  }
  return false;
}

/** A HEIC is a run of boxes, each saying how long it is; cut short, the last runs past the end. */
async function heifCutShort(size: number, readAt: ReadAt): Promise<boolean> {
  let offset = 0;
  for (let i = 0; i < 64; i++) {
    if (size - offset < 8) return offset > size;
    const h = await readAt(offset, 16);
    if (h.length < 8) return true;
    let boxSize = view(h).getUint32(0);
    if (boxSize === 0) return false; // runs to the end of the file
    if (boxSize === 1) {
      if (h.length < 16) return true;
      boxSize = Number(view(h).getBigUint64(8));
    }
    if (boxSize < 8) return true;
    offset += boxSize;
  }
  return false;
}

/**
 * An old Word, Excel or Outlook file is laid out in fixed-size blocks, with a
 * map saying which blocks are in use. Every block the map says is in use has
 * to be in the file; cut short, the last ones are missing. The map itself is
 * read from the file (its first 109 parts, which cover files of any size an
 * agent sends: about 7 MB of blocks per part of the map at the smallest
 * block size, and all of it is checked that far).
 */
async function oleCutShort(head: Uint8Array, size: number, readAt: ReadAt): Promise<boolean> {
  if (head.length < 512) return true;
  const d = view(head);
  const shift = d.getUint16(30, true);
  if (shift !== 9 && shift !== 12) return true;
  const block = 2 ** shift;
  const blockStart = (n: number) => (n + 1) * block; // the header comes first
  // 0xFFFFFFFA and above are markers (free, end of chain), not blocks.
  const isBlock = (n: number) => n < 0xfffffffa;
  const FREE = 0xffffffff;

  if (isBlock(d.getUint32(48, true)) && blockStart(d.getUint32(48, true)) >= size) return true;

  const mapBlocks = Math.min(d.getUint32(44, true), 109);
  const perBlock = block / 4;
  let lastInUse = -1;
  for (let i = 0; i < mapBlocks; i++) {
    const at = d.getUint32(76 + i * 4, true);
    if (!isBlock(at)) continue;
    if (blockStart(at) + block > size) return true;
    const entries = await readAt(blockStart(at), block);
    if (entries.length < block) return true;
    const e = view(entries);
    for (let j = perBlock - 1; j >= 0; j--) {
      if (e.getUint32(j * 4, true) !== FREE) {
        lastInUse = Math.max(lastInUse, i * perBlock + j);
        break;
      }
    }
  }
  // The last block in use has to be there in full.
  return lastInUse >= 0 && blockStart(lastInUse) + block > size;
}

/**
 * A new-format Word or Excel file is a zip, which ends with its table of
 * contents: a fixed record, then an optional comment, then nothing. Looked
 * for exactly there, because a picture or another document inside the file
 * carries a record like it further up.
 */
async function zipCutShort(size: number, readAt: ReadAt): Promise<boolean> {
  const from = Math.max(0, size - ZIP_TAIL);
  const t = await readAt(from, size - from);
  for (let i = t.length - 22; i >= 0; i--) {
    if (!startsWith(t, ZIP_END, i)) continue;
    const comment = t[i + 20] | (t[i + 21] << 8);
    if (from + i + 22 + comment === size) return false;
  }
  return true;
}

/** No zero bytes at the start: text, as some programs save a ".doc" or ".xls". */
function looksLikeText(head: Uint8Array): boolean {
  return !head.includes(0);
}

/**
 * True when the file cannot be opened as what it is meant to be. Asks only
 * for its start and its end. A file of no kind we know is not judged here;
 * the type check refuses those.
 */
export async function fileCutShort(
  file: { name: string; type: string; size: number },
  readAt: ReadAt,
): Promise<boolean> {
  const kind = fileKind(file.name, file.type);
  if (kind === null || kind === "email" || file.size === 0) return false;
  const head = await readAt(0, Math.min(file.size, 1024));
  if (head.length === 0) return true;

  if (kind === "pdf") {
    if (!has(head, PDF_START)) return true;
    return !has(await tail(file.size, readAt, PDF_TAIL), PDF_END);
  }

  if (kind === "image") {
    if (startsWith(head, JPEG_SIGNATURE)) return jpegCutShort(file.size, readAt);
    if (startsWith(head, PNG_SIGNATURE)) return !has(await tail(file.size, readAt, PNG_TAIL), PNG_END);
    if (startsWith(head, FTYP, 4)) return heifCutShort(file.size, readAt);
    if (startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8)) return false;
    return !OTHER_IMAGES.some((sig) => startsWith(head, sig));
  }

  // Word, Excel or Outlook, new format or old, whichever it turns out to be.
  if (startsWith(head, OLE_SIGNATURE)) return oleCutShort(head, file.size, readAt);
  if (startsWith(head, ZIP_START)) return zipCutShort(file.size, readAt);
  // Programs Word and Excel open whatever the name says: a page or a table
  // saved as text (RTF, HTML, XML, CSV, as CRM exports often are), and Excel
  // files from before 1997. Nothing here says where they should end.
  if (looksLikeText(head) || startsWith(head, [0x09, 0x00]) || startsWith(head, [0x09, 0x02]) || startsWith(head, [0x09, 0x04])) {
    return false;
  }
  return true;
}

/** Reads a Blob a piece at a time: what the browser has of the chosen file. */
export function blobReader(file: Blob): ReadAt {
  return async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
}

/**
 * True when the file has nothing in it that can be read: no size, no first
 * byte, or a read that fails. A file still in a cloud drive can report a size
 * and then hand over nothing, so the bytes are asked as well as the size.
 */
export async function fileReadsEmpty(file: Blob): Promise<boolean> {
  if (file.size === 0) return true;
  try {
    const head = await file.slice(0, 1).arrayBuffer();
    return head.byteLength === 0;
  } catch {
    return true;
  }
}

/**
 * Adam's message for a chosen file that is empty or will not open, else
 * null. A file the browser cannot read at all is treated as empty: that is
 * what a cloud file that has not downloaded looks like from here.
 */
export async function chosenFileProblem(file: Blob & { name: string; type: string }): Promise<string | null> {
  if (await fileReadsEmpty(file)) return EMPTY_FILE_MESSAGE;
  try {
    return (await fileCutShort(file, blobReader(file))) ? DAMAGED_FILE_MESSAGE : null;
  } catch {
    return DAMAGED_FILE_MESSAGE;
  }
}

/**
 * The same for a file already downloaded (a document read on the server):
 * Adam's message if it is empty or will not open, else null. Used where a
 * read would otherwise fail without saying why.
 */
export async function downloadedFileProblem(blob: Blob, name: string): Promise<string | null> {
  if (blob.size === 0) return EMPTY_FILE_MESSAGE;
  try {
    return (await fileCutShort({ name, type: blob.type, size: blob.size }, blobReader(blob))) ? DAMAGED_FILE_MESSAGE : null;
  } catch {
    return null;
  }
}
