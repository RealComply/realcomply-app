"use client";

import { useActionState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { updatePassword, type PasswordState } from "@/lib/actions/auth";

const initialState: PasswordState = { error: null, saved: false };

// One form, two arrivals: someone who followed a reset link and someone who
// came from the avatar menu to change a password they still know. Supabase's
// updateUser acts on the caller's own session either way, so there is no
// branch here and no second path to keep correct.
//
// No "current password" box. It would be the natural instinct, but it cannot
// be asked of the reset arrival — that person is here precisely because they
// do not have it — and asking it of only one of the two would mean two forms
// and two actions. The session is the proof in both cases: for the reset
// arrival it came from a link sent to their mailbox, and for the signed-in
// one it is the session they are already using.
export function ChangePasswordForm({ fromReset }: { fromReset: boolean }) {
  const [state, formAction, pending] = useActionState(updatePassword, initialState);

  if (state.saved) {
    return (
      <div className="rounded-card border border-rc-border bg-white p-6 shadow-card">
        <p className="flex items-center gap-2 text-sm font-semibold text-rc-green-deep">
          <CheckCircle2 size={17} aria-hidden="true" /> Password updated
        </p>
        <p className="mt-2 text-sm text-rc-muted">
          Use the new one next time you sign in. You&rsquo;re still signed in here.
        </p>
        <Link
          href="/dashboard/home"
          className="mt-5 inline-flex rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600"
        >
          Go to Home
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="rounded-card border border-rc-border bg-white p-6 shadow-card">
      {fromReset && (
        <p className="mb-4 rounded-2xl border border-rc-border bg-rc-bg-alt px-3 py-2 text-sm text-rc-ink">
          You&rsquo;re signed in from the link in your email. Set a password now so you can get back
          in on your own next time.
        </p>
      )}

      {state.error && (
        <p className="mb-4 rounded-2xl border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2 text-sm text-rc-amber-deep">
          {state.error}
        </p>
      )}

      <div className="space-y-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-rc-ink">
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="mt-1 w-full max-w-xs rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
          />
          <p className="mt-1 text-xs text-rc-muted">At least 8 characters.</p>
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-rc-ink">
            Type it again
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="mt-1 w-full max-w-xs rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-6 rounded-full bg-rc-green-deep px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
