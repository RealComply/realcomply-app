"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { setAgencyBillingAsMaster, type BillingActionState } from "@/lib/actions/billing";
import { PLANS, type Plan } from "@/lib/billing/entitlement";

// The RealComply master controls, on the billing page and visible to nobody else.
//
// Adam, 9 Sep 2026: "Am I going to have to do this every time I want to test
// it? Is there a way we can make it accessible from my account only? Let's
// call my account the RealComply Master account."
//
// This replaces billing-test-step-1.sql and billing-test-step-2.sql. Putting
// the agency on a trial is what makes the plan picker appear — a free account
// is deliberately never shown plans to buy — and putting it back to free is
// what clears the sandbox Stripe ids afterwards. Both were a paste into the
// database console, which is a fine way to do something once and a bad way to
// do it every time.
//
// DELIBERATELY BLUNT, AND DELIBERATELY LOUD. It is a red-bordered box that
// names itself, because a control that changes what an agency pays should
// never be mistaken for part of the page around it. The wording says what will
// happen to the Stripe ids, because that is the half a person forgets.
//
// The flag behind it is granted in SQL and has no interface of its own — see
// migration 0044. A screen that can make someone a platform admin is a screen
// that can be tricked into making someone a platform admin.

const initial: BillingActionState = { error: null };

export function MasterSwitch({
  currentPlan,
  currentStatus,
}: {
  currentPlan: Plan;
  currentStatus: string;
}) {
  const [state, formAction, pending] = useActionState(setAgencyBillingAsMaster, initial);
  const [plan, setPlan] = useState<Plan>(currentPlan);

  const isFree = currentStatus === "comped";

  return (
    <section className="mt-5 rounded-2xl border border-rc-red/40 bg-white p-5">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-rc-red">
        <KeyRound size={13} aria-hidden="true" />
        RealComply master
      </p>
      <p className="mt-1.5 text-sm text-rc-muted">
        Only you can see this. It sets this agency&rsquo;s plan and status directly, without going through
        Stripe.
      </p>

      {/* The way in to the staff page. Put here rather than in the sidebar
          because the sidebar is the agency's own navigation and this is not
          part of the product — and because this red box is the one place Adam
          already knows to look for RealComply-only controls. */}
      <p className="mt-2 text-sm">
        <Link href="/dashboard/admin" className="font-semibold text-rc-red hover:underline">
          See everyone who has signed up →
        </Link>
      </p>

      <form action={formAction} className="mt-4 space-y-3">
        <label className="block text-xs font-medium text-rc-muted">
          Plan
          <select
            name="plan"
            value={plan}
            onChange={(e) => setPlan(e.target.value as Plan)}
            className="mt-1 block w-full max-w-xs rounded-lg border border-rc-border px-2.5 py-2 text-sm text-rc-ink"
          >
            {(Object.keys(PLANS) as Plan[]).map((key) => (
              <option key={key} value={key}>
                {PLANS[key].name} — ${PLANS[key].price}/month
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            name="mode"
            value="trial"
            disabled={pending}
            className="rounded-full bg-rc-green-deep px-4 py-2 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Put on a 30-day trial"}
          </button>
          <button
            type="submit"
            name="mode"
            value="free"
            disabled={pending}
            className="rounded-full border border-rc-border bg-white px-4 py-2 text-xs font-semibold text-rc-muted transition hover:border-rc-ink/20 hover:text-rc-ink disabled:opacity-60"
          >
            {pending ? "Saving…" : "Back to a free account"}
          </button>
        </div>

        <p className="text-[11px] leading-relaxed text-rc-faint">
          {isFree
            ? "This agency is on a free account, so no plans are offered above. Put it on a trial to see the plan picker and test checkout."
            : "Back to a free account also clears the Stripe customer and subscription ids. Use it as soon as a test is finished — a sandbox id left behind points at nothing once the account is live, and it is the first thing anyone will read and believe when billing misbehaves."}
        </p>

        {state.error && (
          <p role="alert" className="text-xs font-medium text-rc-amber-deep">
            {state.error}
          </p>
        )}
      </form>
    </section>
  );
}
