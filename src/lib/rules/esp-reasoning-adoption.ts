import type { EvidenceVerdict } from "@/lib/data/esp-draft";

// Adopting reasoning the agent did not type on this card (a4c).
//
// s72A makes the estimate the agent's opinion, so the reasoning on the file
// has to be theirs too. Two kinds of text arrive in the box without the agent
// typing them here, and neither saves as their reasoning until they confirm it
// with one click — ADOPT_LABEL:
//
//   1. RealComply's draft ("Draft my reasoning"). EDIT FIRST, THEN CONFIRM:
//      the agent cannot confirm it unchanged. Confirm stays unavailable until
//      the text differs from the draft in its wording — spacing, punctuation
//      and capital letters alone do not count (sameWording below). Enforced
//      here, on the server, as well as on the page.
//   2. Reasoning read from the agent's own uploaded document (step 3). Those
//      are their own words, so the edit-first rule does not apply, but the
//      one-click confirmation still does.
//
// The card cannot complete before that confirmation: an unconfirmed (or, for
// a draft, unedited) save is refused whatever button sent it.
//
// WHAT IS KEPT (data.reasoningAdoption on the a4c row):
//   source            "realcomply_draft" or "document"
//   originalText      the draft exactly as RealComply wrote it, or the text
//                     read from the document
//   confirmedText     what the agent confirmed (also saved as data.note)
//   confirmedBy / confirmedByName / confirmedAt
//   draftGeneratedAt / evidence   draft only: when it was written, and how the
//                     sales sat against the estimate at the time
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
export const ADOPT_LABEL = "This is my reasoning for the estimated selling price.";
export const EDIT_FIRST = "Edit the draft to make it yours before you confirm.";

export type AdoptionSource = "realcomply_draft" | "document";

export type ReasoningAdoptionRecord = {
  source: AdoptionSource;
  originalText: string;
  confirmedText: string;
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

/** True when the agent has changed the draft's wording, not only its spacing, punctuation or capitals. */
export function editedInWording(draft: string, text: string): boolean {
  return wordingOf(draft) !== wordingOf(text);
}

/** Removes the on-screen disclaimer from text about to be saved, if it was pasted in. */
export function withoutDisclaimer(text: string): string {
  return text.split(DISCLAIMER).join("").replace(/\n{3,}/g, "\n\n").trim();
}

export type A4cSaveInput = {
  note: string;
  pending: PendingReasoning | null;
  /** The agent pressed ADOPT_LABEL. */
  confirmed: boolean;
  previous: Record<string, unknown> | null;
  user: { id: string; name: string | null };
  now: string;
};

export function a4cSave(input: A4cSaveInput): { error: string } | { data: Record<string, unknown> } {
  const carried = carryForward(input.previous);
  const note = withoutDisclaimer(input.note);
  const pending = input.pending;

  if (!pending) {
    // The agent's own typing. An earlier adoption record stays with the item:
    // it is the history of how the reasoning on file came to be.
    return { data: { ...carried, note } };
  }

  if (pending.source === "realcomply_draft" && !editedInWording(pending.text, note)) {
    return { error: EDIT_FIRST };
  }
  if (!input.confirmed) {
    return {
      error:
        pending.source === "realcomply_draft"
          ? `This is still RealComply's draft. Press “${ADOPT_LABEL}” to save it as yours. Nothing is saved as your reasoning until you do.`
          : `This reasoning was read from your document. Press “${ADOPT_LABEL}” to save it as yours. Nothing is saved as your reasoning until you do.`,
    };
  }
  if (!note) {
    return { error: "The reasoning box is empty. Write your reasoning before confirming." };
  }

  const record: ReasoningAdoptionRecord = {
    source: pending.source,
    originalText: pending.text,
    confirmedText: note,
    confirmedBy: input.user.id,
    confirmedByName: input.user.name,
    confirmedAt: input.now,
    ...(pending.source === "realcomply_draft"
      ? { draftGeneratedAt: pending.generatedAt, evidence: pending.evidence }
      : {}),
  };
  return { data: { ...carried, note, reasoningAdoption: record } };
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
