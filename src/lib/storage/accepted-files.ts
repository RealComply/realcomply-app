// What a reading upload takes, and what it says about a file it can't read
// (Adam, 2 to 3 Nov 2026; mockup approved).
//
// One line, the same words everywhere RealComply reads the file with AI, small
// and grey right under the upload: "Accepted files: Clear photo or PDF." Only
// where the file is read. A store-only upload (a trust reconciliation, the SG
// Manual, a complaint's files, a listing card nothing reads) says nothing.
//
// Uploads still take Word, Excel and saved emails (EVIDENCE_TYPES in
// lib/storage/evidence.ts), because a file refused is a file lost. The reader
// can't open them, so one that goes up at a reading upload is saved, and that
// spot says so in Adam's words, with a button to upload a PDF instead. Before,
// it said whatever the reader said, a raw type such as
// "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
// included.
//
// Decided by the stored file's name, so the spot says it again on reload
// wherever the attached file's name is known. The words and the rule live
// here, with no browser or database, so every one is tested
// (accepted-files.test.ts).

/** Under every upload RealComply reads (moved here from lib/esp-history.ts, 3 Nov 2026). */
export const ACCEPTED_FILES = "Accepted files: Clear photo or PDF.";

/**
 * Under every reading upload on a listing card (Adam, 11 Nov 2026): Word is
 * read there too (lib/documents/word-read.ts). The registers and CPD don't
 * read Word, and keep the line above.
 */
export const ACCEPTED_FILES_WITH_WORD = "Accepted files: PDF, clear photo or Word.";

// A Word file in the audit pack (Adam, 11 Nov 2026, "Go with A"): RealComply
// draws a plain copy of a .docx into the pack (lib/pdf/word-copy.ts), free and
// without it leaving RealComply. Its own layout is kept only by a PDF, so each
// card with one says so, with "Upload a PDF" to replace it. The old format
// (.doc) isn't drawn, so it isn't in the pack until it is a PDF.

/** On the card after a Word file (.docx) is read. */
export const READ_FROM_WORD =
  "Read from your Word file. The audit pack has a plain copy of it. To keep its own layout, upload it as a PDF.";

/** On a card nothing reads, after a Word file (.docx) is uploaded. */
export const KEPT_AS_WORD =
  "Kept as a Word file. The audit pack has a plain copy of it. To keep its own layout, upload it as a PDF.";

/** After an older Word file (.doc) is uploaded, where the card doesn't already say it can't read it. */
export const KEPT_AS_OLD_WORD = "Kept as an older Word file (.doc). To include it in the audit pack, upload it as a PDF.";

/**
 * What a listing card says about its Word file (.docx or .doc), or null for
 * any other file. `read`: the card reads its file (or checks it, as the
 * identity card does). The old format (.doc) is never read or drawn.
 *
 * Where a card already says it can't read the file (cantReadMessage, for a
 * .doc on a card that reads), that notice speaks for it and this isn't shown.
 */
export function wordFileNotice(fileName: string | null | undefined, where: { read: boolean }): string | null {
  if (!fileName) return null;
  const base = fileName.slice(fileName.lastIndexOf("/") + 1).trim();
  const dot = base.lastIndexOf(".");
  const ext = dot < 0 ? "" : base.slice(dot + 1).toLowerCase();
  if (ext === "docx") return where.read ? READ_FROM_WORD : KEPT_AS_WORD;
  if (ext === "doc") return KEPT_AS_OLD_WORD;
  return null;
}

/** The button on the notice: straight to choosing a replacement at the same spot. */
export const UPLOAD_A_PDF = "Upload a PDF";

/** The kinds of file an upload takes but the reader can't open, as the notice names them. */
export type UnreadableKind = "Word files" | "older Word files (.doc)" | "Excel files" | "saved emails";

const KIND_BY_EXTENSION: Record<string, UnreadableKind> = {
  doc: "Word files",
  docx: "Word files",
  xls: "Excel files",
  xlsx: "Excel files",
  eml: "saved emails",
  msg: "saved emails",
};

/**
 * The kind of a stored file the reader can't open, from its name's
 * extension (any case), or null for anything else: a PDF, a photo, a name
 * with no extension. A storage path works too: only the part after the last
 * "/" is looked at.
 */
export function unreadableKind(
  fileName: string | null | undefined,
  where: { listingCard?: boolean } = {},
): UnreadableKind | null {
  if (!fileName) return null;
  const base = fileName.slice(fileName.lastIndexOf("/") + 1).trim();
  const dot = base.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  // On a listing card a Word file (.docx) is read (Adam, 11 Nov 2026;
  // lib/documents/word-read.ts); the old format (.doc) isn't. The registers
  // and CPD don't read Word, as before.
  if (where.listingCard && ext === "docx") return null;
  if (where.listingCard && ext === "doc") return "older Word files (.doc)";
  return KIND_BY_EXTENSION[ext] ?? null;
}

/** What the spot says, word for word, about a file of that kind (Adam, 3 Nov 2026). */
export function savedButCantRead(kind: UnreadableKind): string {
  return `Saved, but we can't read ${kind}. Save it as a PDF and upload that, and we'll fill in the details for you.`;
}

/** The sentence for a stored file the reader can't open, or null when it can be read. */
export function cantReadMessage(fileName: string | null | undefined, where: { listingCard?: boolean } = {}): string | null {
  const kind = unreadableKind(fileName, where);
  return kind ? savedButCantRead(kind) : null;
}
