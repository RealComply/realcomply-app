"use client";

import { useActionState } from "react";
import { keepCurrentPlan, type PlanChangeState } from "@/lib/actions/plan-change";

// Takes off a change booked for the next billing date (Adam, 6 Nov 2026).

const initial: PlanChangeState = { error: null };

export function KeepPlanButton({ planName }: { planName: string }) {
  const [state, action, pending] = useActionState(keepCurrentPlan, initial);
  return (
    <form action={action} className="mt-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-rc-border bg-white px-4 py-2 text-sm font-semibold text-rc-ink transition hover:border-rc-green-deep disabled:opacity-60"
      >
        {pending ? "Working…" : `Keep ${planName}`}
      </button>
      {state.error && (
        <p role="alert" className="mt-2 text-sm font-medium text-rc-red">
          {state.error}
        </p>
      )}
    </form>
  );
}
