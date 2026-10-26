"use client";

import { useActionState } from "react";
import { approveOfficeManagerByLink, type ApproveState } from "@/lib/actions/office-manager";
import { formatAuTimestamp } from "@/lib/format-date";

// The approval control on the licensee's page (0093). Typed name plus the
// time, the same standard as a price statement approval. No "are you sure":
// the words are directly above the button, and the button says what it does.

const initial: ApproveState = { error: null, approved: false };

export function ApproveOfficeManagerForm({
  token,
  personName,
  officeName,
  wording,
}: {
  token: string;
  personName: string;
  officeName: string;
  wording: string;
}) {
  const [state, action, pending] = useActionState(approveOfficeManagerByLink, initial);
  const first = personName.split(/\s+/)[0] || personName;

  if (state.approved) {
    return (
      <section className="mt-6 rounded-card border border-rc-green-deep/25 bg-rc-green-soft px-5 py-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-rc-green-deep-600">Approved</p>
        <h2 className="mt-1 text-lg font-extrabold tracking-tight text-rc-ink">
          {personName} is now office manager for {officeName}
        </h2>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-rc-muted">Approved by</dt>
          <dd className="text-rc-ink">{state.approvedByName ?? "You"}, licensee in charge</dd>
          {state.approvedAt && (
            <>
              <dt className="text-rc-muted">When</dt>
              <dd className="text-rc-ink">{formatAuTimestamp(state.approvedAt)}</dd>
            </>
          )}
          <dt className="text-rc-muted">Wording</dt>
          <dd className="text-rc-ink">{wording}</dd>
        </dl>
        <p className="mt-3 text-sm leading-relaxed text-rc-muted">
          {state.emailed ? (
            <>We&rsquo;ve emailed you a copy. To withdraw your approval at any time, use the link in that email.</>
          ) : (
            <>
              Your approval is recorded. We couldn&rsquo;t email you a copy just now. To withdraw your approval at any
              time, email{" "}
              <a href="mailto:admin@realcomply.com.au" className="font-semibold text-rc-green-deep underline">
                admin@realcomply.com.au
              </a>
              .
            </>
          )}
        </p>
      </section>
    );
  }

  return (
    <form action={action} className="mt-6">
      <input type="hidden" name="token" value={token} />
      <label htmlFor="typedName" className="block text-sm font-medium text-rc-ink">
        Type your full name to approve
      </label>
      <input
        id="typedName"
        name="typedName"
        type="text"
        required
        autoComplete="name"
        maxLength={120}
        className="mt-1 w-full max-w-sm rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
      />
      <p className="mt-1.5 text-xs leading-relaxed text-rc-muted">
        We record your name, the date and time, and the wording above. A copy is filed in the office&rsquo;s
        Sign-offs and emailed to you. You can withdraw your approval at any time.
      </p>
      {state.error && (
        <p role="alert" className="mt-3 text-sm text-rc-amber-deep">
          {state.error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rc-green-deep-600 disabled:cursor-not-allowed disabled:bg-rc-border disabled:text-rc-muted"
        >
          {pending ? "Approving…" : `Approve ${first} as office manager`}
        </button>
        <span className="text-sm text-rc-muted">Not right? Don&rsquo;t approve. Reply to the email instead.</span>
      </div>
    </form>
  );
}
