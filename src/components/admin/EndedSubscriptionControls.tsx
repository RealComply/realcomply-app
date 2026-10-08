"use client";

import { useActionState } from "react";
import { runDeletionDryRun, setLegalHold, type AdminActionState } from "@/lib/actions/subscription-end-admin";

const initial: AdminActionState = { error: null };

export function LegalHoldForm({ agencyId, held, reason }: { agencyId: string; held: boolean; reason: string | null }) {
  const [state, action, pending] = useActionState(setLegalHold, initial);
  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <input type="hidden" name="agency_id" value={agencyId} />
      <input type="hidden" name="hold" value={held ? "off" : "on"} />
      {!held && (
        <input
          name="reason"
          placeholder="Reason for the hold"
          className="min-w-0 flex-1 rounded-md border border-rc-border px-2 py-1 text-xs"
        />
      )}
      {held && <span className="text-rc-amber-deep">On hold: {reason}</span>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-rc-border px-3 py-1 font-semibold text-rc-ink hover:border-rc-green-deep"
      >
        {held ? "Lift hold" : "Put on legal hold"}
      </button>
      {state.error && <span className="text-rc-red">{state.error}</span>}
      {state.message && <span className="text-rc-muted">{state.message}</span>}
    </form>
  );
}

export function DryRunButton() {
  const [state, action, pending] = useActionState(runDeletionDryRun, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-xs">
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-rc-green-deep px-3 py-1.5 font-semibold text-white hover:bg-rc-green-deep-600"
      >
        {pending ? "Running…" : "Dry run the deletion job now"}
      </button>
      {state.error && <span className="text-rc-red">{state.error}</span>}
      {state.message && <span className="text-rc-muted">{state.message}</span>}
    </form>
  );
}
