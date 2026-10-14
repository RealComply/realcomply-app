import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/data/current-profile";
import { entitlementFor } from "@/lib/billing/entitlement";
import { isTestMode, stripeConfigured } from "@/lib/billing/stripe";
import {
  accountStatus,
  cardLabel,
  mayManageBilling,
  stripeBillingDetails,
  type AccountStatus,
} from "@/lib/billing/account";
import { formatAuTimestamp } from "@/lib/format-date";
import { PortalButton } from "@/components/account/PortalButton";

// Account, in the profile menu (brief, 14 Oct 2026; mockup approved by Adam).
//
// The same menu for everyone; what the page shows depends on who pays. Whoever
// pays (the licensee in charge, the agent on their own plan, or the person who
// set the office up: lib/billing/account.ts, the same rule as Billing) sees
// their plan, card, invoices and cancel. Everyone else sees whose plan they
// are on and who looks after billing, and nothing from Stripe.
//
// The plan, status and trial date come from the office's record, as on the
// Billing page. The card, the billing period and the next payment date come
// from Stripe, and the page still works without them.
//
// Card, invoices and cancelling open Stripe's billing page (lib/actions/
// billing.ts, openBillingPortal), which refuses anyone who doesn't pay however
// it is reached. Cancelling there starts the existing subscription-end
// process; nothing new cancels anything.

export const metadata = { title: "Account · RealComply" };

const ADMIN_EMAIL = "admin@realcomply.com.au";

export default async function AccountPage() {
  const { profile, access } = await requireAccess();
  const supabase = await createClient();

  const { data: agencyRow } = await supabase
    .from("agencies")
    .select("name, licensee_name, stripe_customer_id, stripe_subscription_id, comped_until")
    .eq("id", profile.agency_id)
    .maybeSingle();
  const agency = (agencyRow ?? {}) as {
    name?: string | null;
    licensee_name?: string | null;
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    comped_until?: string | null;
  };
  const tradingName = agency.name?.trim() || "your office";

  if (!(await mayManageBilling(supabase, access))) {
    // Who looks after billing. On an office plan, the licensee in charge
    // named in Office profile. On an agent's own plan (an assistant helping
    // them), the agent, whose name the assistant can see.
    let whoPays: string | null = null;
    if (access.isAgentPlan) {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("agency_id", profile.agency_id)
        .eq("is_assistant", false)
        .is("archived_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      whoPays = (data as { full_name?: string | null } | null)?.full_name?.trim() || null;
    } else {
      whoPays = agency.licensee_name?.trim() || null;
    }

    return (
      <Shell>
        <Section title="Your plan">
          <p className="text-sm text-rc-ink">
            You&rsquo;re part of <span className="font-bold">{possessive(tradingName)}</span> RealComply plan.
          </p>
          <p className="text-xs text-rc-muted">
            {access.isAgentPlan
              ? whoPays
                ? `${whoPays}, whose plan this is, looks after billing.`
                : "The agent whose plan this is looks after billing."
              : whoPays
                ? `Your licensee in charge, ${whoPays}, looks after billing.`
                : "Your licensee in charge looks after billing."}
          </p>
        </Section>
      </Shell>
    );
  }

  const entitlement = await entitlementFor(supabase, profile.agency_id);
  const subscriptionId = agency.stripe_subscription_id ?? null;
  const customerId = agency.stripe_customer_id ?? null;
  const details = stripeConfigured()
    ? await stripeBillingDetails(subscriptionId, { customerId, agencyId: profile.agency_id })
    : null;

  const status = accountStatus(entitlement.status, Boolean(details?.endsAt));
  const interval = details?.interval ?? null;
  const planLine = `${entitlement.spec.name}${interval ? `, ${interval}` : ""}`;

  // The one date that matters for each status.
  const dateRow: { label: string; value: string } | null = (() => {
    switch (status) {
      case "Trial": {
        const at = entitlement.trialEndsAt ?? details?.trialEndsAt ?? null;
        return at ? { label: "Trial ends", value: formatAuTimestamp(at) } : null;
      }
      case "Cancelling":
        return details?.endsAt ? { label: "Ends", value: formatAuTimestamp(details.endsAt) } : null;
      case "Active":
        return details?.nextPaymentAt ? { label: "Next payment", value: formatAuTimestamp(details.nextPaymentAt) } : null;
      case "Free account":
        return agency.comped_until ? { label: "Free until", value: formatAuTimestamp(agency.comped_until) } : null;
      default:
        return null;
    }
  })();

  // A plan that can still be cancelled: one Stripe is billing, not yet
  // booked to end.
  const mayCancel =
    Boolean(subscriptionId) && (status === "Trial" || status === "Active" || status === "Payment failed");

  return (
    <Shell>
      {stripeConfigured() && isTestMode() && (
        <p className="rounded-xl border border-rc-amber/40 bg-rc-amber/10 px-4 py-3 text-sm font-semibold text-rc-ink">
          Test mode. Nothing here charges a real card.
        </p>
      )}

      <Section title="Your plan">
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-sm">
          <dt className="text-rc-muted">Plan</dt>
          <dd className="font-semibold text-rc-ink">{planLine}</dd>
          <dt className="text-rc-muted">Status</dt>
          <dd>
            <StatusPill status={status} />
          </dd>
          {dateRow && (
            <>
              <dt className="text-rc-muted">{dateRow.label}</dt>
              <dd className="font-semibold text-rc-ink">{dateRow.value}</dd>
            </>
          )}
        </dl>
        {status === "Payment failed" && (
          <p className="rounded-xl border border-rc-red/25 bg-rc-red-soft px-3 py-2 text-sm text-rc-ink">
            We couldn&rsquo;t take the last payment. Update your card and Stripe will try again.
          </p>
        )}
        <p className="text-xs text-rc-muted">
          Changing plan is coming soon. Until then, email{" "}
          <a href={`mailto:${ADMIN_EMAIL}`} className="font-medium text-rc-green-deep hover:underline">
            {ADMIN_EMAIL}
          </a>
          .
        </p>
      </Section>

      <Section title="Billing">
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-sm">
          <dt className="text-rc-muted">Card</dt>
          <dd className="font-semibold text-rc-ink">
            {details?.card
              ? cardLabel(details.card)
              : subscriptionId
                ? <span className="font-normal text-rc-muted">Shown on Stripe&rsquo;s billing page</span>
                : <span className="font-normal text-rc-muted">No card on file</span>}
          </dd>
        </dl>
        {customerId ? (
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <PortalButton flow="update_card" label="Update card" variant="primary" />
              <PortalButton flow="home" label="Invoices and receipts" variant="ghost" />
            </div>
            <p className="text-xs text-rc-muted">Opens Stripe&rsquo;s secure billing page.</p>
          </>
        ) : (
          <p className="text-xs text-rc-muted">
            {status === "Free account" ? "Your account is free, so there’s nothing to bill." : "Nothing has been billed yet."}
          </p>
        )}
      </Section>

      {subscriptionId && (mayCancel || status === "Cancelling") && (
        <Section title="Cancel">
          {status === "Cancelling" ? (
            <p className="text-sm text-rc-ink">
              Your plan ends on {details?.endsAt ? formatAuTimestamp(details.endsAt) : "the date on Stripe’s billing page"}. After
              that, you&rsquo;ll have 14 days to download your records before they&rsquo;re deleted.
            </p>
          ) : (
            <>
              <p className="text-sm text-rc-ink">
                You&rsquo;ll have 14 days to download your records before they&rsquo;re deleted.
              </p>
              <div>
                <PortalButton flow="cancel" label="Cancel subscription" variant="link" />
              </div>
            </>
          )}
        </Section>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Account</h1>
      <div className="mt-5 grid gap-4">{children}</div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 rounded-card border border-rc-border bg-white p-4 shadow-card sm:p-5">
      <h2 className="text-base font-bold text-rc-ink">{title}</h2>
      {children}
    </section>
  );
}

const PILL: Record<AccountStatus, string> = {
  Trial: "bg-rc-green-soft text-rc-green-deep",
  Active: "bg-rc-green-soft text-rc-green-deep",
  "Payment failed": "bg-rc-red-soft text-rc-red",
  Cancelling: "bg-rc-amber/15 text-rc-amber-deep",
  "Free account": "bg-rc-bg-alt text-rc-muted",
  Ended: "bg-rc-bg-alt text-rc-muted",
};

function StatusPill({ status }: { status: AccountStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${PILL[status]}`}>{status}</span>
  );
}

/** "Harbourline Property's", "Lloyd Property Agents'". */
function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}’` : `${name}’s`;
}
