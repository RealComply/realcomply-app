import Anthropic from "@anthropic-ai/sdk";
import { logReadFailure } from "@/lib/documents/read-core";
import { UnfinishedAnswer } from "@/lib/documents/reader-answer";
import { mapWithLimit, READER_PARTS_AT_ONCE } from "@/lib/documents/reader-parts";
import { sgChecks, type SgChecks } from "@/lib/sg-document/checks";
import {
  openSgFile,
  partCount,
  readerAsker,
  readerBusy,
  readSgPart,
  SgFileUnreadable,
  unreadablePart,
  type SgFile,
} from "@/lib/sg-document/read";
import { assembleSections, documentText, readPartOf, versionOf, type ReadPartResult, type SgSection } from "@/lib/sg-document/sections";

// Moving a read along (part 1, 10 Nov 2026). Called by the page while
// someone is waiting, and by the hourly job (api/cron/sg-documents) for
// anything left: a page closed part way through, and the manuals already on
// file (Master, 10 Nov 2026: "A"). Whoever calls first claims the document
// for a few minutes, so two never read the same part; every part is kept as
// soon as it's read.
//
// The reader being busy or out of reach is not a failed read: what was read
// is kept and the next call carries on. One part the reader can't answer
// never stops the rest (Adam, 10 Nov 2026): it is read again in smaller
// pieces (lib/sg-document/read.ts), and pages that still can't be read are
// named on the draft. Only the file itself (missing, locked, damaged, too
// long, or no words at all) fails the read, in plain words.

export const MAX_PARTS = 200;

export type SgReadDoc = {
  id: string;
  agency_id: string;
  file_path: string;
  file_name: string;
  read_parts: unknown;
};

export type SgReadProgress = { status: "reading" | "draft" | "read_failed" | "elsewhere"; done: number; total: number | null };

/** Everything advanceSgRead needs from the database and storage (the service key in the app; made up in tests). */
export type SgReadStore = {
  /** The document, if it's still being read and nobody else holds it; it's then held for `minutes`. */
  claim(id: string, minutes: number): Promise<SgReadDoc | null>;
  /** How far it is, for whoever didn't get the claim. */
  progress(id: string): Promise<SgReadProgress>;
  download(path: string): Promise<{ bytes: Uint8Array } | { missing: true } | { error: string }>;
  saveParts(id: string, parts: Array<ReadPartResult | null>, total: number): Promise<void>;
  release(id: string): Promise<void>;
  officeNames(agencyId: string): Promise<{ businessNames: string[]; licenseeNames: string[] }>;
  finish(id: string, agencyId: string, done: { sections: SgSection[]; version: string | null; checks: SgChecks }): Promise<void>;
  fail(id: string, plain: string): Promise<void>;
  note(agencyId: string, fileName: string, outcome: "read" | "failed" | "nothing_found", error?: unknown): Promise<void>;
};

type Ask = Parameters<typeof readSgPart>[3];


/** What a read that stopped says on the draft. */
export function sgReadFailureText(err: unknown): string {
  if (err instanceof SgFileUnreadable) return err.plain;
  if (err instanceof UnfinishedAnswer) {
    if (err.why === "cut_off") return "Part of it couldn't be read to the end. Try reading it again.";
    if (err.why === "refused") return "It couldn't be read. Try reading it again, or upload the Word version.";
    return "It couldn't be read properly. Try reading it again.";
  }
  return "It couldn't be read just now. Try reading it again in a minute.";
}

export async function advanceSgRead(
  store: SgReadStore,
  id: string,
  options: { maxParts?: number; until?: number; ask?: Ask; claimMinutes?: number } = {},
): Promise<SgReadProgress> {
  const doc = await store.claim(id, options.claimMinutes ?? 5);
  if (!doc) return store.progress(id);

  const fail = async (err: unknown): Promise<SgReadProgress> => {
    const plain = sgReadFailureText(err);
    await store.fail(id, plain);
    await store.note(doc.agency_id, doc.file_name, "failed", err);
    return { status: "read_failed", done: 0, total: null };
  };

  const got = await store.download(doc.file_path);
  if ("missing" in got) return fail(new SgFileUnreadable("The file isn't there any more. Upload it again."));
  if ("error" in got) {
    await store.release(id);
    return { status: "reading", done: 0, total: null };
  }

  let file: SgFile;
  try {
    file = await openSgFile(got.bytes, doc.file_name);
  } catch (err) {
    return fail(err);
  }
  const total = partCount(file);
  if (total > MAX_PARTS) {
    return fail(new SgFileUnreadable("This document is too long to read here. Upload it in a shorter form, or the Word version."));
  }

  const kept = Array.isArray(doc.read_parts) ? (doc.read_parts as unknown[]) : [];
  const parts: Array<ReadPartResult | null> = Array.from({ length: total }, (_, i) => readPartOf(kept[i]));
  const ask = options.ask ?? readerAsker(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
  let budget = options.maxParts ?? total;
  const until = options.until ?? Number.POSITIVE_INFINITY;

  while (budget > 0 && Date.now() < until) {
    const todo = parts
      .map((p, i) => (p ? -1 : i))
      .filter((i) => i >= 0)
      .slice(0, Math.min(budget, READER_PARTS_AT_ONCE));
    if (todo.length === 0) break;
    budget -= todo.length;
    const stop: { err: unknown } = { err: null };
    await mapWithLimit(todo, READER_PARTS_AT_ONCE, async (i) => {
      try {
        parts[i] = await readSgPart(file, i, doc.file_name, ask);
      } catch (err) {
        if (readerBusy(err)) {
          stop.err ??= err;
          return;
        }
        // Anything else about this one part: its pages are named as not
        // read, and the rest carry on.
        logReadFailure("sg_manual", err);
        parts[i] = unreadablePart(file, i);
      }
    });
    await store.saveParts(id, parts, total);
    if (stop.err) {
      await store.release(id);
      return { status: "reading", done: parts.filter(Boolean).length, total };
    }
  }

  const done = parts.filter(Boolean).length;
  if (done < total) {
    await store.release(id);
    return { status: "reading", done, total };
  }

  const read = parts as ReadPartResult[];
  const pagesNotRead = [...new Set(read.flatMap((p) => p.unreadPages ?? []))].sort((a, b) => a - b);
  const unmarked = read.reduce((n, p) => n + (p.unmarked ?? 0), 0);
  const sections = assembleSections(read);
  if (sections.every((s) => s.paragraphs.length === 0 && s.title === "The whole document")) {
    const nonePages = file.kind === "pdf" && pagesNotRead.length === file.pages;
    await store.fail(
      id,
      nonePages
        ? "None of its pages could be read. Try reading it again in a while, or upload the Word version."
        : "No words could be read from this file. Check it opens, then upload it again.",
    );
    await store.note(doc.agency_id, doc.file_name, nonePages ? "failed" : "nothing_found", nonePages ? new UnfinishedAnswer("unparseable") : undefined);
    return { status: "read_failed", done, total };
  }
  const checks: SgChecks = {
    ...sgChecks(documentText(sections), await store.officeNames(doc.agency_id)),
    ...(pagesNotRead.length > 0 ? { pages_not_read: pagesNotRead } : {}),
    ...(unmarked > 0 ? { unmarked_stretches: unmarked } : {}),
  };
  await store.finish(id, doc.agency_id, { sections, version: versionOf(read), checks });
  await store.note(doc.agency_id, doc.file_name, "read");
  if (pagesNotRead.length > 0 || unmarked > 0) {
    // Read, with gaps the draft names. Logged so it's seen, never the file's name.
    console.error(`document read in part: sg_manual (${pagesNotRead.length} pages not read, ${unmarked} stretches without headings)`);
  }
  return { status: "draft", done, total };
}
