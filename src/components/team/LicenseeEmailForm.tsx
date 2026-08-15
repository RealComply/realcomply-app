"use client";

import { useActionState } from "react";
import { saveLicenseeEmail } from "@/lib/actions/team";

// Agency-level licensee email, editable after setup.
//
// The signup form asks for this, but only for agencies created after 15 Aug
// 2026 — every existing agency has the column empty, and the sign-off link
// button refuses to issue anything without it. This is where they fill it in,
// and where anyone changes it when the licensee in charge changes.
//
// Licensee-only. It decides where a sign-off request lands, so an agent being
// able to edit it would be a straightforward way to route their own file's
// sign-off to an address they control.

const initial = { error: null as string | null, saved: false };

export function LicenseeEmailForm({ current }: { current: string | null }) {
  const [state, action, pending] = useActionState(saveLicenseeEmail, initial);

  return (
    <form action={action} className="mt-2 rounded-card border border-rc-border bg-white p-4 shadow-card">
      <label htmlFor="licenseeEmail" className="block text-sm font-medium text-rc-ink">
        Licensee in charge email
      </label>
      <p className="mt-1 text-xs leading-relaxed text-rc-muted">
        Where sign-off requests are addressed. Used when you create a sign-off link for a listing.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          id="licenseeEmail"
          name="licenseeEmail"
          type="email"
          defaultValue={current ?? ""}
          placeholder="licensee@youragency.com.au"
          className="min-w-0 flex-1 rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {state.error && (
        <p className="mt-2 text-sm text-rc-amber-deep" role="alert">
          {state.error}
        </p>
      )}
      {state.saved && !state.error && (
        <p className="mt-2 text-sm font-medium text-rc-green-deep" role="status">
          Saved.
        </p>
      )}
    </form>
  );
}
