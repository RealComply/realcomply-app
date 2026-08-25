import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { TrustAccountSwitcher } from "@/components/registers/TrustAccountSwitcher";
import { TrustAccountPanel } from "@/components/registers/TrustAccountPanel";
import { formatAuDate } from "@/lib/format-date";
import {
  auditDueOn,
  auditPeriodEndFor,
  buildMonths,
  daysUntil,
  previousAuditPeriodEnd,
  type ReconciliationRecord,
} from "@/lib/trust-account";
import type {
  Profile, SignoffDocument, SignoffSignature, TrustAccount, TrustAudit,
} from "@/lib/types";

// Trust accounts — its own page, its own nav entry (Adam, 25 Aug 2026).
//
// It was the sixth tab inside Registers, which was fine when it was one account
// and a tick box. With several accounts, a monthly rhythm and real penalties
// attached, that was buried.
//
// ?account= selects. A URL rather than component state, so a reminder email or
// the Monday digest can link straight at the account it is about.
export default async function TrustAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { account: requestedAccount } = await searchParams;

  const [{ data: accountRows }, { data: docRows }, { data: sigRows }, { data: auditRows }, { data: staffRows }] =
    await Promise.all([
      supabase.from("trust_accounts").select("*").order("created_at", { ascending: true }),
      supabase
        .from("signoff_documents")
        .select("*")
        .eq("category", "trust_reconciliation")
        .order("created_at", { ascending: false }),
      supabase.from("signoff_signatures").select("*"),
      supabase.from("trust_audits").select("*"),
      supabase.from("profiles").select("id, full_name, email"),
    ]);

  const allAccounts = (accountRows ?? []) as TrustAccount[];
  // Archived accounts leave the switcher but stay reachable by direct link, so
  // an old reconciliation is never orphaned from the page that explains it.
  const accounts = allAccounts.filter((a) => !a.archived_at || a.id === requestedAccount);
  const docs = (docRows ?? []) as SignoffDocument[];
  const sigs = (sigRows ?? []) as SignoffSignature[];
  const audits = (auditRows ?? []) as TrustAudit[];
  const staff = (staffRows ?? []) as Pick<Profile, "id" | "full_name" | "email">[];
  const nameOf = (id: string | null) =>
    id ? staff.find((p) => p.id === id)?.full_name ?? null : null;

  const today = new Date();
  const currentPeriod = auditPeriodEndFor(today);
  const auditPeriod = previousAuditPeriodEnd(today);
  const auditDue = auditDueOn(auditPeriod);

  // Per account: the twelve months of the current audit year, and its own
  // audit record for the period just ended. One audit per account per year
  // (Adam, 25 Aug 2026: "annual audit is 1 per account").
  const monthsByAccount = new Map<string, ReturnType<typeof buildMonths>>();
  for (const acct of allAccounts) {
    const records = new Map<string, ReconciliationRecord>();
    for (const doc of docs) {
      if (doc.trust_account_id !== acct.id || !doc.period_month) continue;
      if (records.has(doc.period_month)) continue;
      records.set(doc.period_month, {
        documentId: doc.id,
        month: doc.period_month,
        fileName: doc.file_name,
        uploadedByName: nameOf(doc.uploaded_by),
        signedAt: sigs.find((s) => s.document_id === doc.id && s.signed_at)?.signed_at ?? null,
      });
    }
    monthsByAccount.set(acct.id, buildMonths(currentPeriod, records, today));
  }

  const toneOf: Record<string, "red" | "amber" | null> = {};
  for (const acct of allAccounts) {
    const months = monthsByAccount.get(acct.id) ?? [];
    const audit = audits.find((a) => a.trust_account_id === acct.id && a.period_end === auditPeriod);
    const auditLate = !audit?.confirmed_at && daysUntil(auditDue, today) < 0;
    toneOf[acct.id] = months.some((m) => m.status === "overdue") || auditLate
      ? "red"
      : months.some((m) => m.status === "awaiting_signature" || m.status === "awaiting_upload") ||
          !audit?.confirmed_at
        ? "amber"
        : null;
  }

  const active =
    accounts.find((a) => a.id === requestedAccount) ?? accounts[0] ?? null;

  const activeAudit = active
    ? audits.find((a) => a.trust_account_id === active.id && a.period_end === auditPeriod) ?? null
    : null;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Trust accounts</h1>
          <p className="mt-1 text-sm text-rc-muted">
            Every trust account the agency operates, each with its own monthly reconciliations and
            annual audit.
          </p>
        </div>
        <Link
          href="/dashboard/registers"
          className="text-sm font-medium text-rc-muted transition hover:text-rc-green-deep"
        >
          Registers →
        </Link>
      </div>

      <div className="mt-6 overflow-hidden rounded-card border border-rc-border bg-white shadow-card">
        <TrustAccountSwitcher
          accounts={accounts}
          activeId={active?.id ?? ""}
          canManage={Boolean(profile.is_licensee_in_charge)}
          toneOf={toneOf}
        />

        {active ? (
          <div className="p-5">
            {active.archived_at && (
              <p className="mb-4 rounded-card border border-rc-border bg-rc-bg-alt px-4 py-3 text-sm text-rc-muted">
                This account is closed. Its records are kept and still readable; nothing new can be
                filed against it until it is reopened.
              </p>
            )}
            <TrustAccountPanel
              months={monthsByAccount.get(active.id) ?? []}
              agencyId={profile.agency_id}
              trustAccountId={active.id}
              accountName={active.name}
              canUpload={Boolean(
                !active.archived_at && (profile.is_licensee_in_charge || profile.is_assistant),
              )}
              canSign={Boolean(!active.archived_at && profile.is_licensee_in_charge)}
              signerName={profile.full_name ?? ""}
              auditPeriodEnd={auditPeriod}
              auditDueOn={auditDue}
              auditDaysToDue={daysUntil(auditDue, today)}
              audit={activeAudit}
              auditConfirmedByName={nameOf(activeAudit?.confirmed_by ?? null)}
              auditYearLabel={`Year ending ${formatAuDate(currentPeriod)}`}
            />
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-rc-muted">
            No trust accounts yet.
            {profile.is_licensee_in_charge
              ? " Add one above — most agencies start with Sales and Property management."
              : " Your licensee in charge can add one."}
          </div>
        )}
      </div>
    </main>
  );
}
