"use client";

import { Info, Wand2 } from "lucide-react";
import {
  assembleReasoning,
  fileSpecificPrompts,
  reasoningNudge,
  type Comparable,
  type SubjectAttributes,
} from "@/lib/data/comparables";

// The ESP reasoning card's helper: turn what the agent already marked into a
// starting draft, and prompt them with the differences THIS file actually has.
//
// THE LINE, restated here because this is the component most likely to be
// misread as the software writing the reasoning:
//
//   Every clause this inserts came from the agent. They chose which sales they
//   relied on and which they rejected, and they wrote the note on each. All
//   this does is put those fragments in an order and join them up. The box
//   stays fully editable and nothing is saved until they save it.
//
// It must never add a fact, an adjective or a conclusion, and above all never a
// price. The estimate is the agent's own opinion under s72A; a sentence that
// reached it for them is the one thing this feature is not allowed to do.
//
// The insert mechanism is deliberately identical to EspPrompts and the dictate
// button — set the textarea's value, dispatch an input event, move the caret.
// One mechanism for "something outside the textarea wrote into it" rather than
// three.

export function ReasoningAssist({
  noteId,
  subject,
  comparables,
  savedReasoning,
}: {
  noteId: string;
  subject: SubjectAttributes;
  comparables: Comparable[];
  /** What is already recorded on this item. Drives the nudge, not the draft. */
  savedReasoning: string;
}) {
  const draft = assembleReasoning(comparables);
  const prompts = fileSpecificPrompts(subject, comparables);
  const nudge = reasoningNudge(savedReasoning, comparables);

  if (!draft && prompts.length === 0 && !nudge) return null;

  function writeInto(text: string, asHeading: boolean) {
    const el = document.getElementById(noteId) as HTMLTextAreaElement | null;
    if (!el) return;
    const existing = el.value.trimEnd();
    const addition = asHeading ? `${text}: ` : text;
    el.value = existing.length > 0 ? `${existing}\n\n${addition}` : addition;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
    el.selectionStart = el.selectionEnd = el.value.length;
  }

  return (
    <div className="mt-2 space-y-2">
      {draft && (
        <div className="rounded-lg border border-rc-green-deep/25 bg-rc-green-soft/40 px-3 py-2.5">
          <p className="text-[11px] font-semibold text-rc-green-deep">Start from the sales you marked</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-rc-muted">
            Your own words, put in order. Edit it into whatever actually reflects your thinking — it&rsquo;s
            a starting point, not a finished answer, and nothing is saved until you save it.
          </p>
          <button
            type="button"
            onClick={() => writeInto(draft, false)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600"
          >
            <Wand2 size={12} aria-hidden="true" />
            Use as a starting point
          </button>
        </div>
      )}

      {prompts.length > 0 && (
        <div className="rounded-lg border border-rc-border bg-rc-bg-alt px-3 py-2.5">
          <p className="text-[11px] font-semibold text-rc-ink">About this file</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-rc-muted">
            Differences the sales below actually show. Click one to drop it in as a heading — nothing is
            recorded either way.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {prompts.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => writeInto(p, true)}
                className="rounded-full border border-rc-border bg-white px-2.5 py-1 text-[11px] font-medium text-rc-muted transition hover:border-rc-green-deep/40 hover:text-rc-ink"
              >
                {p}
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
