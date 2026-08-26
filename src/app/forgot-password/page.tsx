"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset, type ResetRequestState } from "@/lib/actions/auth";
import { Logo } from "@/components/Logo";

const initialState: ResetRequestState = { error: null, sent: false };

// Added 26 Aug 2026. Until today there was no way back into a RealComply
// account: a password was set once at signup and could never be recovered or
// changed. See the comment block in lib/actions/auth.ts for how that surfaced.
//
// Deliberately its own page rather than a panel on /login. Somebody reaching
// for this has already failed to sign in once, and a form that swaps itself
// out underneath them is the wrong thing to meet at that moment.
export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);

  return (
    <main className="relative isolate flex flex-1 items-center justify-center overflow-hidden bg-rc-bg-alt px-4 py-16">
      <div className="rc-mesh-bg" />
      <div className="w-full max-w-sm rounded-card border border-rc-border bg-white p-8 shadow-card-lg">
        <Logo size={22} />

        {state.sent ? (
          // The same message whichever address was typed, including one with no
          // account behind it — see requestPasswordReset. Worded so it stays
          // true either way: it describes what was done, not what exists.
          <>
            <h1 className="mt-8 text-lg font-bold tracking-tight text-rc-ink">Check your email</h1>
            <p className="mt-2 text-sm text-rc-muted">
              If that address has a RealComply account, a link to set a new password is on its way.
              It expires in an hour, and it only works in the browser you asked from.
            </p>
            <p className="mt-4 text-sm text-rc-muted">
              Nothing after a few minutes? Check junk mail, then{" "}
              <Link href="/forgot-password" className="font-medium text-rc-green-deep hover:underline">
                ask again
              </Link>
              .
            </p>
            <p className="mt-6 text-sm text-rc-muted">
              <Link href="/login" className="font-medium text-rc-green-deep hover:underline">
                Back to sign in
              </Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-8 text-lg font-bold tracking-tight text-rc-ink">Forgotten your password?</h1>
            <p className="mt-2 text-sm text-rc-muted">
              Put in the address you sign in with and we&rsquo;ll send you a link to set a new one.
            </p>

            <form action={formAction} className="mt-6 space-y-4">
              {state.error && (
                <p className="rounded-2xl border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2 text-sm text-rc-amber-deep">
                  {state.error}
                </p>
              )}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-rc-ink">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                  className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
                />
              </div>
              <button
                type="submit"
                disabled={pending}
                className="w-full rounded-full bg-rc-green-deep px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
              >
                {pending ? "Sending…" : "Send the link"}
              </button>
            </form>

            <p className="mt-6 text-sm text-rc-muted">
              Remembered it?{" "}
              <Link href="/login" className="font-medium text-rc-green-deep hover:underline">
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
