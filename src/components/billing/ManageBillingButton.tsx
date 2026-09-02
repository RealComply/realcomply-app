"use client";

import { useActionState } from "react";
import { openBillingPortal, type BillingActionState } from "@/lib/actions/billing";

// One button, and behind it every billing screen we did not have to build:
// change card, switch plan, download invoices, cancel. Stripe hosts all of it.
//
// A form rather than a link, because opening the portal creates a short-lived
// session on Stripe's side — a URL that would go stale if it were baked into
// the page at render time and clicked twenty minutes later.

const initial: BillingActionState = { error: null };

export function ManageBillingButton() {
  const [state, formAction, pending] = useActionState(openBillingPortal, initial);

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-rc-border bg-white px-5 py-2.5 text-sm font-bold text-rc-ink transition hover:border-rc-green-deep hover:text-rc-green-deep disabled:opacity-60"
      >
        {pending ? "Opening…" : "Manage billing"}
      </button>
      {state.error && (
        <p role="alert" className="mt-2 text-sm font-medium text-rc-red">
          {state.error}
        </p>
      )}
    </form>
  );
}
