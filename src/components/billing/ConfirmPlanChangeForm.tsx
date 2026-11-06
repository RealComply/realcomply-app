"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { confirmPlanChange, type PlanChangeState } from "@/lib/actions/plan-change";

// The confirm step of Change plan (mockup step 3). For an agent moving to an
// office plan it also asks who the licensee in charge is, in the mockup's
// words. Plain text only for what's typed.

const initial: PlanChangeState = { error: null };

export type ConfirmPlanChangeProps = {
  hidden: Record<string, string>;
  buttonLabel: string;
  /** Agent to office: "Provides access to" and the licensee question. */
  agentToOffice: { payerName: string; accessLines: string[]; defaultName: string; defaultEmail: string } | null;
};

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rc-green-deep-600 disabled:cursor-not-allowed disabled:opacity-60";
const FIELD =
  "mt-1 w-full rounded-xl border border-rc-border bg-white px-3 py-2 text-sm text-rc-ink outline-none focus:border-rc-green-deep";

export function ConfirmPlanChangeForm(props: ConfirmPlanChangeProps) {
  const [state, action, pending] = useActionState(confirmPlanChange, initial);
  const [who, setWho] = useState<"self" | "someone_else">("self");

  return (
    <form action={action} className="mt-5 space-y-5">
      {Object.entries(props.hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {props.agentToOffice && (
        <section className="rounded-2xl border border-rc-border bg-white p-6">
          <h2 className="text-base font-bold text-rc-ink">Provides access to</h2>
          <ul className="mt-3 list-disc space-y-1 rounded-xl bg-rc-green-soft px-5 py-3 pl-9 text-sm text-rc-ink">
            {props.agentToOffice.accessLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <fieldset className="mt-5">
            <legend className="text-sm font-semibold text-rc-ink">Who is the licensee in charge of the office?</legend>
            <div className="mt-2 grid gap-2">
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-rc-border px-3 py-2.5 text-sm text-rc-ink has-[:checked]:border-rc-green-deep has-[:checked]:bg-rc-green-soft">
                <input
                  type="radio"
                  name="licensee"
                  value="self"
                  checked={who === "self"}
                  onChange={() => setWho("self")}
                  className="accent-rc-green-deep"
                />
                I am ({props.agentToOffice.payerName})
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-rc-border px-3 py-2.5 text-sm text-rc-ink has-[:checked]:border-rc-green-deep has-[:checked]:bg-rc-green-soft">
                <input
                  type="radio"
                  name="licensee"
                  value="someone_else"
                  checked={who === "someone_else"}
                  onChange={() => setWho("someone_else")}
                  className="accent-rc-green-deep"
                />
                Someone else: I&rsquo;ll add their name and email
              </label>
            </div>
            {who === "someone_else" && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-semibold text-rc-ink">
                  Their name
                  <input
                    name="licenseeName"
                    type="text"
                    required
                    maxLength={200}
                    autoComplete="off"
                    defaultValue={props.agentToOffice.defaultName}
                    className={FIELD}
                  />
                </label>
                <label className="text-sm font-semibold text-rc-ink">
                  Their email
                  <input
                    name="licenseeEmail"
                    type="email"
                    required
                    maxLength={320}
                    autoComplete="off"
                    defaultValue={props.agentToOffice.defaultEmail}
                    className={FIELD}
                  />
                </label>
              </div>
            )}
            <p className="mt-2 text-xs leading-relaxed text-rc-muted">
              If it&rsquo;s someone else, they get a confirm email before any sign-off links go to them. Until they
              approve you as office manager, you keep the office side of your account.
            </p>
          </fieldset>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? "Working…" : props.buttonLabel}
        </button>
        <Link
          href={`/dashboard/billing/change?ladder=${(props.hidden.plan ?? "").startsWith("agent_") ? "agent" : "office"}&interval=${encodeURIComponent(props.hidden.interval ?? "monthly")}`}
          className="inline-flex min-h-11 items-center rounded-full border border-rc-border bg-white px-5 py-2.5 text-sm font-semibold text-rc-ink transition hover:border-rc-green-deep"
        >
          Back
        </Link>
      </div>
      {state.error && (
        <p role="alert" className="text-sm font-medium text-rc-red">
          {state.error}
        </p>
      )}
    </form>
  );
}
