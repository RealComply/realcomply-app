import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/data/current-profile";
import { notFound } from "next/navigation";
import { entitlementFor, PLANS, annualPrice } from "@/lib/billing/entitlement";
import { isTestMode, stripeConfigured } from "@/lib/billing/stripe";
import { MasterSwitch } from "@/components/billing/MasterSwitch";
import { formatAuDate } from "@/lib/format-date";
import { PlanPicker } from "@/components/billing/PlanPicker";
import { ManageBillingButton } from "@/components/billing/ManageBillingButton";
import { isAccountHolder } from "@/lib/subscription-end/access";
import { RoofMark } from "@/components/RoofMark";
import { KeepPlanButton } from "@/components/billing/KeepPlanButton";
import { PlanChangeDone } from "@/components/billing/PlanChangeParts";
import { doneLine, intervalWord, type ChangeTiming } from "@/lib/billing/plan-change";
import { planFamily, type Plan } from "@/lib/billing/entitlement";
import type { Interval } from "@/lib/billing/stripe";

// Billing.
//
// Everything on this page is read from the agency row, not from Stripe. That
// is the whole architecture in one screen: if Stripe were unreachable right
// now, this page would still render correctly and the product would still know
// exactly what this agency is entitled to.
//
// The listing counter is here from day one, per the pricing doc, and it is the
// reason the page is worth visiting when nothing is wrong. A tier boundary
// nobody can see until it is crossed is a surprise on an invoice.

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ started?: string; cancelled?: string; changed?: string; kept?: string }>;
}) {
  const { profile, access } = await requireAccess();
  const supabase = await createClient();
  const { started, cancelled, changed, kept } = await searchParams;

  const entitlement = await entitlementFor(supabase, profile.agency_id);
  // The licensee in charge or the account holder sets up billing (9 Oct 2026).
  const mayManageBilling =
    access.runsOffice || (await isAccountHolder(supabase));
  // Billing follows who pays, not the role (Adam, 8 Oct 2026). An agent
  // invited into an office does not get it, and a typed address refuses.
  if (!mayManageBilling) notFound();

  const { data: agencyRow } = await supabase
    .from("agencies")
    .select("stripe_subscription_id, comped_reason, comped_until")
    .eq("id", profile.agency_id)
    .maybeSingle();

  const agency = agencyRow as {
    stripe_subscription_id?: string | null;
    comped_reason?: string | null;
    comped_until?: string | null;
  } | null;

  const subscribed = Boolean(agency?.stripe_subscription_id);
  // Change plan (Adam, 6 Nov 2026): whoever pays, while the subscription is
  // running. Not an office manager who doesn't pay.
  const accountHolder = await isAccountHolder(supabase);
  const mayChange =
    subscribed &&
    (access.actsAsLicensee || accountHolder) &&
    (entitlement.status === "active" || entitlement.status === "trialing");
  const changes = await recentPlanChanges(supabase, profile.agency_id, changed);
  const spec = entitlement.spec;
  const cap = spec.maxListings;

  // Percentage of the band used. Uncapped tiers have no bar — there is no
  // boundary to approach, and a bar that can never fill invites the question
  // "what happens at the end" when the answer is "nothing".
  const usedPercent = cap ? Math.min(100, Math.round((entitlement.listingCount / cap) * 100)) : null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Billing</h1>
          <p className="mt-1 text-sm text-rc-muted">Your plan, what it covers, and how much of it you&rsquo;ve used.</p>
        </div>
        <Link href="/dashboard/home" className="text-sm font-medium text-rc-muted transition hover:text-rc-green-deep">
          <RoofMark back />Home
        </Link>
      </div>

      {/* Said plainly and near the top, because a test-mode subscription looks
          identical to a real one on this page. Someone who believes they have
          paid, and has not, finds out at the worst possible moment.

          THREE STATES, NOT TWO (9 Sep 2026). This used to be one banner driven
          by isTestMode(), which was true whenever the key was not a live one —
          including when there was no key at all. So an unconfigured billing
          page displayed a confident "Test mode" notice and then failed at
          checkout with a generic error, which is the least helpful pairing
          available. Not configured is now its own message and says what to do. */}
      {!stripeConfigured() ? (
        <p className="mt-5 rounded-xl border border-rc-red/40 bg-rc-red-soft px-4 py-3 text-sm text-rc-ink">
          <span className="font-semibold">Billing isn&rsquo;t connected.</span> STRIPE_SECRET_KEY isn&rsquo;t set
          on this deployment, so checkout can&rsquo;t start. Set it in the hosting environment and redeploy —
          an environment variable only reaches a build made after it was saved.
        </p>
      ) : (
        isTestMode() && (
          <p className="mt-5 rounded-xl border border-rc-amber/40 bg-rc-amber/10 px-4 py-3 text-sm font-semibold text-rc-ink">
            Test mode. Nothing here charges a real card, and any subscription started is not a real one.
          </p>
        )
      )}

      {started && (
        <p className="mt-5 rounded-xl border border-rc-green-deep/25 bg-rc-green-soft px-4 py-3 text-sm font-semibold text-rc-green-deep">
          Thanks — that&rsquo;s gone through. It can take a few seconds to show below; reload if it hasn&rsquo;t.
        </p>
      )}
      {changes.done && <PlanChangeDone {...changes.done} />}
      {kept && (
        <p className="mt-5 rounded-xl border border-rc-border bg-white px-4 py-3 text-sm text-rc-ink">
          No change. You stay on {spec.name}.
        </p>
      )}
      {cancelled && (
        <p className="mt-5 rounded-xl border border-rc-border bg-white px-4 py-3 text-sm text-rc-muted">
          No changes made. Nothing has been charged.
        </p>
      )}

      {/* ── Current plan ─────────────────────────────────────────────── */}
      <section className="mt-6 rounded-2xl border border-rc-border bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-rc-faint">Your plan</p>
            <p className="mt-1 text-2xl font-extrabold tracking-tight text-rc-ink">{spec.name}</p>
            <p className="mt-1 text-sm text-rc-muted">{spec.blurb}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-extrabold tracking-tight text-rc-ink">
              ${spec.price.toLocaleString("en-AU")}
              <span className="text-sm font-semibold text-rc-muted">/month</span>
            </p>
            <p className="text-xs text-rc-faint">
              or ${annualPrice(entitlement.plan).toLocaleString("en-AU")}/year. GST inclusive.
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm font-semibold text-rc-ink">{statusLine(entitlement, agency)}</p>

        {changes.booked && (
          <div className="mt-3 rounded-xl border border-rc-amber/40 bg-rc-amber/10 px-4 py-3 text-sm text-rc-ink">
            <p className="font-semibold">{changes.booked}</p>
            {mayChange && <KeepPlanButton planName={spec.name} />}
          </div>
        )}

        {mayChange && (
          <div className="mt-5">
            <Link
              href="/dashboard/billing/change"
              className="inline-flex min-h-11 items-center rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rc-green-deep-600"
            >
              Change plan
            </Link>
          </div>
        )}

        {entitlement.readOnly && (
          <p className="mt-2 rounded-xl border border-rc-red/25 bg-rc-red/5 px-4 py-3 text-sm text-rc-ink">
            New listings and new records are paused. Everything already on file stays readable, and you can
            export all of it.
          </p>
        )}

        {/* Whoever the page lets in, not only the licensee in charge (10 Oct
            2026): the agent on their own plan, or the founder who is not the
            licensee, subscribed here and then had no way to cancel. */}
        {subscribed && mayManageBilling && (
          <div className="mt-5">
            <ManageBillingButton />
            <p className="mt-2 text-xs text-rc-faint">Card, invoices and cancelling, on Stripe.</p>
          </div>
        )}
      </section>

      {/* ── Usage ───────────────────────────────────────────────────── */}
      <section className="mt-5 rounded-2xl border border-rc-border bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-rc-faint">Listings</p>
        <p className="mt-1 text-lg font-bold text-rc-ink">
          {entitlement.listingCount} in the last 12 months
          {cap !== null && <span className="font-semibold text-rc-muted"> of {cap}</span>}
        </p>
        {/* Was three lines explaining WHY an unsold listing still counts —
            estimated selling price, price checks, material facts, sign-off.
            All true, and all an argument nobody on a billing screen is having.
            Adam, 3 Sep 2026: "too wordy... can we sharpen it up". The two
            facts that change what someone owes are the window and the rule;
            the justification belongs in a support answer, if it is ever
            asked for at all. */}
        {/* "A rolling 365 days" is precise and reads like a contract term.
            Adam, 9 Sep 2026. The window and the rule are the two facts that
            change what someone owes, so they stay — in words a person would
            use out loud. */}
        <p className="mt-1 text-sm text-rc-muted">
          Counts every listing added in the last 12 months, whether it sold or not.
        </p>

        {usedPercent !== null && (
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-rc-bg-alt">
            <div
              className={`h-full rounded-full ${
                entitlement.overLimit
                  ? "bg-rc-red"
                  : entitlement.approachingLimit
                    ? "bg-rc-amber"
                    : "bg-rc-green-deep"
              }`}
              style={{ width: `${Math.max(2, usedPercent)}%` }}
            />
          </div>
        )}

        {entitlement.overLimit && (
          <p className="mt-3 text-sm font-semibold text-rc-ink">
            You&rsquo;re past what {spec.name} covers. {PLANS[entitlement.impliedTier].name} is the tier for{" "}
            {entitlement.listingCount} listings — ${PLANS[entitlement.impliedTier].price.toLocaleString("en-AU")}
            /month.
          </p>
        )}
        {!entitlement.overLimit && entitlement.approachingLimit && (
          <p className="mt-3 text-sm font-semibold text-rc-ink">
            Getting close to the top of this tier. Nothing stops when you cross it — we&rsquo;ll tell you and move
            you up.
          </p>
        )}

        <p className="mt-3 text-xs text-rc-faint">
          Nothing here ever blocks a new listing. Your file is a legal record, and we won&rsquo;t stand between you
          and it over a tier boundary.
        </p>
      </section>

      {/* ── Subscribe ───────────────────────────────────────────────── */}
      {!subscribed && entitlement.status !== "comped" && (
        mayManageBilling ? (
          <PlanPicker suggested={entitlement.impliedTier} listingCount={entitlement.listingCount} />
        ) : (
          <p className="mt-6 rounded-xl border border-rc-border bg-white px-4 py-3 text-sm text-rc-muted">
            Your licensee in charge or the account holder sets up billing for the office.
          </p>
        )
      )}
          {/* Last, and only for RealComply staff. See MasterSwitch — this is what
          replaced the two SQL scripts that flipped Cass between free and
          trialing to test checkout. */}
      {profile.is_platform_admin === true && (
        <MasterSwitch currentPlan={entitlement.plan} currentStatus={entitlement.status} />
      )}

</main>
  );
}

function statusLine(
  entitlement: Awaited<ReturnType<typeof entitlementFor>>,
  agency: { comped_reason?: string | null; comped_until?: string | null } | null,
): string {
  switch (entitlement.status) {
    case "trialing":
      return entitlement.trialEndsAt
        ? `Free trial — ends ${formatAuDate(entitlement.trialEndsAt)}.`
        : "Free trial.";
    case "active":
      return "Active.";
    case "past_due":
      return "We couldn't take the last payment.";
    case "canceled":
      return "This subscription has ended.";
    case "comped": {
      // The reason is free text somebody typed into a SQL editor, so it can
      // arrive with its own full stop, or repeating the words this line has
      // already said. On 9 Sep 2026 that produced "Free account — Design
      // partner — free account, no Stripe records.." on screen. Trimmed and
      // de-duplicated here rather than relying on whoever writes the next one.
      const until = agency?.comped_until ? ` until ${formatAuDate(agency.comped_until)}` : "";
      const reason = (agency?.comped_reason ?? "").trim().replace(/[.\s]+$/, "");
      const why = reason && !/^free account/i.test(reason) ? ` — ${reason}` : "";
      return `Free account${until}${why}.`;
    }
  }
}

type PlanChangeRow = {
  id: string;
  from_plan: Plan;
  to_plan: Plan;
  to_interval: Interval;
  takes_effect: ChangeTiming;
  effective_at: string;
  next_payment_at: string | null;
  ongoing_cents: number;
  status: "done" | "scheduled" | "kept_current";
};

/**
 * Self-serve plan changes (0116): the one just made, for the "You're on …"
 * panel, and a change booked for the next billing date. Empty before 0116 has
 * run, or for someone who can't read the record.
 */
async function recentPlanChanges(
  supabase: Awaited<ReturnType<typeof createClient>>,
  agencyId: string,
  changedId: string | undefined,
): Promise<{ done: { title: string; body: string; nextSteps: boolean } | null; booked: string | null }> {
  const { data, error } = await supabase
    .from("plan_changes")
    .select("id, from_plan, to_plan, to_interval, takes_effect, effective_at, next_payment_at, ongoing_cents, status")
    .eq("agency_id", agencyId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error || !data) return { done: null, booked: null };
  const rows = data as PlanChangeRow[];
  const now = Date.now();
  const justMade = changedId ? rows.find((r) => r.id === changedId) ?? null : null;
  const scheduled = rows.find((r) => r.status === "scheduled" && new Date(r.effective_at).getTime() > now) ?? null;

  let done: { title: string; body: string; nextSteps: boolean } | null = null;
  if (justMade) {
    const toOffice = planFamily(justMade.to_plan) === "office";
    const fromAgent = planFamily(justMade.from_plan) === "agent";
    done = {
      ...doneLine({
        timing: justMade.takes_effect,
        fromName: PLANS[justMade.from_plan].name,
        toName: PLANS[justMade.to_plan].name,
        toOffice,
        fromAgent,
        effectiveDate: formatAuDate(justMade.effective_at),
        ongoingCents: justMade.ongoing_cents,
        interval: justMade.to_interval,
        nextPaymentDate: formatAuDate(justMade.next_payment_at ?? justMade.effective_at),
      }),
      nextSteps: toOffice && fromAgent && justMade.takes_effect !== "next_billing_date",
    };
  }
  const booked =
    scheduled && scheduled.id !== justMade?.id
      ? `Your plan changes to ${PLANS[scheduled.to_plan].name}, ${intervalWord(scheduled.to_interval)}, on ${formatAuDate(scheduled.effective_at)}.`
      : null;
  return { done, booked };
}
