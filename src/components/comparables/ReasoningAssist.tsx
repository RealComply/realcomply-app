"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, FileText, Info, Sparkles, X } from "lucide-react";
import { reasoningNudge, type Comparable } from "@/lib/data/comparables";
import { draftEspReasoning, type EspDraft, type EspDraftInput } from "@/lib/data/esp-draft";
import {
  ADOPT_LABEL,
  DRAFT_LABEL,
  draftOffer,
  type ReasoningDraftRecord,
} from "@/lib/rules/esp-reasoning-adoption";

// The ESP reasoning card's helper: "Draft my reasoning", and adopting it.
//
// The draft is RealComply's until the agent says otherwise. It is written
// into the box only when they press the button, it is labelled as RealComply's
// while it is there, and it becomes their reasoning only when they press
// ADOPT_LABEL — the card cannot complete before that (the server refuses an
// unconfirmed draft; see lib/rules/esp-reasoning-adoption.ts). What it says,
// and the limits on what it may say, are in lib/data/esp-draft.ts.
//
// NEVER OVER THE AGENT'S OWN TEXT. Saved reasoning: no offer. Reasoning read
// from their uploaded document: that stays in the box, and the draft is a
// second option beside it. Anything they have typed: no offer until the box
// is empty again.
//
// Writing into the box uses the same mechanism as EspPrompts and the dictate
// button: set the textarea's value, dispatch an input event, move the caret.

export function ReasoningAssist({
  noteId,
  draftInput,
  comparables,
  savedReasoning,
  documentReasoning,
  reportRead,
  adoption,
  isDone,
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
  /** RealComply's draft and its adoption, once confirmed. */
  adoption: ReasoningDraftRecord | null;
  /** Once the agent has marked the card done, this is a record, not a draft. */
  isDone: boolean;
}) {
  const [boxText, setBoxText] = useState("");
  const [chosen, setChosen] = useState<(EspDraft & { generatedAt: string }) | null>(null);
  const [preview, setPreview] = useState<EspDraft | null>(null);
  const adoptRef = useRef<HTMLInputElement>(null);

  // Follow the box, so the offer knows whether it would be writing over
  // something. Uncontrolled textarea, so listen rather than own its value.
  useEffect(() => {
    const el = document.getElementById(noteId) as HTMLTextAreaElement | null;
    if (!el) return;
    // Emptying the box abandons the draft for good: what is typed next is
    // the agent's own, not an edit of RealComply's.
    const sync = () => {
      setBoxText(el.value);
      if (!el.value.trim()) setChosen(null);
    };
    sync();
    el.addEventListener("input", sync);
    return () => el.removeEventListener("input", sync);
  }, [noteId]);

  const active = chosen && boxText.trim() ? chosen : null;

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
  const nudge = active ? null : reasoningNudge(savedReasoning, comparables);
  // Worked out up front, so "the agency agreement is needed first" sits where
  // the button would be rather than appearing only after a click.
  const result = offer === "none" ? null : draftEspReasoning(draftInput);
  const ready = result?.kind === "draft" ? result : null;
  const unavailable = result?.kind === "unavailable" ? result.message : null;

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
  }

  return (
    <div className="mt-2 space-y-2">
      {/* Posted with the form. Empty unless a draft is in the box, so the
          server can tell RealComply's words from the agent's. */}
      <input type="hidden" name="reasoningDraft" value={active?.text ?? ""} />
      <input type="hidden" name="reasoningDraftGeneratedAt" value={active?.generatedAt ?? ""} />
      <input type="hidden" name="reasoningDraftEvidence" value={active?.evidence ?? ""} />
      <input ref={adoptRef} type="hidden" name="adoptDraft" value="" />

      {active && (
        <div className="space-y-2">
          <p className="flex items-start gap-1.5 text-[11px] font-semibold leading-relaxed text-rc-ink">
            <Sparkles size={12} className="mt-0.5 shrink-0 text-rc-amber-deep" aria-hidden="true" />
            <span>{DRAFT_LABEL}</span>
          </p>
          {active.warning && <EvidenceWarning text={active.warning} />}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              name="status"
              value="done"
              onClick={() => {
                // Only this click confirms. The form reads the value as it
                // submits, then it is cleared, so a later plain "Mark done"
                // after a failed save cannot count as confirmation.
                const el = adoptRef.current;
                if (!el) return;
                el.value = "yes";
                setTimeout(() => {
                  el.value = "";
                }, 0);
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600"
            >
              <Check size={12} aria-hidden="true" />
              {ADOPT_LABEL}
            </button>
            <button
              type="button"
              onClick={() => {
                writeInto(documentReasoning && !savedReasoning ? documentReasoning : "");
                setChosen(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-[11px] font-semibold text-rc-muted transition hover:border-rc-ink/20 hover:text-rc-ink"
            >
              <X size={11} aria-hidden="true" />
              {documentReasoning && !savedReasoning ? "Back to the reasoning from your document" : "Discard the draft"}
            </button>
          </div>
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

      {/* The document's reasoning is in the box; the draft is the second
          option, shown beside it rather than over it. */}
      {offer === "second_option" && ready && !preview && (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-rc-muted">
          <FileText size={12} aria-hidden="true" />
          <span>The box above holds the reasoning read from your uploaded document.</span>
          <button
            type="button"
            onClick={() => setPreview(ready)}
            className="font-semibold text-rc-ink underline decoration-rc-border underline-offset-2 hover:decoration-rc-ink"
          >
            Or see a draft written by RealComply
          </button>
        </p>
      )}
      {offer === "second_option" && preview && (
        <div className="space-y-2 rounded-lg border border-rc-border bg-rc-bg-alt px-3 py-2">
          <p className="text-[11px] font-semibold text-rc-ink">{DRAFT_LABEL}</p>
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-rc-ink">{preview.text}</p>
          {preview.warning && <EvidenceWarning text={preview.warning} />}
          <div className="flex flex-wrap gap-2">
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
          </div>
        </div>
      )}

      {unavailable && (
        <p className="flex items-start gap-1.5 rounded-lg border border-rc-border bg-rc-bg-alt px-3 py-2 text-[11px] leading-relaxed text-rc-ink">
          <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{unavailable}</span>
        </p>
      )}

      {adoption && !active && (
        <p className="text-[11px] text-rc-muted">
          Confirmed as {adoption.confirmedByName ? `${adoption.confirmedByName}'s` : "the agent's"} reasoning on{" "}
          {new Date(adoption.confirmedAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}
          {adoption.editedBeforeConfirming
            ? ", edited from RealComply's draft."
            : ", from RealComply's draft without changes."}
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
