"use client";

import { useActionState } from "react";
import { submitSignoff } from "@/lib/actions/signoff-links";
import { APPROVER_NAME_MAX } from "@/lib/rules/price-statement";

// The signing control on the public sign-off page.
//
// Typed name plus an immutable timestamp, which is the same standard the
// in-app sign-offs already use and is ETA-2000 valid for a party attesting to
// their own review (see the reasoning in 0009_document_signoffs.sql). This is
// not the bar for binding an external party to a contract — that is what a
// dedicated e-signature provider is for — but a licensee confirming they have
// reviewed their own agency's file is squarely the lighter case.
//
// No "are you sure" step. The statement is directly above the button, the
// button says what it does, and an extra modal between reading and signing
// makes a considered act feel like a dark pattern.
//
// kind="b4" is the price statement approval (Adam, 12 Oct 2026, 0066). Same
// typed name, same timestamp, different words: the licensee is approving one
// line before it is advertised, not signing off the file. The kind changes
// the words only. Which card the approval completes is decided by the
// database from the request the token names.

const initial = { error: null as string | null, signed: false };

export function SignoffForm({ token, kind = "sign_licensee" }: { token: string; kind?: "sign_licensee" | "b4" }) {
  const [state, action, pending] = useActionState(submitSignoff, initial);
  const approving = kind === "b4";

  if (state.signed) {
    return (
      <div className="mt-6 rounded-card border border-rc-green-deep/25 bg-rc-green-soft px-5 py-5">
        <p className="text-base font-extrabold tracking-tight text-rc-green-deep-600">
          {approving ? "Approved. Thank you." : "Signed. Thank you."}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-rc-muted">
          {approving ? (
            <>
              The agency&rsquo;s file now shows your approval of this price statement. There is nothing else to
              do. You can close this page.
            </>
          ) : (
            <>
              The agency&rsquo;s file has been updated. There is nothing else for you to do, and you can close
              this page. A copy of what you signed stays on the file.
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="mt-6">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="kind" value={kind} />

      <label htmlFor="typedName" className="block text-sm font-medium text-rc-ink">
        Your full name
      </label>
      <input
        id="typedName"
        name="typedName"
        type="text"
        required
        autoComplete="name"
        placeholder="Jane Smith"
        // The database refuses a longer name on a price statement approval
        // (0066). The final sign-off has no limit, and keeps none here.
        maxLength={approving ? APPROVER_NAME_MAX : undefined}
        className="mt-1 w-full max-w-sm rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
      />
      <p className="mt-1.5 text-xs leading-relaxed text-rc-muted">
        {approving
          ? "Typing your name here records your approval. The date and time are recorded with it."
          : "Typing your name here acts as your signature, and the date and time are recorded with it."}
      </p>

      {state.error && (
        <p className="mt-3 text-sm font-medium text-rc-red" role="alert">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className={`mt-4 rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60 ${
          approving ? "w-full sm:w-auto" : ""
        }`}
      >
        {approving
          ? pending
            ? "Approving…"
            : "Approve this price statement"
          : pending
            ? "Signing…"
            : "Sign off on this file"}
      </button>
    </form>
  );
}
