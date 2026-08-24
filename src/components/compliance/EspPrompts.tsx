"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ESP_PROMPT_GROUPS, ESP_PROMPT_COUNT } from "@/lib/rules/esp-prompts";

// "Worth considering" on the ESP reasoning card.
//
// Collapsed by default, because the card's job is a box to write in and a wall
// of thirty-four prompts above it would bury that. Opening costs one click and
// records nothing either way.
//
// CLICKING A PROMPT INSERTS IT AS A HEADING, never an answer. That distinction
// is the whole design: the product may help an agent structure their reasoning,
// and must never put words in their mouth on the one item a regulator is most
// likely to ask them to substantiate (s74).
//
// The insert reuses exactly what dictation already does to this textarea — set
// value, dispatch input, move the caret to the end — so there is one mechanism
// for "something outside the textarea added text to it" rather than two.
export function EspPrompts({ noteId }: { noteId: string }) {
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

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-rc-border bg-rc-bg-alt">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-rc-green-deep transition hover:bg-rc-green-soft/40"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Worth considering
        <span className="ml-auto text-[11px] font-normal text-rc-faint">
          {ESP_PROMPT_COUNT} prompts, nothing recorded
        </span>
      </button>

      {open && (
        <div className="border-t border-rc-border bg-white px-3 py-3">
          <p className="mb-3 text-[11px] leading-relaxed text-rc-muted">
            None of these are required by the Act. They&rsquo;re the factors REINSW suggests, kept as prompts so
            you can pick what actually moved your estimate. Click one to drop it into your reasoning as a
            heading.
          </p>

          {ESP_PROMPT_GROUPS.map((group) => (
            <div key={group.heading} className="mb-3 last:mb-0">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-rc-faint">
                {group.heading}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {group.prompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => insert(prompt)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition ${
                      group.primary
                        ? "border-rc-green-deep bg-rc-green-soft font-semibold text-rc-green-deep hover:bg-rc-green-soft/70"
                        : "border-rc-border bg-white text-rc-muted hover:border-rc-green-deep hover:text-rc-green-deep"
                    }`}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
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
