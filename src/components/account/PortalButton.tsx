"use client";

import { useActionState } from "react";
import { openBillingPortal, type BillingActionState } from "@/lib/actions/billing";
import type { PortalFlow } from "@/lib/billing/account";

// "Update card", "Invoices and receipts" and "Cancel subscription" on the
// Account page (brief, 14 Oct 2026). Each opens Stripe's billing page, on the
// screen it names, and Stripe sends them back to Account. The same action as
// Billing's "Manage billing", so the same people are refused: the server
// checks who pays, whatever the page showed.
//
// A form rather than a link, as there: the billing page is a short-lived
// session Stripe makes on request, so it can't be baked into the page.

const initial: BillingActionState = { error: null };

const STYLES = {
  primary:
    "inline-flex items-center justify-center rounded-full bg-rc-green-deep px-5 py-2 text-sm font-bold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60",
  ghost:
    "inline-flex items-center justify-center rounded-full border-2 border-rc-green-deep px-4 py-1.5 text-sm font-bold text-rc-green-deep transition hover:bg-rc-green-soft disabled:opacity-60",
  link: "text-sm font-semibold text-rc-red underline-offset-2 transition hover:underline disabled:opacity-60",
} as const;

export function PortalButton({
  flow,
  label,
  variant,
}: {
  flow: PortalFlow;
  label: string;
  variant: keyof typeof STYLES;
}) {
  const [state, formAction, pending] = useActionState(openBillingPortal, initial);

  return (
    <form action={formAction}>
      <input type="hidden" name="flow" value={flow} />
      <input type="hidden" name="from" value="account" />
      <button type="submit" disabled={pending} className={STYLES[variant]}>
        {pending ? "Opening…" : label}
      </button>
      {state.error && (
        <p role="alert" className="mt-2 text-sm font-medium text-rc-red">
          {state.error}
        </p>
      )}
    </form>
  );
}
