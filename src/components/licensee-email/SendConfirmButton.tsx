"use client";

import { useActionState } from "react";
import { sendLicenseeConfirmationAgain, type SendAgainState } from "@/lib/actions/licensee-email";

// Send again (or the first send) of the confirm email, from the Office profile (0112).

const initial: SendAgainState = { error: null, sent: false };

export function SendConfirmButton({ label }: { label: string }) {
  const [state, action, pending] = useActionState(sendLicenseeConfirmationAgain, initial);
  return (
    <form action={action} className="mt-2">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-9 items-center rounded-full border border-rc-green-deep/25 bg-white px-3 text-xs font-semibold text-rc-green-deep transition hover:bg-rc-green-soft disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Sending…" : label}
      </button>
      {state.sent && <p className="mt-1.5 text-xs text-rc-green-deep">Sent.</p>}
      {state.error && <p className="mt-1.5 text-xs text-rc-amber-deep">{state.error}</p>}
    </form>
  );
}
