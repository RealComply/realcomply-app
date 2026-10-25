// Large files and the AI reader (Adam, 25 Oct 2026).
//
// WHY. Uploads take files up to 150 MB, but the reader takes one PDF of about
// 24 MB in a request (the service's cap is 32 MB once the file is encoded for
// sending, which adds a third). Over that, the read failed and the screen
// showed the service's own error: "PDF exceeds 32 MB maximum: 78086240 bytes >
// 33554432 bytes". Uralla Properties saw it on 24 Oct 2026 with a 58 MB agency
// agreement, shrank her files to get under 32 MB, and lost scan quality doing
// it.
//
// WHAT THIS DOES. A PDF over 20 MB is split into parts of whole pages, each
// under 20 MB and at most 100 pages, and each part is read on its own. The
// answers are combined (mergeReads below). Nothing is lost by splitting:
//
//   * The pages are copied, not redrawn. pdf-lib moves each page's text,
//     drawings and images into the part byte for byte; no image is resampled
//     or re-compressed. A part's page 1 IS the original page 12.
//   * The reader draws every page itself, at up to 2,576 pixels on its long
//     side, whatever the file's own resolution. So a page reads the same
//     arriving in a part as it would in the whole file.
//   * Cost is per page, not per megabyte, so the parts cost what the whole
//     file would have, plus the instructions once per part (a few thousand
//     words of reading, a cent or two).
//
// What can still not be read: a single page over 20 MB on its own (a part
// can't be smaller than a page), a PDF too damaged or locked to split, and a
// photo over the reader's per-image cap. Each says so in plain words
// (TOO_LARGE_TO_READ). Never "make the file smaller": that is the advice that
// cost the scan quality in the first place.

import { PDFDocument } from "pdf-lib";
import Anthropic from "@anthropic-ai/sdk";

/** The most a part may weigh as a file. Encoded for sending it is a third bigger: 26.7 MB, under the 32 MB cap. */
export const READER_PART_MAX_BYTES = 20 * 1024 * 1024;

/** The most pages in one part, so one read stays well inside what the reader takes at once. */
export const READER_PART_MAX_PAGES = 100;

/** Parts read at the same time. Enough to keep a 150 MB file inside a couple of minutes, few enough not to swamp the service. */
export const READER_PARTS_AT_ONCE = 3;

/** The reader's cap on one photo (10 MB once encoded), as a file. */
export const READER_IMAGE_MAX_BYTES = Math.floor((10 * 1024 * 1024 * 3) / 4);

/** Said when a file can't be read automatically because of its size. Plain words, never the service's error. */
export const TOO_LARGE_TO_READ = "This file is too large to read automatically, so enter the details yourself.";

/** Said when the reader itself failed (busy, timed out). Nothing about the file. */
export const READ_FAILED_JUST_NOW = "It couldn't be read just now. Try again in a minute.";

export type ReaderPart = {
  bytes: Uint8Array;
  /** 1-based, of the whole document. */
  firstPage: number;
  lastPage: number;
  totalPages: number;
  /** 1-based position among the parts. */
  index: number;
  count: number;
};

export type ReaderSplit = { ok: true; parts: ReaderPart[] } | { ok: false };

/**
 * A PDF as the reader will take it: as it is when it's small enough, or in
 * parts of whole pages when it isn't. ok: false when it can't be made small
 * enough (a single page over the limit, or a PDF that won't open to split).
 */
export async function splitPdfForReader(
  bytes: Uint8Array,
  limits: { maxBytes?: number; maxPages?: number } = {},
): Promise<ReaderSplit> {
  const maxBytes = limits.maxBytes ?? READER_PART_MAX_BYTES;
  const maxPages = limits.maxPages ?? READER_PART_MAX_PAGES;

  // Small enough: sent exactly as uploaded, not opened, as before.
  if (bytes.length <= maxBytes) {
    return { ok: true, parts: [{ bytes, firstPage: 1, lastPage: 0, totalPages: 0, index: 1, count: 1 }] };
  }

  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    // Locked or too damaged to take apart. The reader couldn't have opened it
    // whole either.
    return { ok: false };
  }
  const totalPages = source.getPageCount();
  if (totalPages === 0) return { ok: false };

  const groups = Math.min(totalPages, Math.max(Math.ceil(bytes.length / maxBytes), Math.ceil(totalPages / maxPages)));
  const ranges: Array<[number, number]> = [];
  for (let g = 0; g < groups; g++) {
    const from = Math.floor((g * totalPages) / groups);
    const to = Math.floor(((g + 1) * totalPages) / groups) - 1;
    if (to >= from) ranges.push([from, to]);
  }

  const built: Array<{ bytes: Uint8Array; from: number; to: number }> = [];
  // Pages are rarely the same weight (a photo page against a page of text),
  // so a part that comes out too heavy is halved until it fits.
  const build = async (from: number, to: number): Promise<boolean> => {
    const part = await PDFDocument.create({ updateMetadata: false });
    const indices = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    for (const page of await part.copyPages(source, indices)) part.addPage(page);
    const out = await part.save();
    if (out.length <= maxBytes) {
      built.push({ bytes: out, from, to });
      return true;
    }
    if (from === to) return false; // one page, still too heavy
    const mid = Math.floor((from + to) / 2);
    return (await build(from, mid)) && (await build(mid + 1, to));
  };
  for (const [from, to] of ranges) {
    if (!(await build(from, to))) return { ok: false };
  }

  return {
    ok: true,
    parts: built.map((b, i) => ({
      bytes: b.bytes,
      firstPage: b.from + 1,
      lastPage: b.to + 1,
      totalPages,
      index: i + 1,
      count: built.length,
    })),
  };
}

/** Told to the reader with each part of a split file. Null for a file read whole. */
export function partNote(part: Pick<ReaderPart, "index" | "count" | "firstPage" | "lastPage" | "totalPages">): string | null {
  if (part.count <= 1) return null;
  return (
    `This is part ${part.index} of ${part.count} of one document: pages ${part.firstPage} to ${part.lastPage} of ` +
    `${part.totalPages}. The document was too large to read in one go, so its parts are read separately and the ` +
    "answers combined. This overrides anything above saying you have the complete document. Report only what these " +
    "pages state, and never describe anything as missing, lacking or not found: it may be on another part's pages."
  );
}

/** Runs fn over items, at most `limit` at a time, results in the items' order. */
export async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** What makes two list entries the same thing: a prescribed document's key, or a sale's address. */
function identityOf(v: unknown): string {
  if (isPlainObject(v)) {
    if (typeof v.key === "string") return `key:${v.key}`;
    if (typeof v.address === "string") {
      return `address:${v.address.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim()}`;
    }
  }
  return `json:${JSON.stringify(v)}`;
}

/**
 * The parts' answers as one answer, in page order.
 *
 *   * yes/no: yes if any part says yes. These are "true only if the document
 *     shows it" answers, and the page that shows it is in one part.
 *   * lists: every part's entries, the same entry (same key or address) once,
 *     merged. So a prescribed document counts as found if any part found it.
 *   * notes: each different note once, in page order.
 *   * anything else (a figure, a date, a name): the first part that states it.
 */
export function mergeReads<T extends Record<string, unknown>>(reads: T[]): T {
  const out: Record<string, unknown> = {};
  for (const read of reads) {
    for (const [key, value] of Object.entries(read)) {
      if (isBlank(value)) continue;
      const have = out[key];
      if (typeof value === "boolean") {
        out[key] = have === true || value;
      } else if (Array.isArray(value)) {
        const list = Array.isArray(have) ? [...have] : [];
        for (const entry of value) {
          const id = identityOf(entry);
          const at = list.findIndex((e) => identityOf(e) === id);
          if (at === -1) list.push(entry);
          else if (isPlainObject(list[at]) && isPlainObject(entry)) list[at] = mergeReads([list[at] as T, entry as T]);
        }
        out[key] = list;
      } else if (isPlainObject(value)) {
        out[key] = isPlainObject(have) ? mergeReads([have, value]) : value;
      } else if (key === "note" && typeof value === "string") {
        const notes = typeof have === "string" && have ? have.split("\n") : [];
        if (!notes.includes(value.trim())) notes.push(value.trim());
        out[key] = notes.join("\n");
      } else if (isBlank(have)) {
        out[key] = value;
      }
    }
  }
  return out as T;
}

/**
 * Whether a failed read failed because of the file's size or length: a
 * request, PDF or document over the service's limits. Those get the plain
 * too-large wording; anything else from the service is "couldn't be read just
 * now". Neither ever shows the service's own message.
 */
export function isTooLargeError(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 413) return true;
    if (err.status === 400) {
      return /exceeds|too large|too long|maximum|pages/i.test(err.message);
    }
  }
  return false;
}
