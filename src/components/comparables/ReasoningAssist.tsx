"use client";

import { Info, RotateCcw, Eraser } from "lucide-react";
import { ESP_GENERIC_FACTORS } from "@/lib/rules/esp-generic-factors";
import {
  buildReasoningDraft,
  fileSpecificPrompts,
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
// What lives here is everything around that box: rebuilding the draft after
// the agent changes their marks, clearing it, the file-specific prompts, the
// generic factors, and the nudge.
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
  const draft = buildReasoningDraft(subject, comparables, esp);
  const prompts = fileSpecificPrompts(subject, comparables);
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
      {/* Where the draft came from, and where it stops. Shown while the card
          is still open, because that is when someone is deciding whether to
          accept what is in the box. */}
      {draft && !isDone && (
        <div className="rounded-lg border border-rc-green-deep/25 bg-rc-green-soft/50 px-3 py-2.5">
          <p className="text-[11px] font-semibold text-rc-green-deep">Where this draft came from</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-rc-muted">
            Every line is a figure off the report, arithmetic against your listing, or something you
            pressed or typed on the {marked === 1 ? "sale" : "sales"} above. It doesn&rsquo;t put a price of
            its own on this property and doesn&rsquo;t say the estimate is reasonable —{" "}
            <span className="font-semibold text-rc-ink">that part is yours to add.</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
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
        </div>
      )}

      {prompts.length > 0 && !isDone && (
        <div className="rounded-lg border border-rc-border bg-rc-bg-alt px-3 py-2.5">
          <p className="text-[11px] font-semibold text-rc-ink">About this file</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-rc-muted">
            Differences the sales actually show. Click one to drop it in as a heading — nothing is recorded
            either way.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {prompts.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => writeInto(p, "heading")}
                className="rounded-full border border-rc-border bg-white px-2.5 py-1 text-[11px] font-medium text-rc-muted transition hover:border-rc-green-deep/40 hover:text-rc-ink"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* The generic half of Adam's two-part idea: things that bear on the
          price but belong to no single sale, so they cannot sit on a row. */}
      {!isDone && (
        <div className="rounded-lg border border-rc-border bg-rc-bg-alt px-3 py-2.5">
          <p className="text-[11px] font-semibold text-rc-ink">Not about any one sale</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-rc-muted">
            Things that affect the price but don&rsquo;t belong on a single comparable. Tap any that
            mattered — nothing is recorded either way.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ESP_GENERIC_FACTORS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => writeInto(f, "heading")}
                className="rounded-full border border-rc-border bg-white px-2.5 py-1 text-[11px] font-medium text-rc-muted transition hover:border-rc-green-deep/40 hover:text-rc-ink"
              >
                {f}
              </button>
            ))}
          </div>
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
