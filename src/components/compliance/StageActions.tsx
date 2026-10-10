"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, FlaskConical } from "lucide-react";
import { completeStage, toggleTestMode, type ActionState } from "@/lib/actions/compliance";
import { extractFromDocuments } from "@/lib/actions/extraction";
import { STAGE_LABELS, type PropertyStage } from "@/lib/types";

const initialState: ActionState = { error: null };

export function CompleteStageButton({
  propertyId,
  stage,
  stageInUrl = false,
}: {
  propertyId: string;
  stage: PropertyStage;
  /** The page was opened from a stage tab (?stage=N), not on its own stage. */
  stageInUrl?: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await completeStage(propertyId, prev, formData);
    // Opened from a stage tab, the page kept showing the stage just completed
    // (preview check, 10 Oct 2026): ?stage still pointed at it, so this button
    // went and nothing scrolled, and Continue looked as if it had done
    // nothing. Back to the listing's own address, which opens on the new
    // current stage; the navigation also takes the page to the top.
    if (!result.error && stageInUrl) router.replace(`/dashboard/${propertyId}`);
    return result;
  }, initialState);

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

  // NAMED AFTER WHERE IT GOES, not after a stage number.
  //
  // Adam, 22 Aug 2026, finishing listing set-up: "there is no button at the
  // bottom of the page to continue to pre-market stage." The button was
  // there. It said "Complete stage 1 & continue", which is the one place in
  // the app that numbers a stage — everything else, including the stage strip
  // directly above this and the item cards themselves, uses the name. Looking
  // for "Pre-market" and finding "stage 1" is close enough to not finding
  // anything at all.
  //
  // Falls back to the old wording past the last named stage, which cannot
  // happen while the caller guards on stage < 5, but costs nothing.
  const next = STAGE_LABELS[(stage + 1) as PropertyStage];
  const label = next ? `Continue to ${next}` : `Complete stage ${stage + 1} & continue`;

  return (
    <form action={formAction} className="mt-6 border-t border-rc-border pt-6">
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
      >
        {pending ? "Checking…" : label}
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
