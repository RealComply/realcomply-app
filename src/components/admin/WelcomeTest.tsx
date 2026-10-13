"use client";

import { useActionState } from "react";
import { sendTestWelcomeEmail, type DecisionState } from "@/lib/actions/early-access-decisions";

// A test copy of the welcome email, under the early access list (Adam, 12 Oct
// 2026). The welcome itself has no send button: it goes once a new office's
// card is in. This sends the same email through the same mail service, so it
// can be checked as received before a real office gets it.

const input =
  "min-w-0 flex-1 rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft";

export function WelcomeTest() {
  const [state, send, sending] = useActionState(sendTestWelcomeEmail, { error: null } as DecisionState);

  return (
    <form action={send} className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <p className="text-xs font-bold uppercase tracking-wide text-rc-faint">Test the welcome email</p>
      <p className="mt-1 text-xs text-rc-muted">
        The email a new office gets once their card is in, marked [Test]. It only goes to your test addresses
        (getadamc3+…@gmail.com), and nothing is recorded. The annexure button opens a preview that can&rsquo;t
        sign.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="welcome-test-email">
          Test address
        </label>
        <input
          id="welcome-test-email"
          name="email"
          type="email"
          required
          defaultValue="getadamc3+test1@gmail.com"
          className={input}
        />
        {/* The versions of the annexure box (brief, 14 Oct 2026). "Someone
            else" also sends the licensee's own signing email to the same test
            address, so both can be seen as received. "Agent on their own
            plan" shows the download link and sends nothing else (14 Oct). */}
        <label className="sr-only" htmlFor="welcome-test-signer">
          Who signed up
        </label>
        <select
          id="welcome-test-signer"
          name="signer"
          defaultValue="licensee"
          className="rounded-lg border border-rc-border bg-white px-3 py-2 text-sm text-rc-ink"
        >
          <option value="licensee">Signed up by the licensee</option>
          <option value="someone_else">Signed up by someone else</option>
          <option value="agent_plan">Agent on their own plan</option>
        </select>
        <button
          type="submit"
          disabled={sending}
          className="inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-4 py-2 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {sending ? "Sending…" : "Email a test welcome"}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="mt-2 text-xs font-medium text-rc-amber-deep">
          {state.error}
        </p>
      )}
      {!state.error && state.notice && (
        <p role="status" className="mt-2 text-xs font-medium text-rc-green-deep">
          {state.notice}
        </p>
      )}
    </form>
  );
}
