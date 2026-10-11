"use client";

import { useActionState, useEffect, useState } from "react";
import type { SendBackState } from "@/lib/actions/send-back";
import type { ReviewCard } from "@/lib/data/send-backs";

// The licensee's "send back for changes" (Adam, 12 Oct 2026). The same form on
// the emailed sign-off page and on the listing's Licensee signature card: tick
// the cards that need changing, say what, and send the file back to the agent.
//
// Every card on the file is listed by stage, as the audit pack shows them, so
// the licensee can flag anything they read there.

const STAGE_NAMES = ["Listing set-up", "Pre-market", "On market", "Campaign", "Sold", "Settled"];

type Flag = { note: string; mayBeBreach: boolean };

export function SendBackForm({
  cards,
  action,
  agentName,
  onSent,
}: {
  cards: ReviewCard[];
  action: (prev: SendBackState, formData: FormData) => Promise<SendBackState>;
  /** "Sam", for the button and the confirmation. */
  agentName: string | null;
  /** Told once the file has gone back, so the page can take the signature box away. */
  onSent?: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null } as SendBackState);
  useEffect(() => {
    if (state.done) onSent?.();
  }, [state.done, onSent]);
  const [open, setOpen] = useState(false);
  const [flags, setFlags] = useState<Record<string, Flag>>({});
  // Said, not silently disabled (Adam, 12 Oct 2026: the button "isn't
  // working" — it was greyed out because a ticked card had no note yet).
  const [missing, setMissing] = useState<string | null>(null);
  const who = agentName?.trim() || "the agent";

  if (state.done) {
    return (
      <div role="status" className="mt-6 rounded-card border border-rc-amber-deep/30 bg-rc-amber/10 px-4 py-3 text-sm text-rc-ink">
        Sent back to {who}. They&rsquo;ve been emailed the cards and your notes. Once they&rsquo;ve made the changes
        and signed again, the file comes back to you for sign-off.
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 rounded-full border border-rc-border bg-white px-4 py-2 text-sm font-semibold text-rc-ink transition hover:border-rc-ink/30"
      >
        Something needs changing? Send it back
      </button>
    );
  }

  const chosen = Object.entries(flags);
  const payload = JSON.stringify(
    chosen.map(([key, f]) => ({ item_key: key, note: f.note, may_be_breach: f.mayBeBreach })),
  );
  const stages = [...new Set(cards.map((c) => c.stage))].sort((a, b) => a - b);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const blank = chosen.find(([, f]) => !f.note.trim());
        if (blank) {
          e.preventDefault();
          const label = cards.find((c) => c.key === blank[0])?.label ?? "a ticked card";
          setMissing(`Add a note to "${label}" saying what needs changing.`);
          document.getElementById(`note-${blank[0]}`)?.focus();
          return;
        }
        setMissing(null);
      }}
      className="mt-6 rounded-card border border-rc-border bg-white p-4"
    >
      <h2 className="text-base font-bold text-rc-ink">Send back for changes</h2>
      <p className="mt-1 text-sm text-rc-muted">
        Tick each card that needs changing and say what. {who} gets an email with your notes, fixes the cards and
        signs again before it comes back to you.
      </p>

      <div className="mt-4 space-y-4">
        {stages.map((stage) => (
          <fieldset key={stage}>
            <legend className="text-xs font-bold uppercase tracking-wide text-rc-faint">
              {STAGE_NAMES[stage] ?? `Stage ${stage}`}
            </legend>
            <ul className="mt-1.5 space-y-1.5">
              {cards
                .filter((c) => c.stage === stage)
                .map((c) => {
                  const f = flags[c.key];
                  return (
                    <li key={c.key} className="rounded-md border border-rc-border px-3 py-2">
                      <label className="flex cursor-pointer items-start gap-2 text-sm text-rc-ink">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={Boolean(f)}
                          onChange={(e) =>
                            setFlags((prev) => {
                              const next = { ...prev };
                              if (e.target.checked) next[c.key] = { note: "", mayBeBreach: false };
                              else delete next[c.key];
                              return next;
                            })
                          }
                        />
                        <span>{c.label}</span>
                      </label>
                      {f && (
                        <div className="mt-2 space-y-2 pl-6">
                          <label className="block text-xs font-medium text-rc-muted" htmlFor={`note-${c.key}`}>
                            What needs changing?
                          </label>
                          <textarea
                            id={`note-${c.key}`}
                            value={f.note}
                            maxLength={1000}
                            rows={2}
                            placeholder="For example: the agreement date doesn't match the signed copy"
                            onChange={(e) => {
                              setMissing(null);
                              setFlags((prev) => ({ ...prev, [c.key]: { ...f, note: e.target.value } }));
                            }}
                            className="w-full rounded-md border border-rc-border px-2.5 py-1.5 text-sm text-rc-ink"
                          />
                          <label className="flex items-center gap-2 text-xs text-rc-muted">
                            <input
                              type="checkbox"
                              checked={f.mayBeBreach}
                              onChange={(e) =>
                                setFlags((prev) => ({ ...prev, [c.key]: { ...f, mayBeBreach: e.target.checked } }))
                              }
                            />
                            This may be a breach
                          </label>
                        </div>
                      )}
                    </li>
                  );
                })}
            </ul>
          </fieldset>
        ))}
      </div>

      <input type="hidden" name="flags" value={payload} />
      {(missing ?? state.error) && (
        <p role="alert" className="mt-3 text-sm font-medium text-rc-amber-deep">
          {missing ?? state.error}
        </p>
      )}
      {chosen.length === 0 && <p className="mt-3 text-xs text-rc-muted">Tick at least one card to send the file back.</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending || chosen.length === 0}
          className="rounded-full bg-rc-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Sending…" : `Send back to ${who}`}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-rc-muted hover:text-rc-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}
