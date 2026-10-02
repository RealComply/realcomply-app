"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, FileText, Info, Sparkles, X } from "lucide-react";
import { reasoningNudge, type Comparable } from "@/lib/data/comparables";
import { draftEspReasoning, type EspDraft, type EspDraftInput } from "@/lib/data/esp-draft";
import {
  ADOPT_LABEL,
  DISCLAIMER,
  EDIT_FIRST,
  draftOffer,
  editedInWording,
  type ReasoningAdoptionRecord,
} from "@/lib/rules/esp-reasoning-adoption";

// The ESP reasoning card's helper: "Draft my reasoning", and adopting text the
// agent did not type here.
//
// RealComply's draft is written into the box only when the agent asks, the
// disclaimer sits directly above it while it is there (ItemCard renders it
// over the box, because that is where the draft is), and it becomes their
// reasoning only after they have changed its wording AND pressed ADOPT_LABEL.
// Reasoning read from their own document needs the click but not the edit.
// The server enforces both — see lib/rules/esp-reasoning-adoption.ts. What the
// draft says, and the limits on it, are in lib/data/esp-draft.ts.
//
// NEVER OVER THE AGENT'S OWN TEXT. Saved reasoning: no offer. Reasoning read
// from their document: stays in the box, the draft is a second option beside
// it. Anything they have typed: no offer until the box is empty.
//
// Writing into the box uses the same mechanism as EspPrompts and the dictate
// button: set the textarea's value, dispatch an input event, move the caret.

type Chosen = EspDraft & { generatedAt: string };

export function ReasoningAssist({
  noteId,
  draftInput,
  comparables,
  savedReasoning,
  documentReasoning,
  reportRead,
  adoption,
  isDone,
  onDraftInBox,
}: {
  noteId: string;
  draftInput: EspDraftInput;
  comparables: Comparable[];
  /** What is already recorded on this item. */
  savedReasoning: string;
  /** Reasoning read from the agent's own uploaded document (step 3). */
  documentReasoning: string;
  /** The comparable-sales report has been read. */
  reportRead: boolean;
  /** How the reasoning on file was adopted, once confirmed. */
  adoption: ReasoningAdoptionRecord | null;
  /** Once the agent has marked the card done, this is a record, not a draft. */
  isDone: boolean;
  /** Tells the card a draft is in the box, so it can put the disclaimer above it. */
  onDraftInBox: (inBox: boolean) => void;
}) {
  const [boxText, setBoxText] = useState("");
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [preview, setPreview] = useState<EspDraft | null>(null);
  // Set once the agent empties a box that held their document's reasoning:
  // whatever they type next is typed here, not read from the document.
  const [documentSetAside, setDocumentSetAside] = useState(false);
  const adoptRef = useRef<HTMLInputElement>(null);

  // Follow the box. Uncontrolled textarea, so listen rather than own its value.
  // Emptying it abandons a draft for good: what is typed next is the agent's.
  useEffect(() => {
    const el = document.getElementById(noteId) as HTMLTextAreaElement | null;
    if (!el) return;
    const sync = () => {
      setBoxText(el.value);
      if (!el.value.trim()) {
        setChosen(null);
        setDocumentSetAside(true);
        onDraftInBox(false);
      }
    };
    sync();
    el.addEventListener("input", sync);
    return () => el.removeEventListener("input", sync);
  }, [noteId, onDraftInBox]);

  const active = chosen && boxText.trim() ? chosen : null;
  const fromDocument =
    !active &&
    !isDone &&
    !savedReasoning.trim() &&
    Boolean(documentReasoning.trim()) &&
    !documentSetAside &&
    Boolean(boxText.trim());

  const offer = active
    ? "none"
    : draftOffer({
        savedNote: savedReasoning,
        documentNote: documentReasoning,
        boxText,
        isDone,
        recordedElsewhere: false,
        reportRead,
      });
  const nudge = active || fromDocument ? null : reasoningNudge(savedReasoning, comparables);
  // Worked out up front, so "the agency agreement is needed first" sits where
  // the button would be rather than appearing only after a click.
  const result = offer === "none" ? null : draftEspReasoning(draftInput);
  const ready = result?.kind === "draft" ? result : null;
  const unavailable = result?.kind === "unavailable" ? result.message : null;
  const edited = active ? editedInWording(active.text, boxText) : false;

  function writeInto(text: string) {
    const el = document.getElementById(noteId) as HTMLTextAreaElement | null;
    if (!el) return;
    el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
    el.selectionStart = el.selectionEnd = 0;
    el.scrollTop = 0;
  }

  function applyDraft(d: EspDraft) {
    writeInto(d.text);
    setChosen({ ...d, generatedAt: new Date().toISOString() });
    setPreview(null);
    onDraftInBox(true);
  }

  function leaveDraft() {
    const backToDocument = Boolean(documentReasoning.trim()) && !savedReasoning.trim();
    writeInto(backToDocument ? documentReasoning : "");
    setChosen(null);
    if (backToDocument) setDocumentSetAside(false);
    onDraftInBox(false);
  }

  // Only this click confirms. The form reads the value as it submits, then it
  // is cleared, so a later plain "Mark done" after a failed save cannot count.
  function confirmClick() {
    const el = adoptRef.current;
    if (!el) return;
    el.value = "yes";
    setTimeout(() => {
      el.value = "";
    }, 0);
  }

  const source = active ? "realcomply_draft" : fromDocument ? "document" : "";
  const original = active ? active.text : fromDocument ? documentReasoning : "";

  return (
    <div className="mt-2 space-y-2">
      {/* Posted with the form so the server can tell RealComply's words, and
          words read from a document, from what the agent typed here. */}
      <input type="hidden" name="reasoningSource" value={source} />
      <input type="hidden" name="reasoningOriginal" value={original} />
      <input type="hidden" name="reasoningDraftGeneratedAt" value={active?.generatedAt ?? ""} />
      <input type="hidden" name="reasoningDraftEvidence" value={active?.evidence ?? ""} />
      <input ref={adoptRef} type="hidden" name="adoptDraft" value="" />

      {active && (
        <div className="space-y-2">
          {active.warning && <EvidenceWarning text={active.warning} />}
          <div className="flex flex-wrap items-center gap-2">
            <ConfirmButton disabled={!edited} onClick={confirmClick} />
            <button
              type="button"
              onClick={leaveDraft}
              className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-[11px] font-semibold text-rc-muted transition hover:border-rc-ink/20 hover:text-rc-ink"
            >
              <X size={11} aria-hidden="true" />
              {documentReasoning.trim() && !savedReasoning.trim()
                ? "Back to the reasoning from your document"
                : "Discard the draft"}
            </button>
          </div>
          {/* Why the button is unavailable, said in words rather than left to a greyed control. */}
          {!edited && <p className="text-[11px] font-medium text-rc-amber-deep">{EDIT_FIRST}</p>}
        </div>
      )}

      {/* The agent's own document: their words, so no edit is required, but
          they still confirm them as their reasoning in one click. */}
      {fromDocument && (
        <div className="space-y-2">
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-rc-muted">
            <FileText size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              The box above holds the reasoning read from your uploaded document. Check it, change it if you want,
              and confirm it as yours.
            </span>
          </p>
          <ConfirmButton disabled={false} onClick={confirmClick} />
        </div>
      )}

      {offer === "in_box" && ready && (
        <button
          type="button"
          onClick={() => applyDraft(ready)}
          className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-ink transition hover:border-rc-ink/20"
        >
          <Sparkles size={12} aria-hidden="true" />
          Draft my reasoning
        </button>
      )}

      {/* The draft as a second option beside the document's reasoning. */}
      {offer === "second_option" && ready && !preview && (
        <button
          type="button"
          onClick={() => setPreview(ready)}
          className="text-[11px] font-semibold text-rc-ink underline decoration-rc-border underline-offset-2 hover:decoration-rc-ink"
        >
          Or see a draft written by RealComply
        </button>
      )}
      {offer === "second_option" && preview && (
        <DraftPreview draft={preview}>
            <button
              type="button"
              onClick={() => applyDraft(preview)}
              className="rounded-full border border-rc-border bg-white px-3 py-1.5 text-[11px] font-semibold text-rc-ink transition hover:border-rc-ink/20"
            >
              Use this draft instead
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-rc-muted transition hover:text-rc-ink"
            >
              Keep the reasoning from my document
            </button>
        </DraftPreview>
      )}

      {unavailable && (
        <p className="flex items-start gap-1.5 rounded-lg border border-rc-border bg-rc-bg-alt px-3 py-2 text-[11px] leading-relaxed text-rc-ink">
          <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{unavailable}</span>
        </p>
      )}

      {adoption && !active && !fromDocument && (
        <p className="text-[11px] text-rc-muted">
          Confirmed as {adoption.confirmedByName ? `${adoption.confirmedByName}'s` : "the agent's"} reasoning on{" "}
          {new Date(adoption.confirmedAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}
          {adoption.source === "document" ? ", from the uploaded document." : ", edited from RealComply's draft."}
        </p>
      )}

      {/* A note, never a block. */}
      {nudge && (
        <p className="flex items-start gap-1.5 rounded-lg border border-rc-amber/40 bg-rc-amber/10 px-3 py-2 text-[11px] leading-relaxed text-rc-ink">
          <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{nudge}</span>
        </p>
      )}
    </div>
  );
}

/**
 * A draft shown outside the box (the second option beside the document's
 * reasoning): the disclaimer directly above it, then the draft, then the note
 * to the agent if the evidence needs one.
 */
export function DraftPreview({ draft, children }: { draft: EspDraft; children?: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-rc-border bg-rc-bg-alt px-3 py-2">
      <Disclaimer />
      <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-rc-ink">{draft.text}</p>
      {draft.warning && <EvidenceWarning text={draft.warning} />}
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

/** Exactly as worded, on screen only, directly above every draft. Never part of the draft text. */
export function Disclaimer() {
  return (
    <p
      role="note"
      className="flex items-start gap-1.5 rounded-md border border-rc-amber/60 bg-rc-amber/10 px-2.5 py-1.5 text-[11px] font-semibold leading-relaxed text-rc-ink"
    >
      <Sparkles size={12} className="mt-0.5 shrink-0 text-rc-amber-deep" aria-hidden="true" />
      <span>{DISCLAIMER}</span>
    </p>
  );
}

function ConfirmButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="submit"
      name="status"
      value="done"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? EDIT_FIRST : undefined}
      className="inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Check size={12} aria-hidden="true" />
      {ADOPT_LABEL}
    </button>
  );
}

/** (b) Addressed to the agent whenever the sales don't support the estimate. */
function EvidenceWarning({ text }: { text: string }) {
  return (
    <p
      role="note"
      className="flex items-start gap-1.5 rounded-lg border border-rc-amber/60 bg-rc-amber/15 px-3 py-2 text-[11px] leading-relaxed text-rc-ink"
    >
      <AlertTriangle size={12} className="mt-0.5 shrink-0 text-rc-amber-deep" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}
