"use client";

import { useActionState } from "react";
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
        className="rounded-md bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
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
        className="rounded-md border border-rc-green-deep/40 px-3 py-1.5 text-xs font-semibold text-rc-green-deep transition hover:bg-rc-green/10 disabled:opacity-60"
      >
        {pending ? "Reading documents…" : "🤖 Extract from uploaded documents"}
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
        className={`rounded-full px-3 py-1 text-xs font-medium transition ${
          testMode
            ? "bg-rc-amber/20 text-rc-amber-deep"
            : "border border-rc-border text-neutral-500 hover:bg-neutral-50"
        }`}
      >
        {testMode ? "🔓 Test mode: ON" : "Test mode: off"}
      </button>
    </form>
  );
}
