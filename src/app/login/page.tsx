"use client";

import { Suspense, useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { login, type ActionState } from "@/lib/actions/auth";

const initialState: ActionState = { error: null };

function LoginMessage() {
  // Isolated in its own component so useSearchParams doesn't force the
  // whole page out of static prerendering — it just needs its own
  // Suspense boundary (see LoginPage below).
  const searchParams = useSearchParams();
  const message = searchParams.get("message");

  if (!message) return null;

  return (
    <p className="rounded-md border border-rc-border bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
      {message}
    </p>
  );
}

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-rc-ink">
          Real<span className="text-rc-green-deep">Comply</span>
        </h1>
        <p className="mt-1 text-sm text-neutral-500">Built by agents, for agents.</p>

        <form action={formAction} className="mt-8 space-y-4">
          <Suspense fallback={null}>
            <LoginMessage />
          </Suspense>
          {state.error && (
            <p className="rounded-md border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2 text-sm text-rc-amber-deep">
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
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-rc-border px-3 py-2 text-sm focus:border-rc-green-deep focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-sm text-neutral-500">
          New agency?{" "}
          <Link href="/signup" className="font-medium text-rc-green-deep hover:underline">
            Set up RealComply
          </Link>
        </p>
      </div>
    </main>
  );
}
