import type { EvidenceVerdict } from "@/lib/data/esp-draft";

// Adopting RealComply's draft as the agent's ESP reasoning (a4c).
//
// s72A makes the estimate the agent's opinion, so the reasoning on the file
// has to be theirs too. A draft written by the software only becomes that by
// an act of the agent: they read it, change what they want, and confirm in
// one click — "This is my reasoning for the estimated selling price." Until
// then nothing saves as their reasoning, and the card stays incomplete.
//
// WHAT IS KEPT (data.reasoningDraft on the a4c row):
//   text                    the draft exactly as RealComply wrote it
//   generatedAt             when it was written
//   evidence                how the sales sat against the estimate at the time
//   confirmedText           what the agent confirmed (also saved as data.note)
//   editedBeforeConfirming  whether those two differ
//   confirmedBy / confirmedByName / confirmedAt
//
// Not aiDraft, although that was the suggested home. On this card aiDraft is
// already what the document READ produced (step 3: reasoning found in the
// agent's own uploaded document), and ItemCard treats it as exactly that. A
// second meaning for the same field would make the two impossible to tell
// apart later, which is the one thing this record exists to do.

export type ReasoningDraftRecord = {
  text: string;
  generatedAt: string;
  evidence: EvidenceVerdict | null;
  confirmedText: string;
  editedBeforeConfirming: boolean;
  confirmedBy: string;
  confirmedByName: string | null;
  confirmedAt: string;
};

/** The agent's confirmation that nothing comparable was on the market at the agreement date. */
export type NoneOnMarketRecord = { confirmedBy: string; confirmedAt: string };

export const ADOPT_LABEL = "This is my reasoning for the estimated selling price.";
export const DRAFT_LABEL = "Draft written by RealComply from your report. Read it and change anything that isn't what you think.";

export type DraftInForm = { text: string; generatedAt: string; evidence: EvidenceVerdict | null };

export type A4cSaveInput = {
  note: string;
  /** Present when the box was filled from a RealComply draft in this edit. */
  draft: DraftInForm | null;
  /** The agent pressed the adopt button. */
  confirmed: boolean;
  previous: Record<string, unknown> | null;
  user: { id: string; name: string | null };
  now: string;
};

export function a4cSave(input: A4cSaveInput): { error: string } | { data: Record<string, unknown> } {
  const carried = carryForward(input.previous);

  if (input.draft) {
    if (!input.confirmed) {
      return {
        error: `This is still RealComply's draft. Read it, change anything that isn't what you think, then press “${ADOPT_LABEL}” Nothing is saved as your reasoning until you do.`,
      };
    }
    if (!input.note.trim()) {
      return { error: "The reasoning box is empty. Write your reasoning, or draft it again, before confirming." };
    }
    const record: ReasoningDraftRecord = {
      text: input.draft.text,
      generatedAt: input.draft.generatedAt,
      evidence: input.draft.evidence,
      confirmedText: input.note,
      editedBeforeConfirming: normalise(input.note) !== normalise(input.draft.text),
      confirmedBy: input.user.id,
      confirmedByName: input.user.name,
      confirmedAt: input.now,
    };
    return { data: { ...carried, note: input.note, reasoningDraft: record } };
  }

  // The agent's own words (typed, or kept from their uploaded document).
  // An earlier adoption record stays with the item: it is the history of how
  // the reasoning on file came to be, whatever was edited since.
  return { data: { ...carried, note: input.note } };
}

/** What a4c keeps across saves. Every other save replaces data wholesale. */
function carryForward(previous: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (previous?.reasoningDraft) out.reasoningDraft = previous.reasoningDraft;
  if (previous?.noneOnMarket) out.noneOnMarket = previous.noneOnMarket;
  return out;
}

function normalise(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Read the draft fields the card posts alongside the note. */
export function draftFromForm(formData: FormData): DraftInForm | null {
  const text = String(formData.get("reasoningDraft") ?? "");
  if (!text.trim()) return null;
  const evidence = String(formData.get("reasoningDraftEvidence") ?? "");
  return {
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
  const box = normalise(args.boxText);
  if (!box) return "in_box";
  if (args.documentNote.trim() && box === normalise(args.documentNote)) return "second_option";
  return "none";
}
