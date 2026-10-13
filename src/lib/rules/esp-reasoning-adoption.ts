import type { EvidenceVerdict } from "@/lib/data/esp-draft";

// The ESP reasoning on file is the agent's own opinion (a4c).
//
// s72A makes the estimate the agent's opinion, so the reasoning on the file
// has to be theirs too. Whatever put the words in the box, the agent ticks
// OWN_OPINION, directly under it, before the card can be marked done:
//
//   1. RealComply's draft ("Draft my reasoning").
//   2. Reasoning read from the agent's own uploaded document (step 3).
//   3. Reasoning they typed or dictated on the card.
//
// Enforced here, on the server, whatever button sent the form, as well as on
// the page (Mark done stays unavailable until it is ticked, and says why).
// Words the agent did not type here (1 and 2) never save without the tick,
// even on a save that is not "done", so nothing reaches the file as their
// reasoning until they have said it is.
//
// ⚠️ REVERSAL, 14 Oct 2026 (Adam): the 2 Oct "edit before confirm" rule is
// removed. Was: the confirm control stayed disabled until the draft's wording
// was changed (spacing, punctuation and capitals alone did not count), with
// "Edit the draft to make it yours before you confirm" under it, and the
// server refused an unchanged draft. Now: no forced edit. The agent may use
// the draft as written if it says what they think; the tick is what makes it
// theirs, and the record says whether they changed it. The one-click confirm
// button ("This is my reasoning for the estimated selling price") went with
// it: the tick and the card's own Mark done replace it, so there is one
// statement to make, not two.
//
// ALREADY TICKED. A card re-saved with exactly the text a tick covers needs
// no second tick (re-pressing Mark done on a finished card is how its other
// fields are edited). Any change to the text needs a fresh one.
//
// Cards marked done before 14 Oct 2026 stay done: the tick is asked for the
// next time the card is marked done, not by reopening finished files.
//
// WHAT IS KEPT (data.reasoningAdoption on the a4c row), replaced on each tick:
//   source            "realcomply_draft", "document" or "typed"
//   originalText      the draft exactly as RealComply wrote it, or the text
//                     read from the document. Not kept for "typed". A tick on
//                     edited text that started as a draft or document keeps
//                     that origin, so the original is never lost.
//   confirmedText     the final text the agent ticked (also saved as data.note)
//   changed           draft or document only: whether the final text differs
//                     from the original in its wording, or was used as written.
//                     Spacing, punctuation and capitals alone are not a change.
//   statement         the words ticked, exactly as shown
//   confirmedBy / confirmedByName / confirmedAt   who ticked it, and when
//   draftGeneratedAt / evidence   draft only: when it was written, and how the
//                     sales sat against the estimate at the time
// Records from before 14 Oct 2026 have no statement or changed: they were
// confirmed with the one-click button, after the forced edit.
//
// Not aiDraft, although that was the suggested home. On this card aiDraft is
// already what the document READ produced, and ItemCard treats it as exactly
// that; it is also wiped by every save of the card. A second meaning for the
// same field would make RealComply's words and the agent's document
// impossible to tell apart later, which is the one thing this record is for.
//
// THE DISCLAIMER is on-screen only. It sits above the draft every time one is
// shown, is never part of the draft text, and is stripped from anything saved
// in case it was pasted into the box. The audit pack prints data.note, so it
// can never reach the pack or the finalised compliance record.

export const DISCLAIMER =
  "Draft only. RealComply wrote this from your report as an example. Check it, change it, and confirm it as your own. You are responsible for your reasoning.";
export const OWN_OPINION =
  "I've read this reasoning, made any changes I felt were needed, and it reflects my own opinion of the estimated selling price.";
export const TICK_FIRST = "Tick the box under the reasoning to confirm it is your own. Nothing is saved until you do.";
/** Under the card, while Mark done waits for the tick. */
export const TICK_NEEDED = "Tick the box under the reasoning before marking this card done.";

export type AdoptionSource = "realcomply_draft" | "document" | "typed";

export type ReasoningAdoptionRecord = {
  source: AdoptionSource;
  originalText?: string;
  confirmedText: string;
  changed?: boolean;
  statement?: string;
  confirmedBy: string;
  confirmedByName: string | null;
  confirmedAt: string;
  draftGeneratedAt?: string;
  evidence?: EvidenceVerdict | null;
};

/** The agent's confirmation that nothing comparable was on the market at the agreement date. */
export type NoneOnMarketRecord = { confirmedBy: string; confirmedAt: string };

/** What the card posts when the box holds text the agent did not type here. */
export type PendingReasoning =
  | { source: "realcomply_draft"; text: string; generatedAt: string; evidence: EvidenceVerdict | null }
  | { source: "document"; text: string };

/**
 * The wording of a text, without the things that are not wording: case,
 * punctuation (including digit grouping, so "$1,300,000" and "$1300000" are
 * the same figure) and spacing.
 */
export function wordingOf(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(?<=\d)[,.\s](?=\d{3}\b)/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** True when the wording differs, not only the spacing, punctuation or capitals. */
export function editedInWording(draft: string, text: string): boolean {
  return wordingOf(draft) !== wordingOf(text);
}

/**
 * Removes the on-screen disclaimer from text about to be saved, if it was
 * pasted in. Line endings come out as \n: a browser posts a textarea's line
 * breaks as \r\n but shows them as \n, and the two have to compare equal.
 */
export function withoutDisclaimer(text: string): string {
  return text.replace(/\r\n?/g, "\n").split(DISCLAIMER).join("").replace(/\n{3,}/g, "\n\n").trim();
}

export type A4cSaveInput = {
  note: string;
  /** What the page says it put in the box, if the agent did not type it. */
  pending: PendingReasoning | null;
  /** The status the save asks for. Only "done" needs the tick for the agent's own typing. */
  status: string;
  /** The agent ticked OWN_OPINION. */
  ticked: boolean;
  /**
   * The draft RealComply would write for this file now, worked out on the
   * server. A box holding it word for word is treated as the draft, even when
   * the request leaves out the fields that say so.
   */
  serverDraft: string | null;
  previous: Record<string, unknown> | null;
  user: { id: string; name: string | null };
  now: string;
};

/** The adoption record on a saved a4c row, if any. */
export function adoptionOf(data: Record<string, unknown> | null | undefined): ReasoningAdoptionRecord | null {
  const r = data?.reasoningAdoption as ReasoningAdoptionRecord | undefined;
  return r && typeof r === "object" && typeof r.confirmedText === "string" ? r : null;
}

/**
 * True when the text in the box is exactly what the last tick covered, so a
 * re-save needs no second tick. Records from before 14 Oct 2026 were not
 * ticks, so they never count.
 */
export function tickCovers(record: ReasoningAdoptionRecord | null, boxText: string): boolean {
  return Boolean(record?.statement) && withoutDisclaimer(record!.confirmedText) === withoutDisclaimer(boxText);
}

export function a4cSave(input: A4cSaveInput): { error: string } | { data: Record<string, unknown> } {
  const carried = carryForward(input.previous);
  const note = withoutDisclaimer(input.note);
  const previous = adoptionOf(input.previous);
  const covered = !input.pending && tickCovers(previous, note);

  // Words the agent did not type here: what the page says, or the server's
  // own draft when the box holds it word for word.
  const pending: PendingReasoning | null =
    input.pending ??
    (!covered && note && input.serverDraft && !editedInWording(input.serverDraft, note)
      ? { source: "realcomply_draft", text: input.serverDraft, generatedAt: input.now, evidence: null }
      : null);

  if (!input.ticked) {
    if (pending) return { error: TICK_FIRST };
    // The agent's own typing saves unticked on an open card (Reopen). Marking
    // the card done needs the tick, unless it already covers this text. An
    // empty box is left to the completion rule, which asks for the reasoning.
    if (input.status === "done" && note && !covered) return { error: TICK_FIRST };
    return { data: { ...carried, note } };
  }
  if (!note) {
    return { error: "The reasoning box is empty. Write your reasoning, then tick the box under it." };
  }

  // Where the words came from. A tick on text that started as a draft or a
  // document, and was saved and edited since, keeps that origin and its
  // original beside the final text.
  const origin: Pick<ReasoningAdoptionRecord, "source" | "originalText" | "draftGeneratedAt" | "evidence"> = pending
    ? pending.source === "realcomply_draft"
      ? { source: "realcomply_draft", originalText: pending.text, draftGeneratedAt: pending.generatedAt, evidence: pending.evidence }
      : { source: "document", originalText: pending.text }
    : previous && previous.source !== "typed" && typeof previous.originalText === "string"
      ? {
          source: previous.source,
          originalText: previous.originalText,
          ...(previous.source === "realcomply_draft"
            ? { draftGeneratedAt: previous.draftGeneratedAt, evidence: previous.evidence ?? null }
            : {}),
        }
      : { source: "typed" };

  const record: ReasoningAdoptionRecord = {
    ...origin,
    confirmedText: note,
    ...(origin.originalText !== undefined ? { changed: editedInWording(origin.originalText, note) } : {}),
    statement: OWN_OPINION,
    confirmedBy: input.user.id,
    confirmedByName: input.user.name,
    confirmedAt: input.now,
  };
  return { data: { ...carried, note, reasoningAdoption: record } };
}

/**
 * The record in words, for the card: who ticked it, when, and where the words
 * came from. Records from before 14 Oct 2026 keep their original wording.
 */
export function adoptionSummary(record: ReasoningAdoptionRecord): string {
  const who = record.confirmedByName ?? "the agent";
  const when = new Date(record.confirmedAt);
  const date = when.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Sydney" });
  if (!record.statement) {
    const whose = record.confirmedByName ? `${record.confirmedByName}'s` : "the agent's";
    return `Confirmed as ${whose} reasoning on ${date}${record.source === "document" ? ", from the uploaded document." : ", edited from RealComply's draft."}`;
  }
  const time = when
    .toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Australia/Sydney" })
    .replace(/\s/g, " ")
    .toLowerCase();
  const from =
    record.source === "realcomply_draft"
      ? record.changed
        ? "Started from RealComply's draft and changed."
        : "RealComply's draft, used as written."
      : record.source === "document"
        ? record.changed
          ? "Read from the uploaded document and changed."
          : "Read from the uploaded document, used as written."
        : "Written on this card.";
  return `Ticked as ${who}'s own opinion on ${date} at ${time}. ${from}`;
}

/** What a4c keeps across saves. Every other save replaces data wholesale. */
function carryForward(previous: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (previous?.reasoningAdoption) out.reasoningAdoption = previous.reasoningAdoption;
  if (previous?.noneOnMarket) out.noneOnMarket = previous.noneOnMarket;
  return out;
}

/** Read what the card posts alongside the note. */
export function pendingFromForm(formData: FormData): PendingReasoning | null {
  const source = String(formData.get("reasoningSource") ?? "");
  const text = String(formData.get("reasoningOriginal") ?? "");
  if (!text.trim()) return null;
  if (source === "document") return { source: "document", text };
  if (source !== "realcomply_draft") return null;
  const evidence = String(formData.get("reasoningDraftEvidence") ?? "");
  return {
    source: "realcomply_draft",
    text,
    generatedAt: String(formData.get("reasoningDraftGeneratedAt") ?? "") || new Date().toISOString(),
    evidence: (["supports", "mostly_above", "mostly_below", "too_few"] as const).find((v) => v === evidence) ?? null,
  };
}

// ── Where the "Draft my reasoning" offer appears ────────────────────────
//
// NEVER OVER THE AGENT'S OWN TEXT. Saved reasoning means no offer at all.
// Reasoning read from their uploaded document (step 3) goes in the box first,
// and the draft is offered beside it as a second option they can choose. Text
// they have typed into the box suppresses the offer until the box is empty.

export type DraftOffer = "in_box" | "second_option" | "none";

export function draftOffer(args: {
  savedNote: string;
  documentNote: string;
  boxText: string;
  isDone: boolean;
  recordedElsewhere: boolean;
  reportRead: boolean;
}): DraftOffer {
  if (args.isDone || args.recordedElsewhere || !args.reportRead) return "none";
  if (args.savedNote.trim()) return "none";
  const box = args.boxText.replace(/\s+/g, " ").trim();
  if (!box) return "in_box";
  if (args.documentNote.trim() && box === args.documentNote.replace(/\s+/g, " ").trim()) return "second_option";
  return "none";
}
