"use client";

import { useActionState, useState } from "react";
import { changePmManager } from "@/lib/actions/pm";
import type { ActionState } from "@/lib/actions/auth";

// "Change property manager" on one PM property, for the licensee (check, 10
// Oct 2026). A property handed to the licensee when its manager left stayed
// with them for good: nothing in the app could move it on. The same people as
// the "+ Add property" picker offers the licensee.
//
// The picker is left to the form (defaultValue), not held in state, so what
// it shows is what is sent, even after a refusal resets the form.

const initial: ActionState = { error: null };

export function PmManagerControl({
  propertyId,
  currentManagerId,
  people,
}: {
  propertyId: string;
  currentManagerId: string;
  people: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(changePmManager.bind(null, propertyId), initial);

  const [lastPending, setLastPending] = useState(pending);
  if (lastPending !== pending) {
    setLastPending(pending);
    if (!pending && !state.error) setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-1 text-[13px] font-semibold text-rc-green-deep hover:underline"
      >
        Change property manager
      </button>
    );
  }

  const currentListed = people.some((p) => p.id === currentManagerId);

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2 text-sm text-rc-muted">
      <label htmlFor="pm-change-manager">New property manager</label>
      <select
        id="pm-change-manager"
        name="managerId"
        defaultValue={currentListed ? currentManagerId : ""}
        required
        className="rounded-lg border border-rc-border bg-white px-2.5 py-1 text-sm text-rc-ink focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
      >
        {!currentListed && (
          <option value="" disabled>
            Choose…
          </option>
        )}
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-rc-green-deep px-3.5 py-1 text-[13px] font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-[13px] font-semibold text-rc-muted hover:text-rc-ink">
        Cancel
      </button>
      {state.error && (
        <span role="alert" className="basis-full text-xs font-medium text-rc-red">
          {state.error}
        </span>
      )}
    </form>
  );
}
