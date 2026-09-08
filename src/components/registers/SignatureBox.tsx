"use client";

import { useActionState, useState } from "react";
import { signDocument, type ActionState } from "@/lib/actions/signoffs";

const initialState: ActionState = { error: null };

// Acknowledging a document that has been published for sign-off — the
// supervision guidelines, a policy, an insurance certificate.
//
// A TICK RATHER THAN A TYPED NAME, changed 8 Sep 2026 alongside the trust
// reconciliations. The typed-name field had to go here too the moment
// signDocument stopped reading it: leaving a box that invites someone to type
// their name and then quietly ignores what they type is worse than either
// option done properly.
//
// The name now comes off the authenticated profile, which is both more
// reliable than a retyped string and harder to get wrong. Electronic
// Transactions Act 2000 (NSW) s9 is satisfied the same way it was before — the
// method identifies the person and indicates their approval — and the server
// still stamps the time, which is the half nobody can fake from here.
export function SignatureBox({ documentId }: { documentId: string }) {
  const boundAction = signDocument.bind(null, documentId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const [read, setRead] = useState(false);

  return (
    <form action={formAction} className="mt-2">
      <label className="flex cursor-pointer items-start gap-2 text-sm text-rc-ink">
        <input
          type="checkbox"
          checked={read}
          onChange={(e) => setRead(e.target.checked)}
          className="mt-0.5 accent-rc-green-deep"
        />
        <span>I have read this document and I&rsquo;m signing it off.</span>
      </label>
      <button
        type="submit"
        disabled={pending || !read}
        className="mt-2 rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-50"
      >
        {pending ? "Signing…" : "Sign off"}
      </button>
      {state.error && <p className="mt-1.5 text-xs text-rc-amber-deep">{state.error}</p>}
    </form>
  );
}
