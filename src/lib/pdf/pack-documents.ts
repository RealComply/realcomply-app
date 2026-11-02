import { STAGE_LABELS, type PropertyItem, type PropertyStage } from "@/lib/types";
import type { ComplianceItem } from "@/lib/rules/nsw-sales";
import { getItem } from "@/lib/rules/nsw-sales";
import { isInFolder } from "@/lib/storage/evidence";

// Every document on a listing, in the order the audit pack puts them (Adam,
// 2 Nov 2026): the record's own order, stage by stage and card by card, then
// any file on a card the record no longer shows, then files on complaints
// linked to the listing. The current version of each file only: what a card
// (or an entry on the reports card) names now. A file an agent replaced
// stays in the listing's folder but isn't on the card, so it isn't here.
//
// No database and no network: the pack builder (lib/pdf/audit-pack.ts) reads
// the rows and fetches the bytes.

export type PackDocKind = "pdf" | "image" | "heic" | "other";

export type PackDocument = {
  /** The stage's name, as the record heads it ("Pre-market"), or "Complaints". */
  stage: string;
  /** The card's title as the record prints it, or "Complaint received 12 October 2026". */
  cardTitle: string;
  /** The name the file was uploaded under. Never the storage path. */
  fileName: string;
  uploadedBy: string | null;
  /** ISO time. Null when nothing records it. */
  uploadedAt: string | null;
  /** Where it is stored. Used to fetch it; never printed. */
  path: string;
  kind: PackDocKind;
};

const EXTENSION_KIND: Record<string, PackDocKind> = {
  pdf: "pdf",
  jpg: "image",
  jpeg: "image",
  png: "image",
  heic: "heic",
  heif: "heic",
};

/** What kind of document a file name says it is. */
export function packDocKind(fileName: string): PackDocKind {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return EXTENSION_KIND[ext] ?? "other";
}

const TYPE_LABEL: Record<string, string> = {
  doc: "Word document (.doc)",
  docx: "Word document (.docx)",
  xls: "Excel spreadsheet (.xls)",
  xlsx: "Excel spreadsheet (.xlsx)",
  eml: "saved email (.eml)",
  msg: "saved Outlook email (.msg)",
};

/** "Word document (.docx)": for "Not included in this PDF: [file type]." */
export function fileTypeLabel(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return TYPE_LABEL[ext] ?? (ext && ext !== fileName.toLowerCase() ? `.${ext} file` : "file of an unknown type");
}

/** Where a file stands in the pack, by its storage path. Paths are unique; the first card to name one keeps it. */
type Uploads = Map<string, { by: string | null; at: string | null }>;

/** The time a file went up, from the "1730000000000-" its stored name starts with, when nothing else says. */
export function uploadedAtFromPath(path: string): string | null {
  const m = /\/(\d{13})-[^/]*$/.exec(path);
  if (!m) return null;
  const at = new Date(Number(m[1]));
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

const baseName = (path: string) => path.split("/").pop() ?? "document";
const named = (data: unknown, path: string) => {
  const name = (data as { evidenceFileName?: unknown } | null)?.evidenceFileName;
  return typeof name === "string" && name.trim() ? name.trim() : baseName(path).replace(/^\d{13}-/, "");
};

/**
 * The listing's documents, in pack order. `items` is the record's own list
 * (allItemsFor), so the order matches the record exactly. `listingFolder` is
 * "{agency}/{listing}/": a card naming a file anywhere else is left out, as
 * everywhere else in the app (isInFolder).
 */
export function packDocumentsFor(
  items: ComplianceItem[],
  byKey: Record<string, PropertyItem>,
  listingFolder: string,
  uploads: Uploads = new Map(),
): PackDocument[] {
  const out: PackDocument[] = [];
  const seen = new Set<string>();
  const who = (path: string, fallback: { by?: string | null; at?: string | null } = {}) => {
    const u = uploads.get(path);
    return {
      uploadedBy: u?.by ?? fallback.by ?? null,
      uploadedAt: u?.at ?? fallback.at ?? uploadedAtFromPath(path),
    };
  };
  const add = (stage: string, cardTitle: string, path: string, fileName: string, fallback?: { by?: string | null; at?: string | null }) => {
    if (seen.has(path) || !isInFolder(path, listingFolder)) return;
    seen.add(path);
    out.push({ stage, cardTitle, fileName, path, kind: packDocKind(fileName), ...who(path, fallback) });
  };
  const cardFiles = (stage: string, title: string, key: string, row: PropertyItem | undefined) => {
    if (!row) return;
    const data = (row.data ?? {}) as Record<string, unknown>;
    if (row.evidence_path) {
      add(stage, title, row.evidence_path, named(data, row.evidence_path), {
        by: typeof data.uploadedByName === "string" ? data.uploadedByName : null,
        at: typeof data.uploadedAt === "string" ? data.uploadedAt : null,
      });
    }
    // The reports card keeps one file per entry (f3), oldest first.
    if (key === "f3" && Array.isArray(data.entries)) {
      const entries = [...(data.entries as Array<Record<string, unknown>>)].reverse();
      for (const e of entries) {
        if (typeof e.evidencePath !== "string" || !e.evidencePath) continue;
        const name = typeof e.evidenceFileName === "string" && e.evidenceFileName ? e.evidenceFileName : baseName(e.evidencePath);
        add(stage, title, e.evidencePath, name, { at: typeof e.recordedAt === "string" ? e.recordedAt : null });
      }
    }
  };

  const shown = new Set<string>();
  for (const stage of [0, 1, 2, 3, 4, 5] as PropertyStage[]) {
    for (const item of items.filter((i) => i.stage === stage)) {
      shown.add(item.key);
      cardFiles(STAGE_LABELS[stage], item.label, item.key, byKey[item.key]);
    }
  }
  // A file on a card the record doesn't show (a retired card, say) is still
  // a document on the listing: never left out silently.
  for (const [key, row] of Object.entries(byKey)) {
    if (shown.has(key)) continue;
    cardFiles("Other documents on this listing", getItem(key)?.label ?? "A card no longer in use", key, row);
  }
  return out;
}
