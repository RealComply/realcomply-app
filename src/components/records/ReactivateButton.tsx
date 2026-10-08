"use client";

import { useActionState } from "react";
import { reactivateSubscription, type ReactivateState } from "@/lib/actions/reactivate";

export function ReactivateButton() {
  const [state, action, pending] = useActionState<ReactivateState, FormData>(reactivateSubscription, { error: null });
  return (
    <form action={action}>
      <button type="submit" disabled={pending} className="rec-btn">
        {pending ? "Opening Stripe…" : "Reactivate subscription"}
      </button>
      {state.error ? (
        <p role="alert" className="rec-error">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
