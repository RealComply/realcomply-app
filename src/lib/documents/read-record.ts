import { after } from "next/server";
import { logReadFailure, readFailureWhy, type ReadFailureWhy } from "@/lib/documents/read-core";

// THE RECORD OF READS, AND ADAM'S SAME-DAY ALERT (Adam, 1 Nov 2026).
//
// "Stop a silent reader failure ever happening again." On 30 Oct 2026 a
// comparable-sales report's answer was cut off at the reader's length limit
// and passed for "no sales found", on three live listings, and nobody knew
// (PR #95). Now every read is recorded (supabase/migrations/0103), every
// failed one is logged as an error and said on its card, and Adam is emailed
// the same day when a read fails or a comparable-sales report gives 0
// comparables: at most one email per listing per day, and for a read that
// isn't on a listing one per office and kind of document per day. Monday's
// staff email counts the week's reads (lib/email/reader-week).
//
// Recording never gets in the way of the read: a record that can't be
// written is logged and the agent carries on.

/** Every reader RealComply has, as the alert and the weekly email name them. */
export const READERS = {
  agency_agreement: "agency agreement",
  contract: "contract for sale",
  comparable_sales: "comparable-sales report",
  revised_esp_notice: "notice of revised estimated selling price",
  covering_letter: "solicitor's covering letter",
  id_screen: "identity document check",
  inspection_report: "pre-purchase inspection report",
  cpd_certificate: "CPD certificate",
  licence: "licence or certificate of registration",
  insurance_certificate: "insurance certificate",
} as const;

export type ReaderName = keyof typeof READERS;

export type ReadOutcome = "read" | "nothing_found" | "wrong_document" | "failed";

export type ReadNote = {
  reader: ReaderName;
  /** The card, as the alert names it: "Comparable sales (a4)", "CPD register". */
  card: string;
  /** For the alert only. Never recorded. */
  fileName: string;
  propertyId?: string | null;
  outcome: ReadOutcome;
  /** Why a read failed. Worked out from `error` when not given. */
  why?: ReadFailureWhy;
  /** What a failed read threw, for the error log. */
  error?: unknown;
  /** Comparable sales found (the comparable-sales report only). */
  sales?: number | null;
};

/** What Adam's alert says, with the office and listing the database looked up. */
export type ReaderAlert = {
  reader: ReaderName;
  card: string;
  fileName: string;
  office: string;
  listing: string | null;
  outcome: ReadOutcome;
  why: ReadFailureWhy | null;
  sales: number | null;
  at: Date;
};

/** What note_document_read() returns (0103). */
type NoteResult = { alert?: boolean; office?: string | null; listing?: string | null };

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

type Options = {
  /** Sends the alert. The real one emails Adam (lib/email/reader-alert). */
  send?: (alert: ReaderAlert) => Promise<unknown>;
  /** Runs the send once the response has gone. `after` from next/server. */
  later?: (task: () => Promise<unknown>) => void;
  now?: () => Date;
};

async function sendToAdam(alert: ReaderAlert): Promise<unknown> {
  const { sendReaderAlert } = await import("@/lib/email/reader-alert");
  return sendReaderAlert(alert);
}

function afterResponse(task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch {
    // Outside a request (a script): now, rather than not at all.
    void task();
  }
}

/**
 * Records one read, logs it as an error when it failed, and sends Adam the
 * day's alert for its listing when this read is the first today that needs
 * one. Never throws.
 */
export async function noteRead(supabase: RpcClient, note: ReadNote, options: Options = {}): Promise<void> {
  const failed = note.outcome === "failed";
  const why: ReadFailureWhy | null = failed ? (note.why ?? readFailureWhy(note.error)) : null;
  if (failed) logReadFailure(note.reader, note.error, why!);

  let result: NoteResult | null = null;
  try {
    const { data, error } = await supabase.rpc("note_document_read", {
      p_reader: note.reader,
      p_outcome: note.outcome,
      p_why: why,
      p_property_id: note.propertyId ?? null,
      p_sales: note.reader === "comparable_sales" ? (note.sales ?? 0) : null,
    });
    if (error) {
      console.error(`document read not recorded: ${note.reader}`, error.message);
      return;
    }
    result = (data ?? null) as NoteResult | null;
  } catch (e) {
    console.error(`document read not recorded: ${note.reader}`, e instanceof Error ? e.message : String(e));
    return;
  }

  if (!result?.alert) return;
  const alert: ReaderAlert = {
    reader: note.reader,
    card: note.card,
    fileName: note.fileName,
    office: result.office ?? "an office",
    listing: result.listing ?? null,
    outcome: note.outcome,
    why,
    sales: note.reader === "comparable_sales" ? (note.sales ?? 0) : null,
    at: (options.now ?? (() => new Date()))(),
  };
  const send = options.send ?? sendToAdam;
  (options.later ?? afterResponse)(async () => {
    try {
      await send(alert);
    } catch (e) {
      console.error(`reader alert not sent: ${note.reader}`, e instanceof Error ? e.message : String(e));
    }
  });
}
