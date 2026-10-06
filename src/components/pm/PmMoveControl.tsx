"use client";

import { useActionState, useState } from "react";
import { movePmProperty } from "@/lib/actions/pm";
import type { ActionState } from "@/lib/actions/auth";
import type { PmMove } from "@/lib/rules/nsw-pm";

// The one move button on a PM property (brief A9): Put up for lease, Tenant has
// moved in, Tenant is vacating, Tenant has moved out. Disabled until the
// stages it depends on are complete, with one short line saying what is
// needed. The server checks the same thing again before it moves anything.

const initial: ActionState = { error: null };

/** Today in Sydney, as YYYY-MM-DD, for the date box's starting value. */
function todayInSydney(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
}

export function PmMoveControl({
  propertyId,
  move,
  blockedLine,
}: {
  propertyId: string;
  move: PmMove;
  blockedLine: string;
}) {
  const [asking, setAsking] = useState(false);
  const [state, formAction, pending] = useActionState(movePmProperty.bind(null, propertyId), initial);

  // Close the question once the move has gone through; the page redraws in
  // the new group with its own button.
  // Adjusted during render rather than in an effect.
  const [lastPending, setLastPending] = useState(pending);
  if (lastPending !== pending) {
    setLastPending(pending);
    if (!pending && !state.error) setAsking(false);
  }

  const blocked = blockedLine.length > 0;

  if (!asking) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          disabled={blocked}
          onClick={() => setAsking(true)}
          className="rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {move.label} →
        </button>
        {blocked && <span className="text-[13px] text-rc-muted">{blockedLine}</span>}
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-rc-border bg-white px-4 py-3 shadow-card">
      <input type="hidden" name="from" value={move.from} />
      <span className="text-sm font-semibold text-rc-ink">{move.label}</span>
      {move.date && (
        <label className="flex items-center gap-2 text-[13px] text-rc-muted">
          {move.date.label}
          <input
            type="date"
            name="date"
            required
            defaultValue={todayInSydney()}
            className="rounded-lg border border-rc-border px-2 py-1 text-[13px] text-rc-ink focus:border-rc-green-deep focus:outline-none"
          />
        </label>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-rc-green-deep px-4 py-1.5 text-[13px] font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Confirm"}
      </button>
      <button
        type="button"
        onClick={() => setAsking(false)}
        className="rounded-full border border-rc-green-deep px-4 py-1.5 text-[13px] font-semibold text-rc-green-deep transition hover:bg-rc-green-soft"
      >
        Cancel
      </button>
      {state.error && (
        <p role="alert" className="basis-full text-xs font-medium text-rc-red">
          {state.error}
        </p>
      )}
    </form>
  );
}
