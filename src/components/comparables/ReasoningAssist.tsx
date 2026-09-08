"use client";

import { useState } from "react";
import { Info, RotateCcw, Eraser } from "lucide-react";
import {
  buildReasoningDraft,
  reasoningNudge,
  type Comparable,
  type EspFigures,
  type SubjectAttributes,
} from "@/lib/data/comparables";

// The ESP reasoning card's helper.
//
// The draft itself is NOT written by this component — it arrives as the
// textarea's default value from ItemCard, so the box has the draft in it on
// first paint rather than after a click. Adam, 7 Sep 2026: "can we add some
// text in the ESP reasoning recorded card, just as a draft that the agent can
// either accept or edit?"
//
// What lives here is what belongs immediately under the box: the two buttons
// that rewrite it, one line saying where its contents came from, and the
// nudge.
//
// SLIMMED 8 Sep 2026. This component used to own three panels as well — the
// file-specific prompts, the generic factors, and a paragraph explaining the
// draft's provenance. Adam: "the whole thing is a bit busy and hard to follow.
// You have to jump up and down through the whole ESP reasoning section." The
// prompts moved into the single drawer in EspPrompts, and the paragraph became
// one line with the full text behind a disclosure. Nothing was deleted; the
// same words are one click away.
//
// THE LINE, restated because this is the component most likely to be misread
// as the software writing the reasoning. Every clause in the draft is a figure
// off the report, arithmetic against the listing, or something the agent
// pressed or typed. It states no price of its own — the only estimate in it is
// the one already recorded in the agency agreement — and it never says the
// estimate is reasonable. That sentence is the agent's.
//
// The insert mechanism is identical to EspPrompts and the dictate button: set
// the textarea's value, dispatch an input event, move the caret. One mechanism
// for "something outside the textarea wrote into it" rather than three.

export function ReasoningAssist({
  noteId,
  subject,
  comparables,
  esp,
  savedReasoning,
  isDone,
}: {
  noteId: string;
  subject: SubjectAttributes;
  comparables: Comparable[];
  esp: EspFigures;
  /** What is already recorded on this item. Drives the nudge, not the draft. */
  savedReasoning: string;
  /** Once the agent has marked the card done, this is a record, not a draft. */
  isDone: boolean;
}) {
  const [whyOpen, setWhyOpen] = useState(false);
  const draft = buildReasoningDraft(subject, comparables, esp);
  const nudge = reasoningNudge(savedReasoning, comparables);
  const marked = comparables.filter((c) => c.weighting !== null).length;

  function writeInto(text: string, mode: "heading" | "replace") {
    const el = document.getElementById(noteId) as HTMLTextAreaElement | null;
    if (!el) return;
    if (mode === "replace") {
      el.value = text;
    } else {
      const existing = el.value.trimEnd();
      el.value = existing.length > 0 ? `${existing}\n\n${text}: ` : `${text}: `;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
    el.selectionStart = el.selectionEnd = el.value.length;
  }

  return (
    <div className="mt-2 space-y-2">
      {/* Directly under the box these buttons rewrite, rather than in a panel
          of their own further down. Adam had to scroll past the sales to find
          them, which is the wrong way round for a control that acts on the
          thing immediately above it. */}
      {draft && !isDone && (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => writeInto(draft, "replace")}
              className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-[11px] font-semibold text-rc-muted transition hover:border-rc-ink/20 hover:text-rc-ink"
            >
              <RotateCcw size={11} aria-hidden="true" />
              Rebuild from my marks
            </button>
            <button
              type="button"
              onClick={() => writeInto("", "replace")}
              className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-[11px] font-semibold text-rc-muted transition hover:border-rc-ink/20 hover:text-rc-ink"
            >
              <Eraser size={11} aria-hidden="true" />
              Clear and write my own
            </button>
          </div>

          {/* ONE LINE ON THE FACE, the rest behind the icon — but the half
              that carries the legal weight is the half that stays visible.
              "The conclusion is yours" is the sentence the agency's position
              rests on if s74 ever asks who formed this opinion, so it is not
              the part that gets folded away. What folds is the explanation of
              how the draft was assembled, which matters once and then never
              again. */}
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-rc-muted">
            <span>
              Built from your marks on the {marked === 1 ? "sale" : "sales"} above.{" "}
              <span className="font-semibold text-rc-ink">The conclusion is yours to add.</span>
            </span>
            <button
              type="button"
              onClick={() => setWhyOpen((v) => !v)}
              aria-expanded={whyOpen}
              aria-label={whyOpen ? "Hide where this draft came from" : "Where did this draft come from?"}
              className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition ${
                whyOpen
                  ? "bg-rc-green-soft text-rc-green-deep"
                  : "text-rc-faint hover:bg-rc-bg-alt hover:text-rc-muted"
              }`}
            >
              <Info size={12} aria-hidden="true" />
            </button>
          </p>

          {whyOpen && (
            <p className="mt-1.5 rounded-lg border border-rc-green-deep/25 bg-rc-green-soft/50 px-3 py-2 text-[11px] leading-relaxed text-rc-muted">
              Every line is a figure off the report, arithmetic against your listing, or something you
              pressed or typed on the {marked === 1 ? "sale" : "sales"} above. It doesn&rsquo;t put a price
              of its own on this property and doesn&rsquo;t say the estimate is reasonable.
            </p>
          )}
        </div>
      )}

      {/* A note, never a block. Forty files carrying the same two lines is
          worse evidence than one honest paragraph, and the person best placed
          to judge whether this file needs more is the one who wrote it. */}
      {nudge && (
        <p className="flex items-start gap-1.5 rounded-lg border border-rc-amber/40 bg-rc-amber/10 px-3 py-2 text-[11px] leading-relaxed text-rc-ink">
          <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{nudge}</span>
        </p>
      )}
    </div>
  );
}
