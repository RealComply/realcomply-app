"use client";

import { useActionState, useEffect, useRef } from "react";
import { Sparkles, FlaskConical } from "lucide-react";
import { completeStage, toggleTestMode, type ActionState } from "@/lib/actions/compliance";
import { extractFromDocuments } from "@/lib/actions/extraction";
import type { PropertyStage } from "@/lib/types";

const initialState: ActionState = { error: null };

export function CompleteStageButton({
  propertyId,
  stage,
}: {
  propertyId: string;
  stage: PropertyStage;
}) {
  const boundAction = completeStage.bind(null, propertyId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  // Go back to the top when the stage actually changes.
  //
  // Adam, 20 Aug 2026: "when you do that, it goes to the next stage, but it
  // remains at the bottom of the checklist." completeStage revalidates rather
  // than redirecting, so the page swaps its contents underneath an unchanged
  // scroll position — you press the button and appear to land at the end of a
  // list you have not seen the start of.
  //
  // Detected by watching pending fall from true to false, because success
  // carries no marker of its own: ActionState is {error} and a successful run
  // returns the same shape the form started with. Guarded on state.error so a
  // refusal ("complete these first: ...") leaves you looking at the message,
  // which renders directly under this button — scrolling away from an error
  // to the top of an unchanged page would be worse than not scrolling at all.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    }
    wasPending.current = pending;
  }, [pending, state.error]);

  return (
    <form action={formAction} className="mt-6 border-t border-rc-border pt-6">
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
      >
        {pending ? "Checking…" : `Complete stage ${stage + 1} & continue`}
      </button>
      {state.error && <p className="mt-2 text-sm text-rc-amber-deep">{state.error}</p>}
    </form>
  );
}

export function ExtractDocumentsButton({ propertyId }: { propertyId: string }) {
  const boundAction = extractFromDocuments.bind(null, propertyId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="mt-4">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-full border border-rc-green-deep/40 bg-white px-3 py-1.5 text-xs font-semibold text-rc-green-deep transition hover:bg-rc-green-soft disabled:opacity-60"
      >
        <Sparkles size={13} />
        {pending ? "Reading documents…" : "Extract from uploaded documents"}
      </button>
      {state.error && <p className="mt-2 text-xs text-rc-amber-deep">{state.error}</p>}
    </form>
  );
}

export function TestModeToggle({ propertyId, testMode }: { propertyId: string; testMode: boolean }) {
  const action = toggleTestMode.bind(null, propertyId);
  return (
    <form action={action}>
      <button
        type="submit"
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
          testMode
            ? "bg-rc-amber/20 text-rc-amber-deep"
            : "border border-rc-border bg-white text-rc-muted hover:bg-rc-bg-alt"
        }`}
      >
        {testMode && <FlaskConical size={12} />}
        {testMode ? "Test mode: ON" : "Test mode: off"}
      </button>
    </form>
  );
}
