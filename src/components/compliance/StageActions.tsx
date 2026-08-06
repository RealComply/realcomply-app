"use client";

import { useActionState } from "react";
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
