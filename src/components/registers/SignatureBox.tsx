"use client";

import { useActionState } from "react";
import { signDocument, type ActionState } from "@/lib/actions/signoffs";

const initialState: ActionState = { error: null };

// The same "type your name to adopt it" pattern as sign_agent/sign_licensee
// on a compliance file (see SignItem in ItemCard.tsx) — kept deliberately
// identical rather than introducing a second signature style. Typed name +
// an immutable server-side timestamp, no drawing, no external service; see
// the design note at the top of 0009_document_signoffs.sql for why that's
// enough for an internal document like this.
export function SignatureBox({ documentId }: { documentId: string }) {
  const boundAction = signDocument.bind(null, documentId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input
        type="text"
        name="typedName"
        placeholder="Type your full name"
        className="w-56 rounded-md border border-rc-border px-2 py-1.5 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
      >
        {pending ? "Signing…" : "Adopt as signature"}
      </button>
      {state.error && <p className="w-full text-xs text-rc-amber-deep">{state.error}</p>}
    </form>
  );
}
