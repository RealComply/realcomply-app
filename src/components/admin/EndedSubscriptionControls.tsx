"use client";

import { useActionState } from "react";
import {
  deleteAgencyNowForTesting,
  runDeletionDryRun,
  sendOwedEndedEmails,
  setLegalHold,
  type AdminActionState,
} from "@/lib/actions/subscription-end-admin";

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

export function SendOwedEmailsButton() {
  const [state, action, pending] = useActionState(sendOwedEndedEmails, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-xs">
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-rc-border px-3 py-1.5 font-semibold text-rc-ink hover:border-rc-green-deep"
      >
        {pending ? "Sending…" : "Send owed emails now"}
      </button>
      {state.error && <span className="text-rc-red">{state.error}</span>}
      {state.message && <span className="text-rc-muted">{state.message}</span>}
    </form>
  );
}

/** Preview deployments only; the staff page does not render it on the live site. */
export function DeleteNowForm({ agencyId, name }: { agencyId: string; name: string }) {
  const [state, action, pending] = useActionState(deleteAgencyNowForTesting, initial);
  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-rc-red/40 bg-rc-red-soft p-2 text-xs">
      <input type="hidden" name="agency_id" value={agencyId} />
      <span className="font-semibold text-rc-ink">Preview only. Delete now:</span>
      <input
        name="confirm_name"
        placeholder={`Type "${name}"`}
        className="min-w-0 flex-1 rounded-md border border-rc-border bg-white px-2 py-1 text-xs"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-rc-red px-3 py-1 font-semibold text-white"
      >
        {pending ? "Deleting…" : "Delete everything now"}
      </button>
      {state.error && <span className="text-rc-red">{state.error}</span>}
      {state.message && <span className="text-rc-ink">{state.message}</span>}
    </form>
  );
}
