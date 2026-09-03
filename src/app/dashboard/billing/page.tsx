import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { entitlementFor, PLANS, annualPrice } from "@/lib/billing/entitlement";
import { isTestMode } from "@/lib/billing/stripe";
import { formatAuDate } from "@/lib/format-date";
import { PlanPicker } from "@/components/billing/PlanPicker";
import { ManageBillingButton } from "@/components/billing/ManageBillingButton";

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
  searchParams: Promise<{ started?: string; cancelled?: string }>;
}) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { started, cancelled } = await searchParams;

  const entitlement = await entitlementFor(supabase, profile.agency_id);

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
          ← Home
        </Link>
      </div>

      {/* Said plainly and near the top, because a test-mode subscription looks
          identical to a real one on this page. Someone who believes they have
          paid, and has not, finds out at the worst possible moment. */}
      {isTestMode() && (
        <p className="mt-5 rounded-xl border border-rc-amber/40 bg-rc-amber/10 px-4 py-3 text-sm font-semibold text-rc-ink">
          Test mode. Nothing here charges a real card, and any subscription started is not a real one.
        </p>
      )}

      {started && (
        <p className="mt-5 rounded-xl border border-rc-green-deep/25 bg-rc-green-soft px-4 py-3 text-sm font-semibold text-rc-green-deep">
          Thanks — that&rsquo;s gone through. It can take a few seconds to show below; reload if it hasn&rsquo;t.
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
            <p className="text-xs font-semibold uppercase tracking-wide text-rc-faint">Current plan</p>
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

        {entitlement.readOnly && (
          <p className="mt-2 rounded-xl border border-rc-red/25 bg-rc-red/5 px-4 py-3 text-sm text-rc-ink">
            New listings and new records are paused. Everything already on file stays readable, and you can
            export all of it.
          </p>
        )}

        {subscribed && profile.is_licensee_in_charge && (
          <div className="mt-5">
            <ManageBillingButton />
            <p className="mt-2 text-xs text-rc-faint">
              Change your card, switch plan, download invoices or cancel — all on Stripe&rsquo;s own page.
            </p>
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
        <p className="mt-1 text-sm text-rc-muted">A rolling 365 days. Every listing counts, sold or not.</p>

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
        profile.is_licensee_in_charge ? (
          <PlanPicker suggested={entitlement.impliedTier} listingCount={entitlement.listingCount} />
        ) : (
          <p className="mt-6 rounded-xl border border-rc-border bg-white px-4 py-3 text-sm text-rc-muted">
            Your licensee in charge sets up billing for the office.
          </p>
        )
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
      const until = agency?.comped_until ? ` until ${formatAuDate(agency.comped_until)}` : "";
      const why = agency?.comped_reason ? ` — ${agency.comped_reason}` : "";
      return `Free account${until}${why}.`;
    }
  }
}
