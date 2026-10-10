"use client";

import { useActionState, useState } from "react";
import { moveOutOutgoingTenant } from "@/lib/actions/pm";
import type { ActionState } from "@/lib/actions/auth";
import { todayInSydney } from "@/components/pm/pm-dates";

// "Tenant has moved out" for an outgoing tenancy (brief B2), with the date.
// The property stays where it is; only the old tenancy is updated.

const initial: ActionState = { error: null };

export function PmOutgoingMoveOut({ propertyId, tenancyId }: { propertyId: string; tenancyId: string }) {
  const [asking, setAsking] = useState(false);
  const [state, formAction, pending] = useActionState(moveOutOutgoingTenant.bind(null, propertyId, tenancyId), initial);

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="rounded-full bg-rc-green-deep px-3.5 py-1.5 text-[13px] font-semibold text-white transition hover:bg-rc-green-deep-600"
      >
        Tenant has moved out →
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-[13px] text-rc-muted">
        Move-out date
        <input
          type="date"
          name="date"
          required
          defaultValue={todayInSydney()}
          className="rounded-lg border border-rc-border px-2 py-1 text-[13px] text-rc-ink focus:border-rc-green-deep focus:outline-none"
        />
      </label>
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
