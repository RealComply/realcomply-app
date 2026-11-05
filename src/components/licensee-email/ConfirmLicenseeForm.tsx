"use client";

import { useActionState } from "react";
import { confirmLicenseeEmail, type ConfirmState } from "@/lib/actions/licensee-email";

// The one button on the confirm page (0112).

const initial: ConfirmState = { error: null, confirmed: false };

export function ConfirmLicenseeForm({ token, officeName }: { token: string; officeName: string }) {
  const [state, action, pending] = useActionState(confirmLicenseeEmail, initial);

  if (state.confirmed) {
    return (
      <section className="mt-6 rounded-card border border-rc-green-deep/25 bg-rc-green-soft px-5 py-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-rc-green-deep-600">Confirmed</p>
        <p className="mt-1 text-sm leading-relaxed text-rc-ink">
          Thank you. {officeName} can now send you approvals and sign-off links through RealComply.
        </p>
      </section>
    );
  }

  return (
    <form action={action} className="mt-6">
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center rounded-full bg-rc-green-deep px-6 text-sm font-bold text-white transition hover:bg-rc-green-deep-600 disabled:cursor-not-allowed disabled:bg-rc-border disabled:text-rc-muted"
      >
        {pending ? "Confirming…" : "Confirm"}
      </button>
      {state.error && <p className="mt-2 text-sm text-rc-amber-deep">{state.error}</p>}
    </form>
  );
}
