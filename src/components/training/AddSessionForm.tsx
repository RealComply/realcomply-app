"use client";

import { useActionState, useState } from "react";
import { addTrainingSession, type ActionState } from "@/lib/actions/registers";

const initialState: ActionState = { error: null };

export function AddSessionForm() {
  const [state, formAction, pending] = useActionState(addTrainingSession, initialState);
  const [cpdEligible, setCpdEligible] = useState(false);

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-dashed border-rc-border p-4">
      <h3 className="text-sm font-semibold text-rc-ink">Log a training session</h3>
      <input
        type="text"
        name="title"
        placeholder="Session title (e.g. 'Underquoting refresher')"
        required
        className="w-full rounded-md border border-rc-border px-2 py-1.5 text-sm"
      />
      <div className="flex flex-wrap gap-3">
        <div>
          <label className="block text-xs text-neutral-500">Date</label>
          <input type="date" name="sessionDate" required className="mt-1 rounded-md border border-rc-border px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Trainer</label>
          <input
            type="text"
            name="trainerName"
            placeholder="Name"
            className="mt-1 rounded-md border border-rc-border px-2 py-1 text-sm"
          />
        </div>
        <label className="mt-5 flex items-center gap-1.5 text-xs text-neutral-600">
          <input type="checkbox" name="isExternal" />
          External trainer
        </label>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-neutral-600">
        <input type="checkbox" name="isCpdEligible" checked={cpdEligible} onChange={(e) => setCpdEligible(e.target.checked)} />
        Counts toward CPD hours
      </label>
      {cpdEligible && (
        <div>
          <label className="block text-xs text-neutral-500">CPD hours per attendee</label>
          <input
            type="number"
            step="0.5"
            min="0"
            name="cpdHours"
            className="mt-1 w-24 rounded-md border border-rc-border px-2 py-1 text-sm"
          />
        </div>
      )}
      <textarea
        name="notes"
        placeholder="Notes (optional)"
        rows={2}
        className="w-full rounded-md border border-rc-border px-2 py-1.5 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        Save session
      </button>
      {state.error && <p className="text-xs text-rc-amber-deep">{state.error}</p>}
    </form>
  );
}
