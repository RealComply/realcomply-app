"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup, type ActionState } from "@/lib/actions/auth";
import { Logo } from "@/components/Logo";

const initialState: ActionState = { error: null };

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, initialState);

  return (
    <main className="flex flex-1 items-center justify-center bg-rc-bg-alt px-4 py-16">
      <div className="w-full max-w-sm rounded-card border border-rc-border bg-white p-8 shadow-card-lg">
        <Logo size={22} />
        <p className="mt-1.5 text-sm text-rc-muted">Set up your agency.</p>

        <form action={formAction} className="mt-8 space-y-4">
          {state.error && (
            <p className="rounded-2xl border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2 text-sm text-rc-amber-deep">
              {state.error}
            </p>
          )}
          <div>
            <label htmlFor="agencyName" className="block text-sm font-medium text-rc-ink">
              Agency name
            </label>
            <input
              id="agencyName"
              name="agencyName"
              type="text"
              required
              placeholder="Cass Property"
              className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
            />
          </div>
          <div>
            <label htmlFor="fullName" className="block text-sm font-medium text-rc-ink">
              Your name
            </label>
            <input
              id="fullName"
              name="fullName"
              type="text"
              required
              className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
            />
          </div>
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
              className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-rc-ink">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-full bg-rc-green-deep px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
          >
            {pending ? "Setting up…" : "Create agency"}
          </button>
        </form>

        <p className="mt-6 text-sm text-rc-muted">
          Already set up?{" "}
          <Link href="/login" className="font-medium text-rc-green-deep hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
