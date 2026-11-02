import { after } from "next/server";
import { logReadFailure, readFailureWhy, type ReadFailureWhy } from "@/lib/documents/read-core";
import { sydneyDate } from "@/lib/subscription-end/dates";

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
//
// AND THE ALERT STILL GOES (Adam, 2 Nov 2026: "yes close the gap"). Before,
// the database decided whether an alert was due, so a read the database
// couldn't record (a brief fault, a missing function, a refusal) was never
// emailed. Now, when the record can't be written, the app decides with the
// same rule (alertDue), names the office and listing if it can, and sends it
// anyway: at most once a day per listing from each server, since the
// database's once-a-day claim isn't there to rely on.

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
  /**
   * The office, for a read that isn't on a listing: names it in an alert sent
   * without the record. A listing's office comes from the listing.
   */
  agencyId?: string | null;
};

/** What Adam's alert says, with the office and listing the database looked up. */
export type ReaderAlert = {
  reader: ReaderName;
  card: string;
  fileName: string;
  /** Null only when sent without the record and the name couldn't be looked up. */
  office: string | null;
  listing: string | null;
  /** The listing the read was on, if any: named by id when its address couldn't be looked up. */
  propertyId?: string | null;
  outcome: ReadOutcome;
  why: ReadFailureWhy | null;
  sales: number | null;
  at: Date;
  /** Why the read couldn't be recorded, when this alert was sent without the record. */
  unrecorded?: string;
};

/** What note_document_read() returns (0103). */
type NoteResult = { alert?: boolean; office?: string | null; listing?: string | null };

/** One row looked up by id, for naming the office and listing without the record. */
type Lookup = {
  select: (columns: string) => {
    eq: (column: string, value: string) => { maybeSingle: () => PromiseLike<{ data: unknown }> };
  };
};

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  // Typed loosely on purpose: the Supabase client's own types are too deep to
  // check against Lookup. namesFor reads it as a Lookup.
  from?: (table: string) => unknown;
};

/**
 * Whether a read needs Adam's alert: a failed read, or a comparable-sales
 * report that gave no comparable sales. The same rule as
 * note_document_read() (0103), for when the database can't be asked.
 */
export function alertDue(note: Pick<ReadNote, "reader" | "outcome" | "sales">): boolean {
  return note.outcome === "failed" || (note.reader === "comparable_sales" && (note.sales ?? 0) === 0);
}

// Alerts sent without the record, this server, today: the once-a-day limit
// the database would have kept. Each server keeps its own, so on a bad day a
// second email about a listing is possible; never none.
let unrecordedDay = "";
const unrecordedSent = new Set<string>();

function firstUnrecordedToday(note: ReadNote, now: Date): boolean {
  const day = sydneyDate(now);
  if (day !== unrecordedDay) {
    unrecordedDay = day;
    unrecordedSent.clear();
  }
  const key = note.propertyId ? `listing:${note.propertyId}` : `office:${note.agencyId ?? "unknown"}:${note.reader}`;
  if (unrecordedSent.has(key)) return false;
  unrecordedSent.add(key);
  return true;
}

/** Gives up after `ms`: the alert never waits on a database that isn't answering. */
function within<T>(work: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  return Promise.race([Promise.resolve(work), timeout]).finally(() => clearTimeout(timer));
}

/** The office's name and the listing's address, if they can be looked up. Best effort. */
async function namesFor(supabase: RpcClient, note: ReadNote): Promise<{ office: string | null; listing: string | null }> {
  const none = { office: null, listing: null };
  if (!supabase.from) return none;
  const table = (name: string) => supabase.from!(name) as Lookup;
  try {
    if (note.propertyId) {
      const { data } = await within(
        table("properties").select("address, agencies(name)").eq("id", note.propertyId).maybeSingle(),
        3000,
      );
      const row = data as { address?: string | null; agencies?: { name?: string | null } | null } | null;
      return { office: row?.agencies?.name ?? null, listing: row?.address ?? null };
    }
    if (note.agencyId) {
      const { data } = await within(table("agencies").select("name").eq("id", note.agencyId).maybeSingle(), 3000);
      return { office: (data as { name?: string | null } | null)?.name ?? null, listing: null };
    }
  } catch {
    // The names help; the alert goes without them.
  }
  return none;
}

/** The tables a staff read is written to, with the service key. */
type StaffTables = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
    upsert: (
      row: Record<string, unknown>,
      options: { onConflict: string; ignoreDuplicates: boolean },
    ) => { select: (columns: string) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
  };
};

/**
 * The record of a read done by RealComply staff on an office's listing (2 Nov
 * 2026: Adam's re-reads of three comparable-sales reports, lib/documents/
 * cma-reread). note_document_read() (0103) only records a read for someone
 * signed in to the listing's own office, so a staff read is written with the
 * service key instead: the same row in document_reads, recorded against the
 * listing's office, and the same claim on the day's alert in reader_alerts, so
 * one email a listing a day holds across both. Hands noteRead what the
 * database function would have returned.
 */
export function staffReadRecord(service: unknown, agencyId: string, now: () => Date = () => new Date()): RpcClient {
  const db = service as StaffTables;
  const from = (table: string) => (service as { from: (t: string) => unknown }).from(table);
  return {
    from,
    rpc: async (_fn, args) => {
      const reader = args.p_reader as ReaderName;
      const outcome = args.p_outcome as ReadOutcome;
      const propertyId = (args.p_property_id as string | null | undefined) ?? null;
      const sales = (args.p_sales as number | null | undefined) ?? null;
      const { error } = await db.from("document_reads").insert({
        agency_id: agencyId,
        property_id: propertyId,
        reader,
        outcome,
        why: outcome === "failed" ? ((args.p_why as string | null | undefined) ?? "other") : null,
        sales: sales === null ? null : Math.max(sales, 0),
      });
      if (error) return { data: null, error: { message: error.message } };
      if (!alertDue({ reader, outcome, sales })) return { data: { alert: false }, error: null };

      // The database function's key, so a listing's one email a day holds
      // whoever read it.
      const day = sydneyDate(now());
      const key = propertyId ? `listing:${propertyId}:${day}` : `office:${agencyId}:${reader}:${day}`;
      const { data: claimed, error: claimError } = await db
        .from("reader_alerts")
        .upsert({ alert_key: key, agency_id: agencyId, property_id: propertyId }, { onConflict: "alert_key", ignoreDuplicates: true })
        .select("alert_key");
      // Already claimed today: recorded, not emailed. A claim that couldn't be
      // made sends the email anyway: never none.
      if (!claimError && (!Array.isArray(claimed) || claimed.length === 0)) return { data: { alert: false }, error: null };
      const names = await namesFor({ rpc: async () => ({ data: null, error: null }), from }, {
        reader,
        card: "",
        fileName: "",
        outcome,
        propertyId,
        agencyId,
      });
      return { data: { alert: true, office: names.office, listing: names.listing }, error: null };
    },
  };
}

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
 * one. A read that can't be recorded still sends its alert when one is due.
 * Never throws.
 */
export async function noteRead(supabase: RpcClient, note: ReadNote, options: Options = {}): Promise<void> {
  const failed = note.outcome === "failed";
  const why: ReadFailureWhy | null = failed ? (note.why ?? readFailureWhy(note.error)) : null;
  if (failed) logReadFailure(note.reader, note.error, why!);
  const at = (options.now ?? (() => new Date()))();

  let result: NoteResult | null = null;
  let unrecorded: string | null = null;
  try {
    const { data, error } = await supabase.rpc("note_document_read", {
      p_reader: note.reader,
      p_outcome: note.outcome,
      p_why: why,
      p_property_id: note.propertyId ?? null,
      p_sales: note.reader === "comparable_sales" ? (note.sales ?? 0) : null,
    });
    if (error) unrecorded = error.message;
    else if (!data || typeof data !== "object") unrecorded = "the database gave no answer";
    else result = data as NoteResult;
  } catch (e) {
    unrecorded = e instanceof Error ? e.message : String(e);
  }
  if (unrecorded !== null) console.error(`document read not recorded: ${note.reader}`, unrecorded);

  // Recorded: the database has said whether this is today's alert for the
  // listing. Not recorded: the same rule, kept here.
  if (result ? !result.alert : !(alertDue(note) && firstUnrecordedToday(note, at))) return;

  const send = options.send ?? sendToAdam;
  (options.later ?? afterResponse)(async () => {
    try {
      const names = result
        ? { office: result.office ?? null, listing: result.listing ?? null }
        : await namesFor(supabase, note);
      const alert: ReaderAlert = {
        reader: note.reader,
        card: note.card,
        fileName: note.fileName,
        office: names.office,
        listing: names.listing,
        propertyId: note.propertyId ?? null,
        outcome: note.outcome,
        why,
        sales: note.reader === "comparable_sales" ? (note.sales ?? 0) : null,
        at,
        ...(unrecorded !== null ? { unrecorded: unrecorded.slice(0, 200) } : {}),
      };
      await send(alert);
    } catch (e) {
      console.error(`reader alert not sent: ${note.reader}`, e instanceof Error ? e.message : String(e));
    }
  });
}
