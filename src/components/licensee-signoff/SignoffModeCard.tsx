"use client";

import { useActionState, useState } from "react";
import { setSignoffMode, type PackActionState } from "@/lib/actions/licensee-signoff";
import { MODE_FOOTNOTE, MODE_OPTIONS, MONTHLY_NEEDS_LOGIN, type SignoffMode } from "@/lib/licensee-signoff/model";

// "How your licensee signs off" (Adam, 3 Nov 2026; the approved mockup, view
// 5). The licensee in charge and the office manager. It changes reminders
// only: the Licensee sign-off page and the pack work either way. A monthly
// pack is signed in the app, so "Monthly pack" can't be chosen while the
// licensee in charge isn't on RealComply (Master, 4 Nov 2026); the database
// refuses it too (0109).
export function SignoffModeCard({
  mode,
  setBy,
  licenseeHasLogin,
}: {
  mode: SignoffMode;
  setBy: string | null;
  licenseeHasLogin: boolean;
}) {
  const [state, action, pending] = useActionState<PackActionState, FormData>(setSignoffMode, { error: null });
  const [chosen, setChosen] = useState<SignoffMode>(mode);
  const unavailable = (value: SignoffMode) => value === "monthly" && !licenseeHasLogin && mode !== "monthly";
  return (
    <form action={action} className="space-y-3 rounded-card border border-rc-border bg-white p-4 shadow-card">
      <h3 className="text-base font-bold text-rc-ink">How your licensee signs off</h3>
      <div className="space-y-2" role="radiogroup">
        {MODE_OPTIONS.map((o) => (
          <label
            key={o.value}
            className={`grid grid-cols-[20px_1fr] gap-2.5 rounded-xl border px-3.5 py-3 ${
              unavailable(o.value) ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            } ${chosen === o.value ? "border-rc-green-deep bg-rc-green-soft" : "border-rc-border bg-rc-bg-alt"}`}
          >
            <input
              type="radio"
              name="mode"
              value={o.value}
              checked={chosen === o.value}
              disabled={unavailable(o.value)}
              onChange={() => setChosen(o.value)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-bold text-rc-ink">{o.label}</span>
              <span className="block text-sm text-rc-muted">{o.line}</span>
              {o.value === "monthly" && !licenseeHasLogin && (
                <span className="mt-1 block text-sm font-semibold text-rc-amber-deep">{MONTHLY_NEEDS_LOGIN}</span>
              )}
            </span>
          </label>
        ))}
      </div>
      <p className="text-sm text-rc-muted">{MODE_FOOTNOTE}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || chosen === mode}
          className="inline-flex min-h-10 items-center rounded-lg bg-rc-green-deep px-4 text-sm font-semibold text-white disabled:opacity-45"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {state.done && <span className="text-sm text-rc-green-deep">{state.done}</span>}
        {state.error && (
          <span role="alert" className="text-sm text-rc-amber-deep">
            {state.error}
          </span>
        )}
        {setBy && !state.done && <span className="text-xs text-rc-muted">{setBy}</span>}
      </div>
    </form>
  );
}
