"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup, type ActionState } from "@/lib/actions/auth";

const initialState: ActionState = { error: null };

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, initialState);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-rc-ink">
          Real<span className="text-rc-green-deep">Comply</span>
        </h1>
        <p className="mt-1 text-sm text-neutral-500">Set up your agency.</p>

        <form action={formAction} className="mt-8 space-y-4">
          {state.error && (
            <p className="rounded-md border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2 text-sm text-rc-amber-deep">
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
              className="mt-1 w-full rounded-md border border-rc-border px-3 py-2 text-sm focus:border-rc-green-deep focus:outline-none"
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
              className="mt-1 w-full rounded-md border border-rc-border px-3 py-2 text-sm focus:border-rc-green-deep focus:outline-none"
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
              className="mt-1 w-full rounded-md border border-rc-border px-3 py-2 text-sm focus:border-rc-green-deep focus:outline-none"
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
              className="mt-1 w-full rounded-md border border-rc-border px-3 py-2 text-sm focus:border-rc-green-deep focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "Setting up…" : "Create agency"}
          </button>
        </form>

        <p className="mt-6 text-sm text-neutral-500">
          Already set up?{" "}
          <Link href="/login" className="font-medium text-rc-green-deep hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
