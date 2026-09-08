"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ESP_PROMPT_GROUPS, ESP_PROMPT_COUNT } from "@/lib/rules/esp-prompts";
import { ESP_GENERIC_FACTORS } from "@/lib/rules/esp-generic-factors";

// Every prompt on the ESP reasoning card, in one drawer.
//
// WHY ONE. Adam, 8 Sep 2026: "the whole thing is a bit busy and hard to
// follow. You have to jump up and down through the whole ESP reasoning
// section." He was looking at three separate prompt panels — this one, "About
// this file", and "Not about any one sale" — stacked between the writing box
// and the sales, each with its own heading and its own paragraph explaining
// that nothing is recorded. Three boxes saying near-identical things is how a
// card gets busy without anyone adding a feature.
//
// They are still three distinct lists and that distinction is real: one is
// computed from THIS file, one is things that belong to no single sale, one is
// the REINSW list. So they stay as three headed groups — inside one drawer,
// closed until wanted. An agent who knows what they want to write never opens
// it; an agent who is stuck gets everything in one place.
//
// COLLAPSED BY DEFAULT, unchanged and for the original reason: the card's job
// is a box to write in, and a wall of prompts above it buries that.
//
// CLICKING A PROMPT INSERTS IT AS A HEADING, never an answer. That distinction
// is the whole design: the product may help an agent structure their reasoning,
// and must never put words in their mouth on the one item a regulator is most
// likely to ask them to substantiate (s74).
//
// The insert mechanism is identical to the dictate button and ReasoningAssist:
// set the textarea's value, dispatch an input event, move the caret. One
// mechanism for "something outside the textarea wrote into it", not three.

export function EspPrompts({
  noteId,
  fileSpecific = [],
}: {
  noteId: string;
  /**
   * Prompts computed from this listing's own sales. First in the drawer,
   * because a prompt drawn from the file in front of the agent is worth more
   * than any number of generic ones — and unlike the other two groups, it is
   * empty until there are sales to compute it from.
   */
  fileSpecific?: string[];
}) {
  const [open, setOpen] = useState(false);

  function insert(prompt: string) {
    const el = document.getElementById(noteId) as HTMLTextAreaElement | null;
    if (!el) return;
    const existing = el.value.trimEnd();
    el.value = existing.length > 0 ? `${existing}\n\n${prompt}: ` : `${prompt}: `;
    // Tell React the uncontrolled field changed, same as the dictate button.
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
    el.selectionStart = el.selectionEnd = el.value.length;
  }

  const total = ESP_PROMPT_COUNT + ESP_GENERIC_FACTORS.length + fileSpecific.length;

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-rc-border bg-rc-bg-alt">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-rc-green-deep transition hover:bg-rc-green-soft/40"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Need a prompt?
        <span className="ml-auto text-[11px] font-normal text-rc-faint">
          {total} prompts, nothing recorded
        </span>
      </button>

      {open && (
        <div className="border-t border-rc-border bg-white px-3 py-3">
          <p className="mb-3 text-[11px] leading-relaxed text-rc-muted">
            None of these are required by the Act. Click one to drop it into your reasoning as a heading —
            nothing is recorded either way.
          </p>

          {fileSpecific.length > 0 && (
            <PromptGroup
              heading="About this file"
              prompts={fileSpecific}
              onPick={insert}
              // Highlighted, because these came from the agent's own sales
              // rather than a list every listing shares.
              primary
            />
          )}

          <PromptGroup heading="Not about any one sale" prompts={ESP_GENERIC_FACTORS} onPick={insert} />

          {ESP_PROMPT_GROUPS.map((group) => (
            <PromptGroup
              key={group.heading}
              heading={group.heading}
              prompts={group.prompts}
              onPick={insert}
              primary={group.primary}
            />
          ))}

          {/* The one part of the REINSW list that IS law, and it already has a
              card. Pointing rather than repeating. */}
          <p className="mt-3 rounded-lg border border-rc-border bg-rc-bg-alt px-3 py-2 text-[11px] leading-relaxed text-rc-muted">
            <span className="font-semibold text-rc-ink">Material facts aren&rsquo;t in this list on purpose.</span>{" "}
            They&rsquo;re the one part of the REINSW checklist the Act actually requires, and you record them on
            &ldquo;Material facts identified&rdquo;. Asking twice would just be double entry.
          </p>
        </div>
      )}
    </div>
  );
}

function PromptGroup({
  heading,
  prompts,
  onPick,
  primary = false,
}: {
  heading: string;
  prompts: readonly string[];
  onPick: (prompt: string) => void;
  primary?: boolean;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-rc-faint">{heading}</p>
      <div className="flex flex-wrap gap-1.5">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPick(prompt)}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${
              primary
                ? "border-rc-green-deep bg-rc-green-soft font-semibold text-rc-green-deep hover:bg-rc-green-soft/70"
                : "border-rc-border bg-white text-rc-muted hover:border-rc-green-deep hover:text-rc-green-deep"
            }`}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
