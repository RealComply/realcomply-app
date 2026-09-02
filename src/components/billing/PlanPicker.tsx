"use client";

import { useActionState, useState } from "react";
import { startCheckout, type BillingActionState } from "@/lib/actions/billing";
import { PLANS, annualPrice, planFamily, type Plan } from "@/lib/billing/entitlement";

// Choosing a plan.
//
// Both ladders are shown, side by side, because a brand-new agency has to
// answer "is this me, or is this the office?" before any listing count is
// meaningful — and that question is a real one they should answer rather than
// one we should guess and then argue with them about on an invoice.
//
// Within a ladder, the tier their own listing count implies is marked. It is a
// hint, not a lock: an agency signing up in January knows what its year looks
// like better than a rolling count that started yesterday does.

const initial: BillingActionState = { error: null };

const AGENT_PLANS: Plan[] = ["agent_1", "agent_2", "agent_3"];
const OFFICE_PLANS: Plan[] = ["office_1", "office_2", "office_3", "office_4", "office_5"];

function bandLabel(plan: Plan): string {
  const cap = PLANS[plan].maxListings;
  const ladder = planFamily(plan) === "agent" ? AGENT_PLANS : OFFICE_PLANS;
  const index = ladder.indexOf(plan);
  const previousCap = index > 0 ? PLANS[ladder[index - 1]].maxListings : 0;

  if (cap === null) return `More than ${previousCap} listings a year`;
  if (index === 0) return `Up to ${cap} listings a year`;
  return `${(previousCap ?? 0) + 1} to ${cap} listings a year`;
}

export function PlanPicker({
  suggested,
  listingCount,
}: {
  /** The tier this agency's own listing count implies, in the office ladder. */
  suggested: Plan;
  listingCount: number;
}) {
  const [state, formAction, pending] = useActionState(startCheckout, initial);
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");
  const [plan, setPlan] = useState<Plan>(suggested);

  const priceOf = (p: Plan) => (interval === "annual" ? annualPrice(p) : PLANS[p].price);
  const per = interval === "annual" ? "/year" : "/month";

  return (
    <form action={formAction} className="mt-6">
      <input type="hidden" name="plan" value={plan} />
      <input type="hidden" name="interval" value={interval} />

      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-rc-faint">Choose a plan</h2>
        <div className="inline-flex rounded-full border border-rc-border bg-white p-1 text-sm font-semibold">
          {(["monthly", "annual"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setInterval(value)}
              className={`rounded-full px-4 py-1.5 transition ${
                interval === value ? "bg-rc-green-deep text-white" : "text-rc-muted hover:text-rc-ink"
              }`}
            >
              {value === "monthly" ? "Monthly" : "Annual"}
            </button>
          ))}
        </div>
      </div>

      {interval === "annual" && (
        <p className="mt-2 text-sm font-medium text-rc-green-deep">
          Annual is ten months for twelve — two months free.
        </p>
      )}

      <div className="mt-5 grid gap-6 sm:grid-cols-2">
        {[
          { heading: "One agent", plans: AGENT_PLANS, note: "Your own listings. No office-level compliance." },
          { heading: "Whole office", plans: OFFICE_PLANS, note: "Every listing, plus registers, trust, training and the SG manual." },
        ].map((group) => (
          <div key={group.heading}>
            <h3 className="text-sm font-bold text-rc-ink">{group.heading}</h3>
            <p className="mt-1 text-xs leading-relaxed text-rc-muted">{group.note}</p>
            <div className="mt-3 space-y-2">
              {group.plans.map((p) => (
                <label
                  key={p}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                    plan === p
                      ? "border-rc-green-deep bg-rc-green-soft"
                      : "border-rc-border bg-white hover:border-rc-green-deep/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="planChoice"
                    checked={plan === p}
                    onChange={() => setPlan(p)}
                    className="mt-1 accent-rc-green-deep"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-bold text-rc-ink">{PLANS[p].name}</span>
                      <span className="text-sm font-bold text-rc-ink">
                        ${priceOf(p).toLocaleString("en-AU")}
                        <span className="text-xs font-semibold text-rc-muted">{per}</span>
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-rc-muted">{bandLabel(p)}</span>
                    {p === suggested && (
                      <span className="mt-1 block text-xs font-semibold text-rc-green-deep">
                        Matches your {listingCount} {listingCount === 1 ? "listing" : "listings"} in the last year
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-rc-border bg-white p-4">
        <p className="text-sm text-rc-muted">
          <span className="font-semibold text-rc-ink">30 days free</span>, then $
          {priceOf(plan).toLocaleString("en-AU")}
          {per} including GST. Cancel any time from this page. Payment details are entered on Stripe&rsquo;s own
          page, never here.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="mt-4 w-full rounded-full bg-rc-green-deep px-6 py-3 text-sm font-bold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {pending ? "Taking you to Stripe…" : `Start with ${PLANS[plan].name}`}
        </button>
      </div>

      {state.error && (
        <p role="alert" className="mt-3 text-sm font-medium text-rc-red">
          {state.error}
        </p>
      )}
    </form>
  );
}
