"use client";

import { useState } from "react";
import { possessive } from "@/lib/licence-name";

/**
 * "The name on this licence is Joanne Mary Bennett. Is this Jo Bennett's
 * licence?" with what was read underneath, not saved yet, and the two
 * answers. The mockup Adam approved, 15 Oct 2026. The same box for a CPD
 * certificate ("this certificate").
 */
export function NameQuestionBox({
  word,
  question,
  onAnswer,
}: {
  word: "licence" | "certificate";
  question: { nameOnDocument: string; personName: string; firstName: string; summary: string };
  /** Saves (yes) or removes the file (no). Returns a problem to show, or null when done. */
  onAnswer: (yes: boolean) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState<false | "yes" | "no">(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function answer(yes: boolean) {
    setBusy(yes ? "yes" : "no");
    setProblem(null);
    try {
      const p = await onAnswer(yes);
      if (p) setProblem(p);
    } catch {
      setProblem(`Couldn't save that answer. Reload the page and upload the ${word} again.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-[10px] border border-rc-amber/40 bg-rc-amber/10 px-3 py-2.5 text-[13px] text-rc-ink" role="alert">
      <p>
        The name on this {word} is <b>{question.nameOnDocument}</b>. Is this {possessive(question.personName)} {word}?
      </p>
      <p className="text-xs text-rc-muted">{question.summary} (read from the document, not saved yet)</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => answer(true)}
          disabled={Boolean(busy)}
          className="rounded-full bg-rc-green-deep px-3.5 py-1.5 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {busy === "yes" ? "Saving…" : `Yes, it’s ${possessive(question.firstName)}`}
        </button>
        <button
          type="button"
          onClick={() => answer(false)}
          disabled={Boolean(busy)}
          className="rounded-full border-2 border-rc-green-deep px-3 py-1 text-xs font-bold text-rc-green-deep transition hover:bg-rc-green-soft disabled:opacity-60"
        >
          {busy === "no" ? "Removing…" : "No, wrong person"}
        </button>
      </div>
      {problem && <p className="text-xs text-rc-amber-deep">{problem}</p>}
    </div>
  );
}
