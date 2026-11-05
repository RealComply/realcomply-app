"use client";

import { useActionState } from "react";
import { signByLink, type PackActionState } from "@/lib/actions/licensee-signoff";

// One item, signed through the licensee's emailed link (Adam, 3 Nov 2026):
// the same result as signing it in the app. They type their name, confirm
// they are the licensee in charge signing for themselves, and tick.
export function ItemSign({ token, tick, agencyName }: { token: string; tick: string; agencyName: string }) {
  const [state, action, pending] = useActionState<PackActionState, FormData>(signByLink.bind(null, token), { error: null });
  if (state.done) {
    return (
      <p role="status" className="rounded-card border border-rc-green-deep/30 bg-rc-green-soft px-4 py-3 text-sm font-semibold text-rc-ink">
        Signed. Thank you. You can close this page.
      </p>
    );
  }
  return (
    <form action={action} className="space-y-3 rounded-card border border-rc-border bg-white p-4 shadow-card">
      <label className="block text-sm font-semibold text-rc-ink" htmlFor="typedName">
        Your full name
      </label>
      <input id="typedName" name="typedName" required autoComplete="name" className="w-full max-w-sm rounded-lg border border-rc-border px-3 py-2 text-sm" />
      <label className="flex items-start gap-2 text-sm text-rc-ink">
        <input type="checkbox" name="confirmSelf" value="yes" required className="mt-0.5 h-4 w-4" />
        <span>I am the licensee in charge of {agencyName}, and I am signing for myself.</span>
      </label>
      <label className="flex items-start gap-2 text-sm font-semibold text-rc-ink">
        <input type="checkbox" name="reviewed" value="yes" required className="mt-0.5 h-4 w-4" />
        <span>{tick}</span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-10 items-center rounded-lg bg-rc-green-deep px-5 text-sm font-semibold text-white disabled:opacity-45"
      >
        {pending ? "Signing…" : "Sign"}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-rc-amber-deep">
          {state.error}
        </p>
      )}
    </form>
  );
}
