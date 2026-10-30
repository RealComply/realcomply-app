// What happened the last time the comparable-sales report was read (30 Oct
// 2026). Kept on the ESP card (a4), where the report is attached, as
// data.reportRead, and carried through Mark done there.
//
// Before this, a read that failed or found nothing left no trace: no sales,
// no draft, and no word on either card, so an agent could not tell "nothing
// in the report" from "never read" from "couldn't be read". Now the card says
// which, in plain words, and the reasoning card offers its draft once the
// report has actually been read.

export type ReportReadOutcome = "read" | "nothing_found" | "failed" | "wrong_document";

export type ReportRead = {
  /** When it was read. */
  at: string;
  /** The file that was read: a note about an earlier file is not shown. */
  path: string;
  outcome: ReportReadOutcome;
  /** Sold properties and on-market listings the read found. */
  sales?: number;
  listings?: number;
  /** Plain words: why a read failed, or what the wrong document looks like. */
  message?: string;
};

type PatchLike = {
  itemKey: string;
  comparableSales?: unknown[];
  marketListings?: unknown[];
  wrongDocument?: { expected: string; actual: string };
};

/** The outcome of a read that finished, from what it returned. */
export function reportReadFrom(patches: PatchLike[], path: string, at: string): ReportRead {
  const wrong = patches.find((p) => p.wrongDocument);
  if (wrong?.wrongDocument) {
    return { at, path, outcome: "wrong_document", message: wrong.wrongDocument.actual };
  }
  const sales = patches.reduce((n, p) => n + (p.comparableSales?.length ?? 0), 0);
  const listings = patches.reduce((n, p) => n + (p.marketListings?.length ?? 0), 0);
  return { at, path, outcome: sales + listings > 0 ? "read" : "nothing_found", sales, listings };
}

export function reportReadFailed(message: string, path: string, at: string): ReportRead {
  return { at, path, outcome: "failed", message };
}

/** The outcome kept on the ESP card, for the file attached there now. */
export function reportReadOf(data: unknown, evidencePath: string | null | undefined): ReportRead | null {
  const r = (data as { reportRead?: ReportRead } | null | undefined)?.reportRead;
  if (!r || !evidencePath || r.path !== evidencePath) return null;
  return r;
}

/** Read to the end: the sales it found are on file, or it had none. */
export function reportReadFinished(r: ReportRead | null): boolean {
  return r?.outcome === "read" || r?.outcome === "nothing_found";
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The reader's own words, as one sentence ending in a full stop. */
const sentence = (message: string | undefined, fallback: string) => `${(message ?? fallback).trim().replace(/\.+$/, "")}.`;

/**
 * What a card says about the read. "report" is the ESP card, beside the file;
 * "reasoning" is the ESP reasoning card, where the sales and the draft are,
 * and says nothing when the read went well (the sales are there to see).
 */
export function reportReadNote(
  r: ReportRead | null,
  card: "report" | "reasoning",
): { tone: "ok" | "warn"; text: string } | null {
  if (!r) return null;
  switch (r.outcome) {
    case "read": {
      if (card === "reasoning") return null;
      const sales = r.sales ?? 0;
      const listings = r.listings ?? 0;
      const found = [
        sales > 0 ? count(sales, "sale", "sales") : "no sales",
        listings > 0 ? `${count(listings, "listing", "listings")} on the market` : null,
      ]
        .filter(Boolean)
        .join(" and ");
      return { tone: "ok", text: `Read for comparable sales: ${found}. They're on the ESP reasoning card.` };
    }
    case "nothing_found":
      return {
        tone: "warn",
        text:
          card === "report"
            ? "Read, but no sales or listings were found in it. Check this is the comparable-sales report, or add the sales yourself on the ESP reasoning card."
            : "The comparable-sales report was read, but no sales or listings were found in it. Add the sales yourself below, or check the report on the ESP card.",
      };
    case "failed": {
      const why = sentence(r.message, "couldn't be read just now");
      return {
        tone: "warn",
        text:
          card === "report"
            ? `Comparable sales not read: ${why}`
            : `No sales from the comparable-sales report yet: ${why} Read again is beside the report on the ESP card.`,
      };
    }
    case "wrong_document":
      return {
        tone: "warn",
        text:
          card === "report"
            ? `Comparable sales not read: this file looks like ${r.message ?? "a different kind of document"}, not a comparable-sales report, so nothing was taken from it. Replace the file.`
            : "No sales from the comparable-sales report yet: the file on the ESP card is not a comparable-sales report. Replace it there.",
      };
  }
}
