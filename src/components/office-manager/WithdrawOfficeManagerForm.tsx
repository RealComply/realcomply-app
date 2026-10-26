"use client";

import { useActionState } from "react";
import { withdrawOfficeManagerByLink, type WithdrawState } from "@/lib/actions/office-manager";
import { formatAuTimestamp } from "@/lib/format-date";

// The withdraw control on the licensee's page (0093). Opening the page
// changes nothing; only the button does. A mail scanner that opens the link
// therefore withdraws nothing.

const initial: WithdrawState = { error: null, withdrawn: false };

export function WithdrawOfficeManagerForm({
  token,
  personName,
  officeName,
}: {
  token: string;
  personName: string;
  officeName: string;
}) {
  const [state, action, pending] = useActionState(withdrawOfficeManagerByLink, initial);

  if (state.withdrawn) {
    return (
      <section className="mt-6 rounded-card border border-rc-border bg-white px-5 py-5">
        <h2 className="text-lg font-extrabold tracking-tight text-rc-ink">Withdrawn</h2>
        <p className="mt-2 text-sm leading-relaxed text-rc-muted">
          {personName} is no longer office manager for {officeName}.
          {state.withdrawnAt ? ` Recorded: withdrawn by email link, ${formatAuTimestamp(state.withdrawnAt)}.` : ""}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-rc-muted">
          If you want {personName} back as office manager later, they can ask you again.
        </p>
      </section>
    );
  }

  return (
    <form action={action} className="mt-6">
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <p role="alert" className="mb-3 text-sm text-rc-amber-deep">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#c43a3a] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#a52f2f] disabled:cursor-not-allowed disabled:bg-rc-border disabled:text-rc-muted"
        >
          {pending ? "Withdrawing…" : "Withdraw approval"}
        </button>
        <span className="text-sm text-rc-muted">Opening this page changes nothing. Only the button does.</span>
      </div>
    </form>
  );
}
