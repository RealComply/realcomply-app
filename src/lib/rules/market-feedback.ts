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
export const FEEDBACK_HINT = "Reg s12G. For each piece of feedback: who gave it, when, what it was, why you used it and how.";
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
export const FEEDBACK_NONE = "Add the market feedback the revision responded to, or untick it.";

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
 * missing. `ticked` is the form's tick; untick it and nothing is kept.
 */
export function marketFeedbackFrom(
  raw: unknown,
  ticked: boolean,
): { entries: MarketFeedback[] } | { error: string } {
  if (!ticked) return { entries: [] };
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
  if (rows.length === 0) return { error: FEEDBACK_NONE };
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
  return { entries };
}

/** The feedback kept on a revision (0117), as the app reads it. Anything malformed is left out. */
export function marketFeedbackOf(raw: unknown): MarketFeedback[] {
  if (!Array.isArray(raw)) return [];
  const out: MarketFeedback[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r !== "object") continue;
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
