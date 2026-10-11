"use client";

import { useActionState } from "react";
import { askStaffToSign, type ActionState } from "@/lib/actions/signoffs";

const initialState: ActionState = { error: null };

// The licensee's one button for staff who were never asked to sign the
// current SG Manual version (10 Oct 2026) — see askStaffToSign. Gives each of
// them an unsigned row, so it shows on their SG Manual page and Sign-offs.
export function AskToSignButton({ documentId }: { documentId: string }) {
  const boundAction = askStaffToSign.bind(null, documentId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="mt-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-50"
      >
        {pending ? "Asking…" : "Ask them to sign"}
      </button>
      {state.error && <p className="mt-1.5 text-xs text-rc-amber-deep">{state.error}</p>}
    </form>
  );
}
