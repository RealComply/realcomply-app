import Anthropic from "@anthropic-ai/sdk";
import { readableBytes } from "@/lib/documents/readable-bytes";
import { UnfinishedAnswer, toolAnswer, unfinishedMessage, type UnfinishedWhy } from "@/lib/documents/reader-answer";
import {
  TOO_LARGE_TO_READ,
  READER_IMAGE_MAX_BYTES,
  READER_PART_MAX_BYTES,
  READER_PARTS_AT_ONCE,
  isTooLargeError,
  mapWithLimit,
  partNote,
  splitPdfForReader,
} from "@/lib/documents/reader-parts";

// The one way a document is put to the reader (moved here from
// lib/actions/extraction.ts on 1 Nov 2026, unchanged, so the listing
// documents can be read by the sample-report tests and the daily check as
// well as by the app). Every reader in RealComply goes through askParts.

/** The model every document read uses. */
export const READER_MODEL = "claude-sonnet-5";

export function buildDocumentBlock(
  contentType: string,
  bytes: Uint8Array,
  fileName: string,
): Anthropic.Messages.ContentBlockParam | null {
  const base64 = () => Buffer.from(bytes).toString("base64");
  if (contentType === "application/pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64() },
    };
  }
  if (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(contentType)) {
    return {
      type: "image",
      source: { type: "base64", media_type: contentType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64() },
    };
  }
  if (contentType === "text/plain") {
    return {
      type: "text",
      text: `Document "${fileName}":\n\n${Buffer.from(bytes).toString("utf-8")}`,
    };
  }
  return null;
}

// ── Reading a file whole, or in parts when it's large (25 Oct 2026) ─────────
//
// Every read goes through these two. A PDF over 20 MB is split into parts of
// whole pages, copied unchanged, and each part is read; see
// lib/documents/reader-parts.ts for why nothing is lost. Before this, a PDF
// over about 24 MB failed and the screen showed the reader's own error, which
// is where an agent read "32 MB" and shrank her scans to fit.

export type ReadPart = { block: Anthropic.Messages.ContentBlockParam; note: string | null };

export type PreparedRead =
  | { ok: true; contentType: string; bytes: Uint8Array; parts: ReadPart[] }
  | { ok: false; problem: "too_large" }
  | { ok: false; problem: "unsupported"; contentType: string };

export async function prepareRead(blob: Blob, fileName: string): Promise<PreparedRead> {
  // readableBytes rather than a plain arrayBuffer: a phone photo can arrive as
  // HEIC, which nothing downstream can open. See lib/documents/readable-bytes.
  const { bytes, contentType } = await readableBytes(blob, fileName);

  if (contentType === "application/pdf") {
    const split = await splitPdfForReader(bytes);
    if (!split.ok) return { ok: false, problem: "too_large" };
    return {
      ok: true,
      contentType,
      bytes,
      parts: split.parts.map((part) => ({
        block: buildDocumentBlock(contentType, part.bytes, fileName)!,
        note: partNote(part),
      })),
    };
  }

  const block = buildDocumentBlock(contentType, bytes, fileName);
  if (!block) return { ok: false, problem: "unsupported", contentType };
  // A photo can't be split. Over the reader's own cap for one image, it
  // can't be read; never shrunk here, never asked to be shrunk.
  if (contentType.startsWith("image/") && bytes.length > READER_IMAGE_MAX_BYTES) return { ok: false, problem: "too_large" };
  if (contentType === "text/plain" && bytes.length > READER_PART_MAX_BYTES) return { ok: false, problem: "too_large" };
  return { ok: true, contentType, bytes, parts: [{ block, note: null }] };
}

export type PartQuestion = {
  system: string;
  /** What the reader is asked. A function when the first part is asked something the rest aren't. */
  text: string | ((partIndex: number) => string);
  tool: Anthropic.Messages.Tool;
  maxTokens: number;
};

/**
 * Asks each part, a few at a time, and returns each part's answer (the
 * tool's input) in page order. A file read whole is one part with no note,
 * asked exactly as before.
 *
 * Any part's answer that was cut off at maxTokens, refused, held no tool
 * call, or can't be used fails the whole read with UnfinishedAnswer (every
 * reader, 1 Nov 2026; see lib/documents/reader-answer). Never "nothing found".
 */
export async function askParts(
  anthropic: Anthropic,
  parts: ReadPart[],
  question: PartQuestion,
  firstIndex = 1,
): Promise<Array<Record<string, unknown>>> {
  return mapWithLimit(parts, READER_PARTS_AT_ONCE, async (part, i) => {
    const text = typeof question.text === "function" ? question.text(firstIndex + i) : question.text;
    const response = await anthropic.messages.create({
      model: READER_MODEL,
      max_tokens: question.maxTokens,
      system: part.note ? `${question.system} ${part.note}` : question.system,
      messages: [{ role: "user", content: [part.block, { type: "text", text }] }],
      tools: [question.tool],
      tool_choice: { type: "tool", name: question.tool.name },
    });
    return toolAnswer(response, question.tool.input_schema as Parameters<typeof toolAnswer>[1]);
  });
}

/** A file the reader can't take, even in parts. */
export class TooLargeToRead extends Error {}

/**
 * A file that never reached the reader: it couldn't be downloaded, is empty
 * or damaged ("file"), or is a kind the reader can't take ("unsupported").
 * The message is already plain words for the card.
 */
export class FileCantBeRead extends Error {
  readonly why: "file" | "unsupported";
  constructor(why: "file" | "unsupported", message: string) {
    super(message);
    this.why = why;
  }
}

/** Why a read failed, in a word: for the error log, the record of reads and Adam's alert. */
export type ReadFailureWhy = UnfinishedWhy | "too_large" | "unsupported" | "file" | "service" | "other";

export function readFailureWhy(err: unknown): ReadFailureWhy {
  if (err instanceof TooLargeToRead || isTooLargeError(err)) return "too_large";
  if (err instanceof UnfinishedAnswer) return err.why;
  if (err instanceof FileCantBeRead) return err.why;
  if (err instanceof Anthropic.APIError) return "service";
  return "other";
}

/** Failures that are the reader's own (as opposed to the file's): said in the reader's words. */
const readersOwn = (why: ReadFailureWhy): why is UnfinishedWhy | "service" =>
  why === "cut_off" || why === "unparseable" || why === "refused" || why === "no_answer" || why === "service";

/**
 * Logged as an error, every time a read fails (1 Nov 2026). The reader and why
 * only, with the service's status where there is one: never the file's name,
 * which often carries a person's.
 */
export function logReadFailure(reader: string, err: unknown, why: ReadFailureWhy = readFailureWhy(err)): void {
  const status = err instanceof Anthropic.APIError ? err.status : undefined;
  console.error(`document read failed: ${reader} (${why})`, status ?? "", why === "other" && err instanceof Error ? err.message : "");
}

/**
 * What a failed read of a listing document says on its card, after the
 * document's name. Those cards have Read again beside the file. Plain words
 * only (25 Oct 2026): the reader's own errors, JSON and byte counts, went
 * straight onto the screen before, which is where "32 MB" came from.
 */
export function readFailure(err: unknown): string {
  const why = readFailureWhy(err);
  if (why === "too_large") return "too large to read automatically, so enter its details yourself";
  if (err instanceof UnfinishedAnswer) {
    return `${unfinishedMessage(err.why)}. ${err.why === "cut_off" || err.why === "unparseable" ? "Try Read again" : "Try Read again in a minute"}`;
  }
  if (why === "service") return "couldn't be read just now. Try again in a minute";
  return err instanceof Error ? err.message : "extraction failed";
}

/**
 * A failed read as whole sentences, for a card that names the document
 * itself: "The certificate couldn't be read to the end, so nothing was taken
 * from it." then `next`, what to do on that card. Too large keeps its own
 * words. A failure that isn't the reader's (a file that won't open) is
 * `otherwise`, what the card already said.
 */
export function failedReadSentence(why: ReadFailureWhy, document: string, next: string, otherwise: string): string {
  if (why === "too_large") return TOO_LARGE_TO_READ;
  if (!readersOwn(why)) return otherwise;
  // "Just now" for a busy or failed service, a refusal or no answer: trying
  // again later is the whole of what to do.
  const said = unfinishedMessage(why === "service" ? "no_answer" : why);
  return `${document.charAt(0).toUpperCase()}${document.slice(1)} ${said}.${next ? ` ${next}` : ""}`;
}
