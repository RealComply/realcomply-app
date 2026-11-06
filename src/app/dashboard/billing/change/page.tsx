import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/data/current-profile";
import { mayChangePlan, planChangeContext } from "@/lib/data/plan-change";
import { PLANS } from "@/lib/billing/entitlement";
import type { Interval } from "@/lib/billing/stripe";
import { intervalWord, ladderRows, perWord } from "@/lib/billing/plan-change";
import { PlanLadder } from "@/components/billing/PlanChangeParts";
import { KeepPlanButton } from "@/components/billing/KeepPlanButton";
import { formatAuDate } from "@/lib/format-date";
import { RoofMark } from "@/components/RoofMark";

// Change plan, step 2 of the mockup Adam signed off (6 Nov 2026): both
// ladders, monthly or yearly, prices including GST, the current plan marked,
// and what can't be picked greyed out with the reason. Whoever pays.

export default async function ChangePlanPage({ searchParams }: { searchParams: Promise<{ interval?: string }> }) {
  const { profile, access } = await requireAccess();
  const supabase = await createClient();
  if (!(await mayChangePlan(supabase, access))) notFound();
  const { interval: asked } = await searchParams;
  const ctx = await planChangeContext(supabase, profile);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Change plan</h1>
        <Link
          href="/dashboard/billing"
          className="text-sm font-medium text-rc-muted transition hover:text-rc-green-deep"
        >
          <RoofMark back />
          Billing
        </Link>
      </div>

      {ctx.state === "blocked" ? (
        <p className="mt-6 rounded-2xl border border-rc-border bg-white px-5 py-4 text-sm text-rc-ink">{ctx.message}</p>
      ) : (
        <ChangePlanBody ctx={ctx} asked={asked} />
      )}
    </main>
  );
}

function ChangePlanBody({
  ctx,
  asked,
}: {
  ctx: Extract<Awaited<ReturnType<typeof planChangeContext>>, { state: "ready" }>;
  asked: string | undefined;
}) {
  const shown: Interval = asked === "annual" || asked === "monthly" ? asked : ctx.sub.interval;
  const rows = ladderRows({
    current: { plan: ctx.sub.plan, interval: ctx.sub.interval },
    interval: shown,
    listingCount: ctx.listingCount,
  });
  const segment = (interval: Interval, label: string) => (
    <Link
      href={`/dashboard/billing/change?interval=${interval}`}
      aria-current={shown === interval ? "page" : undefined}
      className={`px-4 py-1.5 text-sm font-semibold transition ${
        shown === interval ? "bg-rc-green-deep text-white" : "text-rc-muted hover:text-rc-ink"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <p className="mt-1 text-sm text-rc-muted">
        You&rsquo;re on {PLANS[ctx.sub.plan].name}, {intervalWord(ctx.sub.interval)}.
        {ctx.sub.trialEnd
          ? ` Your free trial ends ${formatAuDate(ctx.sub.trialEnd)}.`
          : ` Next billing date ${formatAuDate(ctx.sub.periodEnd)}.`}
      </p>

      {ctx.booked && (
        <div className="mt-5 rounded-2xl border border-rc-amber/40 bg-rc-amber/10 px-5 py-4 text-sm text-rc-ink">
          <p>
            <span className="font-semibold">
              Your plan changes to {PLANS[ctx.booked.plan].name}, {intervalWord(ctx.booked.interval)}, on{" "}
              {formatAuDate(ctx.booked.at)}.
            </span>{" "}
            Choosing another plan below replaces that change.
          </p>
          <KeepPlanButton planName={PLANS[ctx.sub.plan].name} />
        </div>
      )}

      <div className="mt-5 inline-flex overflow-hidden rounded-full border border-rc-border bg-white">
        {segment("monthly", "Monthly")}
        {segment("annual", "Yearly (2 months free)")}
      </div>

      <form action="/dashboard/billing/change/confirm" method="get" className="mt-4">
        <input type="hidden" name="interval" value={shown} />
        <PlanLadder agent={rows.agent} office={rows.office} per={perWord(shown)} />
        <p className="mt-3 text-xs text-rc-muted">
          Prices include GST. You&rsquo;ve listed {ctx.listingCount}{" "}
          {ctx.listingCount === 1 ? "property" : "properties"} in the last 12 months. Upgrades start straight away. A
          switch between monthly and yearly starts on your next billing date. You don&rsquo;t need to choose a cheaper
          plan: after your first 12 months, we move you down at a billing date whenever your listings fit one.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rc-green-deep-600"
          >
            Continue
          </button>
          <Link
            href="/dashboard/billing"
            className="inline-flex min-h-11 items-center rounded-full border border-rc-border bg-white px-5 py-2.5 text-sm font-semibold text-rc-ink transition hover:border-rc-green-deep"
          >
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
