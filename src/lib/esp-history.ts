import { formatAuDate } from "@/lib/format-date";
import { sydneyDate } from "@/lib/subscription-end/dates";
import { reformsInForce } from "@/lib/rules/underquoting-reforms";
import { feedbackRecordOf, marketFeedbackOf, type FeedbackRecord, type MarketFeedback } from "@/lib/rules/market-feedback";
import { revisionComparablesOf, type RevisionComparable } from "@/lib/rules/revision-comparables";

// ESP REVISION HISTORY (Adam, 3 Nov 2026; mockup approved; database 0110).
//
// WAS: the card "Was the Estimated Selling Price revised?" (d3) held one set of
// figures and one notice, and a new notice wrote over the last.
// NOW: every revision is kept, with its notice: from and to figures, the date
// the notice was given, who recorded it and when. Only the latest drives the
// checks. The card lists every version, newest first, the original ESP from the
// agency agreement at the bottom; the audit pack has a page of every change.
//
// The words and the order live here, with no database or network, so every rule
// is tested (esp-history.test.ts).

/** A revision as recorded (esp_revisions, 0110). */
export type EspRevision = {
  no: number;
  low: number;
  high: number;
  /** YYYY-MM-DD, the date the notice was given to the seller. */
  givenOn: string | null;
  noticePath: string;
  noticeFileName: string | null;
  enteredManually: boolean;
  recordedByName: string | null;
  /** ISO time. */
  recordedAt: string;
  /** The ESP before this revision, as the notice states it (s72A(5)(b)(i); 0117). Null when not recorded. */
  previousLow?: number | null;
  previousHigh?: number | null;
  /** The evidence given to the seller (s72A(5)(b)(ii); 0117): a file, or part of the notice. */
  evidencePath?: string | null;
  evidenceFileName?: string | null;
  evidenceInNotice?: boolean;
  /** The market feedback it responded to (Reg s12G(1)(f); 0117). Empty when none. */
  marketFeedback?: MarketFeedback[];
  /** Its record attached, and where it's kept (the CRM), when there is one. */
  marketFeedbackRecord?: FeedbackRecord;
  /** The comparable sales taken into account for it (Reg s12G(1)(a), (c); 0120). Empty when none were kept. */
  comparables?: RevisionComparable[];
  /** The information used and where it came from (Reg s12G(1)(a)(iv); 0120). */
  comparablesInfoUsed?: string | null;
  /** Why fewer than 3 are comparable (Reg s12G(1)(d); 0120). */
  comparablesFewerReason?: string | null;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** The database row, as the app reads it. Null for anything that isn't one. */
export function revisionFrom(row: Record<string, unknown> | null | undefined): EspRevision | null {
  if (!row) return null;
  const no = num(row.revision_no);
  const low = num(row.esp_low);
  const high = num(row.esp_high);
  if (no === null || low === null || high === null || typeof row.notice_path !== "string") return null;
  return {
    no,
    low,
    high,
    givenOn: typeof row.notice_given_on === "string" ? row.notice_given_on.slice(0, 10) : null,
    noticePath: row.notice_path,
    noticeFileName: typeof row.notice_file_name === "string" ? row.notice_file_name : null,
    enteredManually: row.entered_manually === true,
    recordedByName: typeof row.recorded_by_name === "string" ? row.recorded_by_name : null,
    recordedAt: String(row.recorded_at ?? ""),
    previousLow: num(row.previous_esp_low),
    previousHigh: num(row.previous_esp_high),
    evidencePath: typeof row.evidence_path === "string" ? row.evidence_path : null,
    evidenceFileName: typeof row.evidence_file_name === "string" ? row.evidence_file_name : null,
    evidenceInNotice: row.evidence_in_notice === true,
    marketFeedback: marketFeedbackOf(row.market_feedback),
    marketFeedbackRecord: feedbackRecordOf(row.market_feedback),
    comparables: revisionComparablesOf(row.comparables),
    comparablesInfoUsed: typeof row.comparables_info_used === "string" ? row.comparables_info_used : null,
    comparablesFewerReason: typeof row.comparables_fewer_reason === "string" ? row.comparables_fewer_reason : null,
  };
}

/**
 * Before 0110 has run, a revision is only on the card (d3): shown as Revision 1
 * all the same, so nothing looks lost while the database catches up.
 */
export function revisionsOrCard(
  revisions: EspRevision[],
  d3: { data?: unknown; evidence_path?: string | null } | null | undefined,
): EspRevision[] {
  if (revisions.length > 0) return [...revisions].sort((a, b) => a.no - b.no);
  const data = (d3?.data ?? {}) as Record<string, unknown>;
  const low = num(data.revisedEspLow);
  const high = num(data.revisedEspHigh);
  if (low === null || high === null || !d3?.evidence_path || data.espRevised !== true) return [];
  return [
    {
      no: 1,
      low,
      high,
      givenOn: typeof data.noticeServedOn === "string" ? data.noticeServedOn : null,
      noticePath: d3.evidence_path,
      noticeFileName: typeof data.evidenceFileName === "string" ? data.evidenceFileName : null,
      enteredManually: data.enteredManually === true,
      recordedByName: null,
      recordedAt: typeof data.noticeReadAt === "string" ? data.noticeReadAt : "",
    },
  ];
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;

/** "$1,250,000 to $1,300,000", or one figure when the range is a single price. */
export function espRange(low: number | null, high: number | null): string {
  if (low === null && high === null) return "Not recorded";
  if (low === null || high === null || low === high) return money((low ?? high) as number);
  return `${money(low)} to ${money(high)}`;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "28 Oct", the day in Sydney. */
export function shortDay(iso: string): string {
  const day = sydneyDate(new Date(iso));
  return `${Number(day.slice(8, 10))} ${SHORT_MONTHS[Number(day.slice(5, 7)) - 1]}`;
}

/** "4:12pm", the time in Sydney. */
function sydneyTime(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s/g, "")
    .toLowerCase();
}

/** "Recorded by Dana Whitlock, 28 Oct, 4:12pm" (the mockup). */
export function recordedLine(r: Pick<EspRevision, "recordedByName" | "recordedAt">): string | null {
  if (!r.recordedAt || Number.isNaN(Date.parse(r.recordedAt))) return r.recordedByName ? `Recorded by ${r.recordedByName}` : null;
  const when = `${shortDay(r.recordedAt)}, ${sydneyTime(r.recordedAt)}`;
  return r.recordedByName ? `Recorded by ${r.recordedByName}, ${when}` : `Recorded ${when}`;
}

/** One version on the card, newest first. */
export type EspVersion = {
  key: string;
  /** "Revision 2", or "Original ESP". */
  label: string;
  range: string;
  latest: boolean;
  /** "Latest: used for checks", or "Replaced 28 Oct". */
  pill: string;
  /** The lines under it: when the notice was given, who recorded it. */
  lines: string[];
  /** The notice (or the agency agreement), when there is one. */
  file: { path: string; name: string } | null;
  /** The evidence given with a revision (0117), when it is its own file. */
  evidence?: { path: string; name: string } | null;
  /** The market feedback a revision responded to (Reg s12G(1)(f)). */
  feedback?: MarketFeedback[];
  feedbackRecord?: FeedbackRecord;
  /** A revision's own comparable sales, the information used, and why fewer than 3 (0120). */
  comparables?: RevisionComparable[];
  comparablesInfoUsed?: string | null;
  comparablesFewerReason?: string | null;
};

export const LATEST_PILL = "Latest: used for checks";

/**
 * Every version on the card (the mockup): the latest marked "Latest: used for
 * checks", the older ones "Replaced [date]" (the day the next was recorded),
 * and the original ESP from the agency agreement at the bottom.
 */
export function espVersions(
  original: { low: number | null; high: number | null; agreementDate: string | null; file: { path: string; name: string } | null },
  revisions: EspRevision[],
): EspVersion[] {
  const sorted = [...revisions].sort((a, b) => a.no - b.no);
  const out: EspVersion[] = sorted.map((r, i) => {
    const next = sorted[i + 1];
    const latest = !next;
    const before = i > 0 ? sorted[i - 1] : original;
    const stated = { low: r.previousLow ?? null, high: r.previousHigh ?? null };
    const lines = [
      r.givenOn ? `Notice given ${formatAuDate(r.givenOn)}` : "Date the notice was given not recorded",
      stated.low != null && stated.high != null ? `ESP before it, on the notice: ${espRange(stated.low, stated.high)}` : null,
      previousEspDiffers(stated, before) ? NOT_THE_ESP_ON_FILE : null,
      r.evidenceInNotice ? "Evidence: in the notice" : null,
      recordedLine(r),
      r.enteredManually ? "Figures typed from the notice" : null,
    ].filter((l): l is string => Boolean(l));
    return {
      key: `revision-${r.no}`,
      label: `Revision ${r.no}`,
      range: espRange(r.low, r.high),
      latest,
      pill: latest ? LATEST_PILL : `Replaced ${next.recordedAt ? shortDay(next.recordedAt) : ""}`.trim(),
      lines,
      file: { path: r.noticePath, name: r.noticeFileName ?? "Revised ESP notice" },
      evidence: r.evidencePath ? { path: r.evidencePath, name: r.evidenceFileName ?? "Evidence" } : null,
      feedback: r.marketFeedback ?? [],
      feedbackRecord: r.marketFeedbackRecord,
      comparables: r.comparables ?? [],
      comparablesInfoUsed: r.comparablesInfoUsed ?? null,
      comparablesFewerReason: r.comparablesFewerReason ?? null,
    };
  });
  out.reverse();
  const first = sorted[0];
  out.push({
    key: "original",
    label: "Original ESP",
    range: espRange(original.low, original.high),
    latest: sorted.length === 0,
    pill: sorted.length === 0 ? LATEST_PILL : `Replaced ${first.recordedAt ? shortDay(first.recordedAt) : ""}`.trim(),
    lines: [original.agreementDate ? `From the agency agreement, ${formatAuDate(original.agreementDate)}` : "From the agency agreement"],
    file: original.file,
  });
  return out;
}

/** Above the history (the mockup). */
export const HISTORY_HELP =
  "Every change stays on the file, with its notice. RealComply checks advertised prices and the sale price against the latest one.";

/**
 * The button on the card that adds the next revision.
 * REVERSAL (Master, 3 Nov 2026). Was: "Record another revision", and to add
 * one the agent reopened the card (Adam's instruction to Global Property,
 * 3 Nov). Now: this button, shown whenever the card is answered Yes, done or
 * not, with no reopening. Why: reopening and changing the answer isn't
 * intuitive (Adam, 3 Nov).
 */
export const ADD_REVISION = "Add new estimated selling price revision";
export const UPLOAD_HELP =
  "Upload the notice you gave the seller and RealComply reads the new figures from it. Check them before you save.";
// The line under the upload, "Accepted files: Clear photo or PDF.", lives in
// lib/storage/accepted-files.ts since 3 Nov 2026: it is under every upload
// RealComply reads now, not only this one (Adam).

/**
 * Before saving (Adam, 3 Nov 2026): "Saving this replaces Revision [N] as the
 * latest. Revision [N] and its notice stay on the file. The price statement
 * approval is cancelled and needs approving again against the new figure."
 * For the first revision there is no Revision [N]: the original ESP is what it
 * replaces.
 */
export function replaceWarning(latestNo: number | null): string {
  if (latestNo === null) {
    return "Saving this replaces the original ESP as the latest. The original ESP stays on the file. The price statement approval is cancelled and needs approving again against the new figure.";
  }
  return `Saving this replaces Revision ${latestNo} as the latest. Revision ${latestNo} and its notice stay on the file. The price statement approval is cancelled and needs approving again against the new figure.`;
}

// ── The audit pack's page (Adam, 3 Nov 2026) ─────────────────────────────

/** One row of "Estimated selling price: every change": Version, ESP, Date, Recorded by, Evidence. */
export type EspPackRow = {
  version: string;
  esp: string;
  date: string;
  recordedBy: string;
  /** The document's path in the pack, to link to its page. Null when there is none. */
  evidencePath: string | null;
  /** "Revised ESP notice", "Agency agreement". */
  evidenceLabel: string;
};

/** The table, oldest first: Original, Revision 1, ..., the latest marked "(latest)". */
export function espPackRows(
  original: { low: number | null; high: number | null; agreementDate: string | null; agreementPath: string | null },
  revisions: EspRevision[],
): EspPackRow[] {
  const sorted = [...revisions].sort((a, b) => a.no - b.no);
  const rows: EspPackRow[] = [
    {
      version: "Original",
      esp: espRange(original.low, original.high),
      date: original.agreementDate ? formatAuDate(original.agreementDate) : "Not recorded",
      recordedBy: "From the agency agreement",
      evidencePath: original.agreementPath,
      evidenceLabel: "Agency agreement",
    },
  ];
  sorted.forEach((r, i) => {
    rows.push({
      version: `Revision ${r.no}${i === sorted.length - 1 ? " (latest)" : ""}`,
      esp: espRange(r.low, r.high),
      date: r.givenOn ? formatAuDate(r.givenOn) : "Not recorded",
      recordedBy: r.recordedByName ?? "Not recorded",
      evidencePath: r.noticePath,
      evidenceLabel: "Revised ESP notice",
    });
  });
  return rows;
}

/** A price statement approval, or its cancellation, for the list under the table. */
export type ApprovalEvent = { kind: "approved" | "cancelled"; at: string; by: string | null; because: string | null };

/** Why an approval was cancelled, in words, from listing_signoff_cancellations (0100). */
export function cancelledBecause(
  c: { because: string; becauseItemKey: string | null; cancelledAt: string },
  revisions: EspRevision[],
): string {
  if (c.becauseItemKey === "d3") {
    // Recorded in the same transaction as the cancellation, so at the same time.
    const t = Date.parse(c.cancelledAt);
    const match = [...revisions]
      .sort((a, b) => b.no - a.no)
      .find((r) => Math.abs(Date.parse(r.recordedAt) - t) < 5 * 60_000 && Date.parse(r.recordedAt) <= t + 1000);
    return match ? `Revision ${match.no} recorded` : "the ESP revision changed";
  }
  if (c.becauseItemKey === "a4") return "the ESP card was changed";
  if (c.becauseItemKey === "a4c") return "the ESP reasoning was reopened";
  if (c.because === "withdrawn") return "withdrawn";
  if (c.because === "file_reopened") return "the file sign-off was cancelled";
  return "a card it rests on was reopened";
}

/** The approvals and cancellations, in date order, one line each. */
export function approvalLines(events: ApprovalEvent[]): string[] {
  return [...events]
    .filter((e) => e.at && !Number.isNaN(Date.parse(e.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.kind === "approved" ? -1 : 1))
    .map((e) => {
      const day = formatAuDate(sydneyDate(new Date(e.at)));
      if (e.kind === "approved") return `Approved ${day}${e.by ? ` by ${e.by}` : ""}`;
      return `Cancelled ${day}${e.because ? `: ${e.because}` : ""}`;
    });
}

// ── The draft: a notice read, not yet saved as a revision ─────────────────

/**
 * A new notice, read and waiting for the agent to check its figures and save
 * (d3 data.pending). Until then the latest revision is untouched and still
 * drives every check.
 */
export type PendingRevision = {
  path: string;
  fileName: string;
  uploadedAt: string | null;
  low: number | null;
  high: number | null;
  givenOn: string | null;
  methodOfService: string | null;
  reason: string | null;
  evidenceProvidedBeforeNotice: boolean | null;
  /** The ESP before the revision, as the notice states it (s72A(5)(b)(i)), when it could be read. */
  previousLow?: number | null;
  previousHigh?: number | null;
  /** Why the figures couldn't be read; the agent types them from the notice. */
  readFailed: string | null;
  /** The file isn't a notice revising the ESP: nothing to save from it. */
  notRecognised: boolean;
};

/** d3 data.pending, as the app reads it. */
export function pendingFrom(data: unknown): PendingRevision | null {
  const p = (data as { pending?: Record<string, unknown> } | null | undefined)?.pending;
  if (!p || typeof p.path !== "string" || !p.path) return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    path: p.path,
    fileName: str(p.fileName) ?? "Revised ESP notice",
    uploadedAt: str(p.uploadedAt),
    low: num(p.low),
    high: num(p.high),
    givenOn: str(p.givenOn) && /^\d{4}-\d{2}-\d{2}$/.test(String(p.givenOn)) ? String(p.givenOn) : null,
    methodOfService: str(p.methodOfService),
    reason: str(p.reason),
    evidenceProvidedBeforeNotice: typeof p.evidenceProvidedBeforeNotice === "boolean" ? p.evidenceProvidedBeforeNotice : null,
    previousLow: num(p.previousLow),
    previousHigh: num(p.previousHigh),
    readFailed: str(p.readFailed),
    notRecognised: p.notRecognised === true,
  };
}

/** A figure as typed: "$1,250,000" or "1250000". Null when there is none. */
export function typedFigure(raw: unknown): number | null {
  const n = Number(String(raw ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Each revision: the ESP before it and the evidence (s72A(5); 0117) ──────
// Adam, 9 Nov 2026: "check the old ESP and attach the evidence". From 17
// November 2026 the notice of a revision has to include the ESP before it and
// the revised ESP (s72A(5)(b)(i)), and the seller is given evidence the
// revised ESP is reasonable (s72A(5)(b)(ii)). Cited as plain "s72A", which is
// right on both sides of the date (underquoting-reforms.ts). A notice given
// before 17 November is checked against the rules then: neither is asked for.

export const PREVIOUS_ESP_LABEL = "ESP before the revision, as on the notice";
export const PREVIOUS_ESP_HINT = "From 17 November the notice has to state it (s72A).";
export const EVIDENCE_LABEL = "Evidence of the revised ESP you gave the seller";
export const EVIDENCE_HINT = "Comparable sales, market conditions, buyer feedback. From 17 November (s72A).";
export const EVIDENCE_IN_NOTICE_LABEL = "The evidence is part of the notice file";
export const NOT_THE_ESP_ON_FILE = "Not the ESP on file before it";

/** On the card while it is open: the latest notice doesn't state the ESP before it. */
export const PREVIOUS_ESP_MISSING =
  "The notice doesn't state the ESP before the revision, which it has to from 17 November (s72A). Give the seller a notice that states it, and add it as a new revision.";

/** Saving is refused without it, from 17 November: a revision row can't be changed later (0117). */
export const EVIDENCE_MISSING =
  "Attach the evidence of the revised ESP you gave the seller, or tick that it is part of the notice (s72A).";

/** Whether a notice given on this date (yyyy-mm-dd) falls under the 17 November rules. No date: today. */
export function noticeUnderReforms(givenOn: string | null, now: Date = new Date()): boolean {
  return reformsInForce(givenOn && /^\d{4}-\d{2}-\d{2}$/.test(givenOn) ? new Date(`${givenOn}T12:00:00+11:00`) : now);
}

/**
 * The old ESP check: the ESP before the revision, as the notice states it,
 * against the ESP on file. Says so when they differ; null when they match or
 * either isn't there.
 */
export function previousEspDiffers(
  stated: { low: number | null; high: number | null },
  onFile: { low: number | null; high: number | null } | null,
): string | null {
  if (stated.low == null || stated.high == null || onFile?.low == null || onFile.high == null) return null;
  if (stated.low === onFile.low && stated.high === onFile.high) return null;
  return `The notice gives the ESP before the revision as ${espRange(stated.low, stated.high)}, but the file has ${espRange(onFile.low, onFile.high)}. Check the notice.`;
}

/** The notice has to state the ESP before the revision, from 17 November. Null when it does, or before then. */
export function previousEspProblem(
  stated: { low: number | null; high: number | null },
  givenOn: string | null,
  now: Date = new Date(),
): string | null {
  return noticeUnderReforms(givenOn, now) && (stated.low == null || stated.high == null) ? PREVIOUS_ESP_MISSING : null;
}

/** The evidence: a file, or part of the notice, from 17 November. Null when it is there, or before then. */
export function revisionEvidenceProblem(
  input: { evidencePath: string | null; inNotice: boolean; givenOn: string | null },
  now: Date = new Date(),
): string | null {
  return noticeUnderReforms(input.givenOn, now) && !input.evidencePath && !input.inNotice ? EVIDENCE_MISSING : null;
}
