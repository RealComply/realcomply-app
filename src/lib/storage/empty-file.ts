// EMPTY FILES ARE REFUSED, on every upload (Adam, 19 Oct 2026).
//
// Found on a live listing: an agency agreement and a market appraisal were
// saved as 0-byte files, the cards took them as done, and the comparables were
// never read because there was nothing to read. Most likely a file that lived
// in a cloud drive or an email and had not downloaded yet. The wording is
// Adam's.
//
// Checked three times, because each catches what the one before cannot:
//   * on screen, the moment the file is chosen (the size, and fileReadsEmpty
//     for a file whose size says one thing and whose bytes say another, which
//     is what a cloud placeholder can do);
//   * before the upload, in uploadEvidenceObject, so nothing empty is sent;
//   * on the server, by the size Storage actually holds (storedFileProblem in
//     lib/storage/evidence.ts), whatever the browser claimed, so an old open
//     tab or a hand-made request cannot attach one either.
//
// Pure: no database, no browser-only imports, so the plain rules files can
// use the message too.

export const EMPTY_FILE_MESSAGE =
  "This file came through empty. You may be trying to upload a file stored in a cloud-based location. Download it to your computer, check it opens, then upload it again.";

/**
 * True when the file has nothing in it that can be read: no size, no first
 * byte, or a read that fails. A file still in a cloud drive can report a size
 * and then hand over nothing, so the bytes are asked as well as the size.
 * Only the first byte is read, so a 150 MB contract costs nothing extra.
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
