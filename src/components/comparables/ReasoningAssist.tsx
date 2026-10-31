"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, FileText, Info, Sparkles, X } from "lucide-react";
import { reasoningNudge, type Comparable } from "@/lib/data/comparables";
import { draftEspReasoning, type EspDraft, type EspDraftInput } from "@/lib/data/esp-draft";
import {
  DISCLAIMER,
  OWN_OPINION,
  adoptionSummary,
  draftOffer,
  tickCovers,
  type ReasoningAdoptionRecord,
} from "@/lib/rules/esp-reasoning-adoption";

// The ESP reasoning card's helper, directly under the box: "Draft my
// reasoning", and the tick that makes the reasoning the agent's own.
//
// RealComply's draft is written into the box only when the agent asks, and
// the disclaimer sits directly above it while it is there (ItemCard renders it
// over the box, because that is where the draft is). Whatever is in the box,
// drafted, read from their document or typed, the agent ticks OWN_OPINION
// before the card can be marked done: ItemCard keeps Mark done unavailable
// until they do, and the server refuses it too. Since 14 Oct 2026 nothing
// forces them to edit a draft first (the reversal is recorded in
// lib/rules/esp-reasoning-adoption.ts). What the draft says, and the limits
// on it, are in lib/data/esp-draft.ts.
//
// NEVER OVER THE AGENT'S OWN WORDS WITHOUT ASKING (REVERSAL, 31 Oct 2026,
// recorded at draftOffer in lib/rules/esp-reasoning-adoption.ts). The button
// is there whenever a draft can be written. Into an empty box it goes straight
// in; over anything of theirs (typed, read from their document, or saved) only
// after "Replace your text with a new draft?" and Yes, and discarding that
// draft puts their words back. The example in the empty box is a placeholder,
// so it never counts as theirs.
//
// Writing into the box uses the same mechanism as EspPrompts and the dictate
// button: set the textarea's value, dispatch an input event, move the caret.

type Chosen = EspDraft & { generatedAt: string };

export function ReasoningAssist({
  noteId,
  initialText,
  draftInput,
  comparables,
  savedReasoning,
  documentReasoning,
  reportRead,
  adoption,
  isDone,
  onDraftInBox,
  onTickMissing,
}: {
  noteId: string;
  /** What the box opens with, so the first paint already knows whether a tick is needed. */
  initialText: string;
  /** Null when the listing's details are not to hand: no draft is offered, the tick still is. */
  draftInput: EspDraftInput | null;
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
  /** Tells the card the tick is still needed, so it can hold Mark done and say why. */
  onTickMissing: (missing: boolean) => void;
}) {
  const [boxText, setBoxText] = useState(initialText);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  // "Replace your text with a new draft?" is showing.
  const [asking, setAsking] = useState(false);
  // The agent's own words a draft replaced, so discarding it puts them back.
  const [replaced, setReplaced] = useState("");
  // Set once the agent empties a box that held their document's reasoning:
  // whatever they type next is typed here, not read from the document.
  const [documentSetAside, setDocumentSetAside] = useState(false);
  // Which saved tick the box was ticked against. A new record (a save) makes
  // it stale, so the box comes back unticked for the next change, and putting
  // a draft into the box unticks it, so a draft is never confirmed unread.
  const [tickedAgainst, setTickedAgainst] = useState<string | null>(null);
  const tickKey = adoption?.confirmedAt ?? "";
  // A save that records a tick ends any draft in hand: what is in the box is
  // now the reasoning on file, so the draft's controls go with it. (The card
  // folds rather than unmounts, so this state would otherwise outlive it.)
  const [recordSeen, setRecordSeen] = useState(tickKey);
  if (recordSeen !== tickKey) {
    setRecordSeen(tickKey);
    setChosen(null);
    setAsking(false);
    setReplaced("");
  }

  // Follow the box. Uncontrolled textarea, so listen rather than own its value.
  // Emptying it abandons a draft for good: what is typed next is the agent's.
  useEffect(() => {
    const el = document.getElementById(noteId) as HTMLTextAreaElement | null;
    if (!el) return;
    const sync = () => {
      setBoxText(el.value);
      if (!el.value.trim()) {
        setChosen(null);
        setAsking(false);
        setReplaced("");
        setDocumentSetAside(true);
      }
    };
    sync();
    el.addEventListener("input", sync);
    return () => el.removeEventListener("input", sync);
  }, [noteId]);

  const active = chosen && boxText.trim() ? chosen : null;
  // The card puts the disclaimer above the box whenever a draft is in it.
  const draftShown = Boolean(active);
  useEffect(() => {
    onDraftInBox(draftShown);
  }, [draftShown, onDraftInBox]);
  const fromDocument =
    !active &&
    !isDone &&
    !savedReasoning.trim() &&
    Boolean(documentReasoning.trim()) &&
    !documentSetAside &&
    Boolean(boxText.trim());

  const offer = draftOffer({ boxText, draftInBox: active?.text ?? null, isDone, reportRead });
  const nudge = active || fromDocument ? null : reasoningNudge(savedReasoning, comparables);
  // Worked out up front, so "the agency agreement is needed first" sits where
  // the button would be rather than appearing only after a click.
  const result = offer === "none" || !draftInput ? null : draftEspReasoning(draftInput);
  const ready = result?.kind === "draft" ? result : null;
  // Said where it always was: under an empty box, or the document's reasoning.
  const unavailable =
    result?.kind === "unavailable" && (offer === "in_box" || fromDocument) ? result.message : null;
  // Back to the reasoning from their document, as before 31 Oct, unless the
  // draft replaced words of their own.
  const toDocument = Boolean(documentReasoning.trim()) && !savedReasoning.trim();
  const backToTheirs = Boolean(replaced.trim()) && replaced !== documentReasoning;

  // The tick. Not needed while the box holds exactly what the last tick
  // covered (the server applies the same test: tickCovers).
  const covered = !active && !fromDocument && tickCovers(adoption, boxText);
  const ticked = tickedAgainst === tickKey;
  const tickMissing = !covered && !ticked;
  useEffect(() => {
    onTickMissing(tickMissing);
  }, [tickMissing, onTickMissing]);

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
    // Their words, kept for "Back to your text". A redraft over RealComply's
    // own unchanged draft keeps what that draft first replaced.
    if (offer === "ask_first") setReplaced(boxText);
    else if (!active) setReplaced("");
    writeInto(d.text);
    setChosen({ ...d, generatedAt: new Date().toISOString() });
    setAsking(false);
    setTickedAgainst(null);
  }

  function pressDraft(d: EspDraft) {
    if (offer === "ask_first") setAsking(true);
    else applyDraft(d);
  }

  function leaveDraft() {
    const back = backToTheirs ? replaced : toDocument ? documentReasoning : "";
    writeInto(back);
    setChosen(null);
    setReplaced("");
    setTickedAgainst(null);
    if (toDocument && back === documentReasoning) setDocumentSetAside(false);
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

      {active && (
        <div className="space-y-2">
          {active.warning && <EvidenceWarning text={active.warning} />}
          <button
            type="button"
            onClick={leaveDraft}
            className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-[11px] font-semibold text-rc-muted transition hover:border-rc-ink/20 hover:text-rc-ink"
          >
            <X size={11} aria-hidden="true" />
            {backToTheirs
              ? "Back to your text"
              : toDocument
                ? "Back to the reasoning from your document"
                : "Discard the draft"}
          </button>
        </div>
      )}

      {/* The agent's own document: their words, confirmed with the same tick. */}
      {fromDocument && (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-rc-muted">
          <FileText size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            The box above holds the reasoning read from your uploaded document. Check it and change anything you
            need to.
          </span>
        </p>
      )}

      {ready && (
        <button
          type="button"
          onClick={() => pressDraft(ready)}
          className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-ink transition hover:border-rc-ink/20"
        >
          <Sparkles size={12} aria-hidden="true" />
          Draft my reasoning
        </button>
      )}

      {/* Asked once, only over the agent's own words. Cancel leaves them exactly as they are. */}
      {asking && offer === "ask_first" && ready && (
        <div role="alertdialog" className="rounded-lg border border-rc-border bg-neutral-50 px-3 py-2 text-sm">
          <p className="text-rc-ink">Replace your text with a new draft?</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => applyDraft(ready)}
              className="rounded-full bg-rc-green-deep px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              className="rounded-full border border-rc-border px-4 py-1.5 text-xs font-medium text-rc-muted hover:bg-neutral-100"
            >
              Cancel
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

      {/* A note, never a block. */}
      {nudge && (
        <p className="flex items-start gap-1.5 rounded-lg border border-rc-amber/40 bg-rc-amber/10 px-3 py-2 text-[11px] leading-relaxed text-rc-ink">
          <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{nudge}</span>
        </p>
      )}

      {/* A confirmation from before 14 Oct 2026, made with the old button. */}
      {adoption && !adoption.statement && !active && !fromDocument && (
        <p className="text-[11px] text-rc-muted">{adoptionSummary(adoption)}</p>
      )}

      {covered && adoption ? (
        <p className="text-[11px] text-rc-muted">{adoptionSummary(adoption)}</p>
      ) : (
        <OwnOpinionTick
          checked={ticked}
          onChange={(on) => setTickedAgainst(on ? tickKey : null)}
        />
      )}
    </div>
  );
}

/** The one statement the agent makes about the reasoning, exactly as worded. */
export function OwnOpinionTick({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-rc-border bg-white px-3 py-2.5 text-xs leading-relaxed text-rc-ink">
      <input
        type="checkbox"
        name="ownOpinion"
        value="yes"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-rc-green-deep"
      />
      <span>{OWN_OPINION}</span>
    </label>
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
