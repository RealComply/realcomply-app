// Market feedback an ESP revision responded to (Reg s12G(1)(f), from 17
// November 2026; Master, 9 Nov 2026: build 5 after 17 November).
//
// Reg s12G(1)(f): "if the estimated selling price is revised in response to
// market feedback—the following details— (i) the name of the person who gave
// the feedback, (ii) the date the feedback was given, (iii) a description of
// the feedback, (iv) the reasons why the agent used the feedback, (v) a
// description of how the agent used the feedback." Fair Trading's guide adds
// the person's phone or email as best practice, so it is asked for, not
// required.
//
// Kept with the revision it belongs to (esp_revisions.market_feedback, 0117),
// so it is entered when the revision is saved: a revision can't be changed
// once recorded. "Market feedback" isn't defined in the Regulation.
//
// Three ways to record it, in any mix (Adam, 9 Nov 2026: "give the option to
// upload evidence of market feedback and also point to market feedback being
// held in their CRM"): typed here, a record of it attached (an email, a note,
// a CRM export, in the listing's d3 folder), or where it's kept (the CRM).
// The same "recorded somewhere else" as the offers log and the reasoning card:
// the Regulation asks for the record, not that it lives in RealComply. All
// three go in the one list, the attachment and the pointer as items with a
// "kind", so no new column is needed.

import { formatAuDate } from "@/lib/format-date";

export type MarketFeedback = {
  /** Who gave it (s12G(1)(f)(i)). */
  who: string;
  /** Their phone or email: best practice, not required. */
  contact: string | null;
  /** The date it was given (ii), yyyy-mm-dd. */
  on: string;
  /** What it was (iii). */
  what: string;
  /** Why the agent used it (iv). */
  why: string;
  /** How the agent used it (v). */
  how: string;
};

export const FEEDBACK_TICK = "The ESP was revised in response to market feedback";
export const FEEDBACK_HINT =
  "Reg s12G. For each piece of feedback: who gave it, when, what it was, why you used it and how. Type it here, attach a record of it, or say where it's kept.";
export const FEEDBACK_FILE_LABEL = "Attach a record of the feedback";
export const FEEDBACK_FILE_HINT = "An email, a note, or an export from your CRM.";
export const FEEDBACK_ELSEWHERE_LABEL = "This feedback is recorded somewhere else";
export const FEEDBACK_ELSEWHERE_HINT = "Your CRM, for example. The file will point there.";
export const FEEDBACK_ELSEWHERE_PLACEHOLDER = "Where? e.g. LockedOn, Rex, VaultRE";
export const FEEDBACK_LABELS = {
  who: "Who gave it",
  contact: "Their phone or email (best practice)",
  on: "Date given",
  what: "What the feedback was",
  why: "Why you used it",
  how: "How you used it",
} as const;

export const FEEDBACK_INCOMPLETE =
  "For each piece of market feedback, put in who gave it, the date, what it was, why you used it and how.";
export const FEEDBACK_NONE =
  "Add the market feedback the revision responded to, attach a record of it or say where it's kept, or untick it.";
export const FEEDBACK_WHERE_MISSING = "Say where the market feedback is recorded, for example the name of your CRM.";

/**
 * Required with "recorded somewhere else" (Adam, 9 Nov 2026): the agent
 * confirms the record kept there has everything s12G(1)(f) asks for.
 */
export const FEEDBACK_ELSEWHERE_CONFIRM =
  "The feedback, who gave it, when, why it was relevant and how I used it are recorded there.";
export const FEEDBACK_CONFIRM_MISSING =
  "Tick that the feedback, who gave it, when, why it was relevant and how you used it are recorded there.";

/** The record of the feedback that isn't typed here: a file, where it's kept, and the tick that it's all there. */
export type FeedbackRecord = { file: { path: string; name: string } | null; where: string | null; confirmed: boolean };
const NO_RECORD: FeedbackRecord = { file: null, where: null, confirmed: false };

const MAX_ENTRIES = 20;
const MAX_NAME = 200;
const MAX_TEXT = 2000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const text = (v: unknown, max: number): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

/**
 * The feedback as sent from the revision form: checked and tidied, or what's
 * missing. `ticked` is the form's tick; untick it and nothing is kept. Typed
 * entries, an attached record and where it's kept can come in any mix; at
 * least one is needed, and each typed entry needs all five details. The
 * file's folder is checked by the caller.
 */
export function marketFeedbackFrom(
  raw: unknown,
  ticked: boolean,
  other: {
    file: { path: string; name: string } | null;
    elsewhere: boolean;
    where: string | null;
    confirmed?: boolean;
  } = {
    file: null,
    elsewhere: false,
    where: null,
  },
): { entries: MarketFeedback[]; record: FeedbackRecord } | { error: string } {
  if (!ticked) return { entries: [], record: NO_RECORD };
  const where = other.elsewhere ? text(other.where, MAX_NAME) : null;
  if (other.elsewhere && !where) return { error: FEEDBACK_WHERE_MISSING };
  if (where && other.confirmed !== true) return { error: FEEDBACK_CONFIRM_MISSING };
  const record: FeedbackRecord = { file: other.file, where, confirmed: Boolean(where) };
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return { error: FEEDBACK_INCOMPLETE };
    }
  }
  if (!Array.isArray(list)) return { error: FEEDBACK_INCOMPLETE };
  // A row left completely empty is skipped, not refused.
  const rows = (list as Array<Record<string, unknown>>).filter(
    (r) => r && typeof r === "object" && ["who", "contact", "on", "what", "why", "how"].some((k) => text(r[k], MAX_TEXT)),
  );
  if (rows.length === 0) return record.file || record.where ? { entries: [], record } : { error: FEEDBACK_NONE };
  const entries: MarketFeedback[] = [];
  for (const r of rows.slice(0, MAX_ENTRIES)) {
    const who = text(r.who, MAX_NAME);
    const on = typeof r.on === "string" && ISO_DATE.test(r.on.trim()) ? r.on.trim() : null;
    const what = text(r.what, MAX_TEXT);
    const why = text(r.why, MAX_TEXT);
    const how = text(r.how, MAX_TEXT);
    if (!who || !on || !what || !why || !how) return { error: FEEDBACK_INCOMPLETE };
    entries.push({ who, contact: text(r.contact, MAX_NAME), on, what, why, how });
  }
  return { entries, record };
}

/** What goes in esp_revisions.market_feedback: the typed entries, then the file and where it's kept. */
export function feedbackToStore(feedback: { entries: MarketFeedback[]; record: FeedbackRecord }): unknown[] {
  const { file, where, confirmed } = feedback.record;
  return [
    ...feedback.entries,
    ...(file ? [{ kind: "file", path: file.path, name: file.name }] : []),
    ...(where ? [{ kind: "elsewhere", where, confirmed }] : []),
  ];
}

/** The attached record and where it's kept, from what a revision kept. */
export function feedbackRecordOf(raw: unknown): FeedbackRecord {
  if (!Array.isArray(raw)) return NO_RECORD;
  let file: FeedbackRecord["file"] = null;
  let where: string | null = null;
  let confirmed = false;
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r !== "object") continue;
    if (r.kind === "file" && typeof r.path === "string" && r.path) {
      file = { path: r.path, name: text(r.name, MAX_NAME) ?? r.path.split("/").pop() ?? "Market feedback" };
    }
    if (r.kind === "elsewhere") {
      where = text(r.where, MAX_NAME) ?? where;
      confirmed = r.confirmed === true;
    }
  }
  return { file, where, confirmed };
}

/** The compliance record's lines for the attached record, where it's kept, and the tick. */
export function feedbackRecordLines(revisionNo: number, record: FeedbackRecord, tickedBy: string | null = null): string[] {
  return [
    record.file ? `Revision ${revisionNo}, market feedback record attached: ${record.file.name}.` : null,
    record.where ? `Revision ${revisionNo}, market feedback recorded in: ${record.where}.` : null,
    record.where && record.confirmed
      ? `Revision ${revisionNo}, ticked${tickedBy ? ` by ${tickedBy}` : ""}: "${FEEDBACK_ELSEWHERE_CONFIRM}"`
      : null,
  ].filter((l): l is string => Boolean(l));
}

/** The feedback kept on a revision (0117), as the app reads it. Anything malformed is left out. */
export function marketFeedbackOf(raw: unknown): MarketFeedback[] {
  if (!Array.isArray(raw)) return [];
  const out: MarketFeedback[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r !== "object" || "kind" in r) continue;
    const who = text(r.who, MAX_NAME);
    const on = typeof r.on === "string" && ISO_DATE.test(r.on) ? r.on : null;
    const what = text(r.what, MAX_TEXT);
    if (!who || !on || !what) continue;
    out.push({ who, contact: text(r.contact, MAX_NAME), on, what, why: text(r.why, MAX_TEXT) ?? "", how: text(r.how, MAX_TEXT) ?? "" });
  }
  return out;
}

/** "Sam Buyer (0400 000 000), 24 November 2026" */
export function feedbackFrom(f: MarketFeedback): string {
  return `${f.who}${f.contact ? ` (${f.contact})` : ""}, ${formatAuDate(f.on)}`;
}

/** One line for the compliance record. */
export function feedbackRecordLine(revisionNo: number, f: MarketFeedback): string {
  return `Revision ${revisionNo}, market feedback from ${feedbackFrom(f)}: ${f.what} Why used: ${f.why} How used: ${f.how}`;
}
