import { TrustMonthCard } from "@/components/registers/TrustMonthCard";
import { TrustAuditForm } from "@/components/registers/TrustAuditForm";
import { formatAuDate } from "@/lib/format-date";
import { MONTH_STATUS_LABELS, type ReconciliationMonth } from "@/lib/trust-account";
import type { TrustAudit } from "@/lib/types";

// The Trust account register.
//
// Two obligations sit here, both the licensee's:
//
//   Monthly — reg cl 27(5)(b) and cl 30(1). The reconciliation statement is
//   prepared at the end of each named month, and the trial balance that
//   compares against it is due within 21 days of month end. 21 days is the
//   number the product uses; Adam had believed it was 14 and corrected the
//   product to match the Regulation once shown (25 Aug 2026).
//
//   Annual — s111 and s112. See TrustAuditForm.
//
// The calendar is the part that earns its place. Before this, reconciliations
// were a flat list of uploads with a typed-in period label, which could not
// answer "which months are missing" — and a reminder that cannot tell whether
// something is outstanding is a reminder nobody trusts.

const CHIP: Record<ReconciliationMonth["status"], string> = {
  signed: "bg-rc-green-soft text-rc-green-deep border-transparent",
  awaiting_signature: "bg-rc-amber/15 text-rc-amber-deep border-rc-amber/30",
  awaiting_upload: "bg-rc-amber/15 text-rc-amber-deep border-rc-amber/30",
  overdue: "bg-rc-red-soft text-rc-red border-rc-red/30",
  future: "border-dashed border-rc-border bg-rc-bg-alt text-rc-faint",
};

export function TrustAccountPanel({
  months,
  agencyId,
  trustAccountId,
  accountName,
  canUpload,
  canSign,
  signerName,
  auditPeriodEnd,
  auditDueOn,
  auditDaysToDue,
  audit,
  auditConfirmedByName,
  auditYearLabel,
}: {
  months: ReconciliationMonth[];
  agencyId: string;
  trustAccountId: string;
  /** Named in the copy so a two-account agency can tell the panels apart. */
  accountName: string;
  canUpload: boolean;
  canSign: boolean;
  signerName: string;
  auditPeriodEnd: string;
  auditDueOn: string;
  auditDaysToDue: number;
  audit: TrustAudit | null;
  auditConfirmedByName: string | null;
  auditYearLabel: string;
}) {
  // Everything that has come due and is not signed, worst first. Plus the most
  // recent signed month, so a clean register still shows something rather than
  // an empty space that reads like a bug.
  const outstanding = months
    .filter((m) => m.status === "overdue" || m.status === "awaiting_signature" || m.status === "awaiting_upload")
    .reverse();
  const lastSigned = [...months].reverse().find((m) => m.status === "signed");
  const cards = outstanding.length > 0 ? outstanding.slice(0, 4) : lastSigned ? [lastSigned] : [];

  const overdueCount = months.filter((m) => m.status === "overdue").length;

  return (
    <div className="space-y-6">
      {/* ── Monthly ── */}
      <section className="rounded-card border border-rc-border bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-rc-ink">Monthly reconciliation — {accountName}</h3>
            <p className="mt-1 text-xs text-rc-muted">
              A statement reconciling the trust account against the cash book, prepared at the end of each
              month and signed by the licensee in charge.
            </p>
          </div>
          {overdueCount > 0 && (
            <span className="shrink-0 rounded-full bg-rc-red-soft px-3 py-1 text-xs font-bold text-rc-red">
              {overdueCount} overdue
            </span>
          )}
        </div>

        <p className="mt-3 text-xs leading-relaxed text-rc-faint">
          cl 27(5)(b) and cl 30(1), Property and Stock Agents Regulation 2022 (NSW) — the trial balance
          comparison is due within 21 days after the end of each month.
        </p>

        <p className="mt-5 text-[11px] font-bold uppercase tracking-wider text-rc-faint">
          {auditYearLabel}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {months.map((m) => (
            <div
              key={m.month}
              className={`rounded-xl border px-3 py-2.5 ${CHIP[m.status]}`}
              title={m.dueOn ? `Due ${formatAuDate(m.dueOn)}` : "Not due yet"}
            >
              <p className="text-[13px] font-bold">{m.label}</p>
              <p className="mt-0.5 text-[11px] font-semibold">{MONTH_STATUS_LABELS[m.status]}</p>
            </div>
          ))}
        </div>

        {cards.length > 0 && (
          <div className="mt-5 space-y-3">
            {cards.map((m) => (
              <TrustMonthCard
                key={m.month}
                month={m}
                agencyId={agencyId}
                trustAccountId={trustAccountId}
                accountName={accountName}
                canUpload={canUpload}
                canSign={canSign}
                signerName={signerName}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Annual ── */}
      <TrustAuditForm
        agencyId={agencyId}
        trustAccountId={trustAccountId}
        accountName={accountName}
        periodEnd={auditPeriodEnd}
        dueOn={auditDueOn}
        daysToDue={auditDaysToDue}
        audit={audit}
        confirmedByName={auditConfirmedByName}
        canEdit={canSign}
      />
    </div>
  );
}
