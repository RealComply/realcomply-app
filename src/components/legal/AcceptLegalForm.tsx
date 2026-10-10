"use client";

import { useActionState } from "react";
import { acceptCurrentLegal, type AcceptLegalState } from "@/lib/actions/legal";
import { logout } from "@/lib/actions/auth";
import type { LegalDocument } from "@/lib/legal/documents";
import { Logo } from "@/components/Logo";

const initialState: AcceptLegalState = { error: null };

// Same shape as the signup checkbox: acceptance has to be something the person
// did, so it is an unticked box and a button, never a banner that counts
// carrying on as agreement. The links open in a new tab so reading them does
// not lose this page.
export function AcceptLegalForm({ terms, privacy }: { terms: LegalDocument; privacy: LegalDocument }) {
  const [state, formAction, pending] = useActionState(acceptCurrentLegal, initialState);

  return (
    <main className="relative isolate flex flex-1 items-center justify-center overflow-hidden bg-rc-bg-alt px-4 py-16">
      <div className="rc-mesh-bg" />
      <div className="w-full max-w-md rounded-card border border-rc-border bg-white p-8 shadow-card-lg">
        <Logo size={22} />
        <h1 className="mt-6 text-lg font-semibold text-rc-ink">We&rsquo;ve updated our terms</h1>
        <p className="mt-2 text-sm leading-relaxed text-rc-muted">
          Our Terms and Conditions and Privacy Policy have changed, effective {terms.effective}. Please read them
          and accept them to keep using RealComply.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-rc-muted">
          We&rsquo;ve also published a{" "}
          <a href="/dpa" target="_blank" rel="noopener noreferrer" className="font-medium text-rc-green-deep hover:underline">
            Data Processing Agreement
          </a>{" "}
          setting out how we handle personal information on your agency&rsquo;s behalf.
        </p>

        <form action={formAction} className="mt-6 space-y-4">
          <input type="hidden" name="termsVersion" value={terms.version} />
          <input type="hidden" name="privacyVersion" value={privacy.version} />

          {state.error && (
            <p className="rounded-2xl border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2 text-sm text-rc-amber-deep">
              {state.error}
            </p>
          )}

          <label className="flex items-start gap-2.5 text-sm leading-relaxed text-rc-ink">
            <input
              type="checkbox"
              name="acceptLegal"
              value="yes"
              required
              className="mt-1 shrink-0 accent-rc-green-deep"
            />
            <span>
              I&rsquo;ve read and accept the{" "}
              <a href={terms.path} target="_blank" rel="noopener noreferrer" className="font-medium text-rc-green-deep hover:underline">
                {terms.title}
              </a>{" "}
              and{" "}
              <a href={privacy.path} target="_blank" rel="noopener noreferrer" className="font-medium text-rc-green-deep hover:underline">
                {privacy.title}
              </a>
              .
            </span>
          </label>

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-full bg-rc-green-deep px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Accept and continue"}
          </button>
        </form>

        <p className="mt-6 text-xs leading-relaxed text-rc-muted">
          If you don&rsquo;t accept the new terms, contact us at admin@realcomply.com.au.
        </p>
        <form action={logout} className="mt-3">
          <button type="submit" className="text-xs font-medium text-rc-muted hover:text-rc-ink hover:underline">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
