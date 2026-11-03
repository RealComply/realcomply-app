"use client";

import { useActionState } from "react";
import { sendPackToLicensee, type PackActionState } from "@/lib/actions/licensee-signoff";

// "Send to licensee" (Adam, 3 Nov 2026). Once sent, the pack is fixed. The
// licensee preparing it themselves (no office manager) starts signing instead.
export function SendPack({ month, label, disabled }: { month: string; label: string; disabled: boolean }) {
  const [state, action, pending] = useActionState<PackActionState, FormData>(sendPackToLicensee, { error: null });
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="month" value={month} />
      <button
        type="submit"
        disabled={disabled || pending}
        className="inline-flex min-h-10 items-center rounded-lg bg-rc-green-deep px-4 text-sm font-semibold text-white disabled:opacity-45"
      >
        {pending ? "Sending…" : label}
      </button>
      {state.error && (
        <p role="alert" className="text-xs text-rc-amber-deep">
          {state.error}
        </p>
      )}
      {state.done && <p className="text-xs text-rc-green-deep">{state.done}</p>}
    </form>
  );
}
