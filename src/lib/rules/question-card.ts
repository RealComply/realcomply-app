// A Yes / No question card, and an optional upload card (Power of Attorney,
// 15 Oct 2026; mockup approved by Adam the same day).
//
// The engine only. What a card asks, and what its Yes brings with it, is in
// the rules file (lib/rules/nsw-sales.ts, the item's `question`). Pure, so the
// rules about when a question is complete, what a change of answer clears and
// what the compliance file prints are tested without a database.
//
// WHAT IS KEPT, on the card's data:
//   * the answer, and who gave it and when;
//   * the tick that Yes brings (where the card has one), and who ticked it
//     and when;
//   * a history of every answer and tick, so changing Yes to No clears the
//     tick without losing the fact that it was once given.
// Names are kept as they were at the time, like a typed signature, so a
// later change of name never reaches back into the record.

export type Answer = "yes" | "no";

export type Actor = { id: string; name: string };

export type QuestionEvent = {
  at: string;
  by: string;
  byName: string;
  event: "answered_yes" | "answered_no" | "ticked" | "unticked";
};

export type QuestionData = {
  answer?: Answer;
  answeredBy?: string;
  answeredByName?: string;
  answeredAt?: string;
  ticked?: boolean;
  tickedBy?: string;
  tickedByName?: string;
  tickedAt?: string;
  history?: QuestionEvent[];
};

/** What the rules file says about a question card. */
export type QuestionSpec = {
  /** The small line shown after No. */
  noLine: string;
  /** The tick that Yes brings, if any. Without one, Yes completes the card. */
  yesTick?: { label: string; line: string };
  /** The small line under the tick, after Yes. */
  yesLine?: string;
};

/** Reads a stored question defensively; anything unexpected is no answer. */
export function readQuestion(raw: unknown): QuestionData {
  if (!raw || typeof raw !== "object") return {};
  const d = raw as Record<string, unknown>;
  const answer = d.answer === "yes" || d.answer === "no" ? d.answer : undefined;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    answer,
    answeredBy: str(d.answeredBy),
    answeredByName: str(d.answeredByName),
    answeredAt: str(d.answeredAt),
    ticked: d.ticked === true,
    tickedBy: str(d.tickedBy),
    tickedByName: str(d.tickedByName),
    tickedAt: str(d.tickedAt),
    history: Array.isArray(d.history) ? (d.history as QuestionEvent[]) : [],
  };
}

/** Complete: answered No, or answered Yes and (where Yes brings a tick) ticked. */
export function questionComplete(spec: QuestionSpec, data: QuestionData): boolean {
  if (data.answer === "no") return true;
  if (data.answer === "yes") return spec.yesTick ? data.ticked === true : true;
  return false;
}

/** Records an answer. Moving away from Yes clears the tick; the history keeps it. */
export function applyAnswer(data: QuestionData, answer: Answer, actor: Actor, at: string): QuestionData {
  const history = [...(data.history ?? [])];
  if (data.answer === answer) return data;
  const next: QuestionData = {
    ...data,
    answer,
    answeredBy: actor.id,
    answeredByName: actor.name,
    answeredAt: at,
  };
  if (answer === "no" && data.ticked) {
    history.push({ at, by: actor.id, byName: actor.name, event: "unticked" });
    next.ticked = false;
    delete next.tickedBy;
    delete next.tickedByName;
    delete next.tickedAt;
  }
  history.push({ at, by: actor.id, byName: actor.name, event: answer === "yes" ? "answered_yes" : "answered_no" });
  next.history = history;
  return next;
}

/**
 * Ticks or unticks Yes's tick. Refused (returns null) unless the answer is
 * Yes: there is nothing to tick after No.
 */
export function applyTick(data: QuestionData, ticked: boolean, actor: Actor, at: string): QuestionData | null {
  if (data.answer !== "yes") return null;
  if ((data.ticked === true) === ticked) return data;
  const history = [...(data.history ?? []), { at, by: actor.id, byName: actor.name, event: ticked ? "ticked" : "unticked" } as QuestionEvent];
  if (!ticked) {
    const next: QuestionData = { ...data, ticked: false, history };
    delete next.tickedBy;
    delete next.tickedByName;
    delete next.tickedAt;
    return next;
  }
  return { ...data, ticked: true, tickedBy: actor.id, tickedByName: actor.name, tickedAt: at, history };
}

/** Who uploaded a document card's file, and when (kept on the card's data). */
export type UploadRecord = { uploadedBy?: string; uploadedByName?: string; uploadedAt?: string };

/**
 * The lines the compliance file prints under a question card: the answer, the
 * tick (if Yes), each with who and when. `when` formats a timestamp.
 */
export function questionRecordLines(spec: QuestionSpec, data: QuestionData, when: (iso: string) => string): string[] {
  if (!data.answer) return ["Not answered."];
  const answered = `Answer: ${data.answer === "yes" ? "Yes" : "No"}. Answered by ${data.answeredByName ?? "a team member"}${
    data.answeredAt ? ` on ${when(data.answeredAt)}` : ""
  }.`;
  if (data.answer === "no" || !spec.yesTick) return [answered];
  const tick = data.ticked
    ? `${spec.yesTick.label}: ticked by ${data.tickedByName ?? "a team member"}${data.tickedAt ? ` on ${when(data.tickedAt)}` : ""}.`
    : `${spec.yesTick.label}: not ticked.`;
  return [answered, tick];
}

/** The line the compliance file prints under a document card. */
export function documentRecordLine(
  fileName: string | null | undefined,
  upload: UploadRecord,
  when: (iso: string) => string,
): string {
  if (!fileName) return "No copy uploaded (optional).";
  return `Uploaded: ${fileName}, by ${upload.uploadedByName ?? "a team member"}${upload.uploadedAt ? ` on ${when(upload.uploadedAt)}` : ""}.`;
}

const QUESTION_FIELDS = [
  "answer",
  "answeredBy",
  "answeredByName",
  "answeredAt",
  "ticked",
  "tickedBy",
  "tickedByName",
  "tickedAt",
  "history",
] as const;

/**
 * The card's stored data with the question part replaced, everything else
 * (an attached file's name, say) kept. A cleared tick stays cleared: the old
 * question fields are taken out before the new ones go in.
 */
export function withQuestion(raw: unknown, q: QuestionData): Record<string, unknown> {
  const base: Record<string, unknown> = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
  for (const k of QUESTION_FIELDS) delete base[k];
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(q)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * What the compliance file prints under a question or document card, the
 * same on the PDF and the on-screen summary. Times in Sydney.
 */
export function questionAndDocumentRecordLines(
  item: { kind: string; question?: QuestionSpec },
  current: { data?: unknown; evidence_path?: string | null } | undefined,
  when: (iso: string) => string,
): string[] {
  if (item.kind === "question" && item.question) {
    return questionRecordLines(item.question, readQuestion(current?.data), when);
  }
  if (item.kind === "document") {
    const data = (current?.data ?? {}) as UploadRecord & { evidenceFileName?: string };
    return [documentRecordLine(current?.evidence_path ? (data.evidenceFileName ?? "a copy") : null, data, when)];
  }
  return [];
}
