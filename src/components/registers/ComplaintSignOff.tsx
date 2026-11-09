"use client";

import { useActionState } from "react";
import { signOffComplaint, type ActionState } from "@/lib/actions/registers";
import { COMPLAINT_SIGN_OFF_WORDS } from "@/lib/reviews/records";

// The licensee in charge signs off a resolved complaint (Adam, 3 Nov 2026;
// 0108). The tick is the statement; the database records who and when.
export function ComplaintSignOff({ complaintId }: { complaintId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(signOffComplaint.bind(null, complaintId), {
    error: null,
  });
  return (
    <form action={action} className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <label className="flex items-start gap-2 text-sm text-rc-ink">
        <input type="checkbox" name="reviewed" value="yes" required className="mt-0.5 h-4 w-4 accent-rc-green-deep" />
        <span>{COMPLAINT_SIGN_OFF_WORDS}</span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-9 items-center rounded-full bg-rc-green-deep px-4 text-xs font-semibold text-white transition hover:bg-rc-green-deep/90 disabled:opacity-60"
      >
        {pending ? "Signing off…" : "Sign off"}
      </button>
      {state.error && (
        <p role="alert" className="w-full text-xs text-rc-amber-deep">
          {state.error}
        </p>
      )}
    </form>
  );
}
