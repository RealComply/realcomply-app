"use client";

import { useActionState } from "react";
import { AlertTriangle } from "lucide-react";
import { setAmlPreCommencement } from "@/lib/actions/registers";
import {
  AML_COMMENCEMENT_DATE,
  PRE_COMMENCEMENT_CONDITIONS,
} from "@/lib/rules/aml-precommencement";
import type { ActionState } from "@/lib/actions/compliance";

const initialState: ActionState = { error: null };

// The agency's position on AUSTRAC pre-commencement customers.
//
// WHY THIS IS A SETTING AND NOT A RULE. Whether a single exclusive agency
// agreement is a "business relationship" or an "occasional transaction" is the
// question the whole exemption turns on, and it isn't resolved in AUSTRAC's
// published guidance. RealComply doesn't get to decide it. The agency takes
// the position, on advice, and everything downstream just follows.
//
// It lives on the SG Manual page rather than in Registers because that is where
// the agency's standing positions belong — the same "confirm it once at agency
// level, not once per file" idea as the standing attestations in the SG.
//
// Off is the correct resting state and the copy says so. A licensee who reads
// this and does nothing has lost nothing.
export function AmlPreCommencementCard({
  enabled,
  isLicensee,
}: {
  enabled: boolean;
  isLicensee: boolean;
}) {
  const [state, formAction, pending] = useActionState(setAmlPreCommencement, initialState);

  return (
    <div className="mt-6 rounded-card border border-rc-border bg-white px-4 py-4 shadow-card">
      <h2 className="text-sm font-semibold text-rc-ink">
        AML/CTF — vendors under agreements signed before {AML_COMMENCEMENT_DATE}
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-rc-muted">
        Real estate became a reporting sector on {AML_COMMENCEMENT_DATE}. For a seller&rsquo;s agent the
        designated service starts when the agency agreement is signed, and AUSTRAC does not require
        an identity check to keep serving a customer whose relationship already existed
        on that date.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-rc-muted">
        Turning this on lets an agent close the vendor AML item on a listing whose agreement predates
        that date by recording pre-commencement status instead of a provider check. It changes nothing on any
        other file, and it never satisfies the licensee AML sign-off at Sold.
      </p>

      <div className="mt-3 rounded-lg border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2.5">
        <p className="flex items-start gap-1.5 text-xs font-semibold text-rc-amber-deep">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>Confirm this with your adviser before turning it on.</span>
        </p>
        <ul className="mt-2 space-y-1">
          {PRE_COMMENCEMENT_CONDITIONS.map((c) => (
            <li key={c} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-rc-muted">
              <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-rc-faint" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </div>

      {isLicensee ? (
        <form action={formAction} className="mt-3 flex flex-wrap items-center gap-3">
          {/* Submitted on change rather than behind a Save button: it is one
              boolean, and a switch that needs confirming is a switch people
              leave half-set. */}
          <label className="flex items-center gap-2 text-sm text-rc-ink">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={enabled}
              disabled={pending}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="h-4 w-4 rounded border-rc-border"
            />
            Treat vendors under pre-{AML_COMMENCEMENT_DATE} agreements as pre-commencement customers
          </label>
          {pending && <span className="text-xs text-rc-faint">Saving…</span>}
        </form>
      ) : (
        <p className="mt-3 text-xs text-rc-faint">
          {enabled
            ? "Your agency has taken this position."
            : "Your agency has not taken this position, so every vendor needs a provider check."}{" "}
          Only the licensee in charge can change it.
        </p>
      )}

      {state.error && (
        <p className="mt-2 text-xs font-medium text-rc-amber-deep" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}
