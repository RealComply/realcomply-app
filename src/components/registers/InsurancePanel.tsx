"use client";

import { InsuranceCard } from "@/components/registers/InsuranceCard";
import { AddOtherInsurance } from "@/components/registers/AddOtherInsurance";
import { expiryStatus } from "@/lib/expiry-status";
import { otherInsuranceTitle, type HistoryEntry } from "@/lib/insurance-read";
import type { Agency, InsurancePolicy, InsurancePolicyType } from "@/lib/types";

// Insurance register — split out of Licence register (Adam, 13 Aug 2026),
// which used to bundle a single PI insurance card in with licence/CPD data
// and had no room for anything else. Room for the three policies Adam named:
// PI, cybersecurity, iCare workers. (Was: exactly those three, "not a generic
// add any policy system, since that's not what was asked for". Now asked for,
// 16 Oct 2026: see below.)
//
// Each takes its certificate of currency or schedule (0076, 15 Oct 2026). The
// history and the links to each certificate are worked out on the server
// (registers/page.tsx) and passed in finished.
//
// And since 16 Oct 2026 (0078; mockup approved by Adam), other insurance the
// office holds: one "+ Add other insurance" link under the three, and each
// policy added shows under "Other insurance" on the same card. No empty card
// for a type the office doesn't hold. The tiles count them too.
export function InsurancePanel({
  agency,
  historyByPolicy,
  otherPolicies,
  otherHistory,
  canAddOther,
  urlByPath,
  nameOf,
}: {
  agency: Agency;
  historyByPolicy: Record<InsurancePolicyType, HistoryEntry[]>;
  /** Added policies still on the register, oldest first. */
  otherPolicies: InsurancePolicy[];
  otherHistory: Record<string, HistoryEntry[]>;
  /** False until 0078 has run. */
  canAddOther: boolean;
  urlByPath: Record<string, string>;
  nameOf: Record<string, string>;
}) {
  const shared = { agencyId: agency.id, urlByPath, nameOf };
  const statuses = [
    expiryStatus(agency.pi_expiry),
    expiryStatus(agency.cyber_expiry),
    expiryStatus(agency.icare_expiry),
    ...otherPolicies.map((p) => expiryStatus(p.expiry)),
  ];
  const current = statuses.filter((s) => s === "ok" || s === "soon").length;
  const expiringSoon = statuses.filter((s) => s === "urgent").length;
  const expired = statuses.filter((s) => s === "expired").length;
  const notOnFile = statuses.filter((s) => s === "none").length;

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile n={current} l="Current" ok={current > 0} />
        <Tile n={expiringSoon} l="Expiring ≤ 30 days" warn={expiringSoon > 0} />
        <Tile n={expired} l="Expired" bad={expired > 0} ok={expired === 0} />
        <Tile n={notOnFile} l="Not on file" warn={notOnFile > 0} />
      </div>

      <div className="mt-4 space-y-4">
        <InsuranceCard
          {...shared}
          target={{ kind: "agency", policy: "pi" }}
          title="Professional indemnity insurance"
          note="Mandatory condition of every licence in the agency: s22, Property and Stock Agents Act 2002 (NSW)."
          insurer={agency.pi_insurer}
          policyNumber={agency.pi_policy_number}
          expiry={agency.pi_expiry}
          documentPath={agency.pi_document_path ?? null}
          documentFileName={agency.pi_document_file_name ?? null}
          read={agency.pi_read}
          history={historyByPolicy.pi}
        />
        <InsuranceCard
          {...shared}
          target={{ kind: "agency", policy: "cyber" }}
          title="Cybersecurity insurance"
          note="Not a PSA Act requirement, but worth tracking here alongside the rest: client and identity documents held in the agency's systems are the exposure."
          insurer={agency.cyber_insurer}
          policyNumber={agency.cyber_policy_number}
          expiry={agency.cyber_expiry}
          documentPath={agency.cyber_document_path ?? null}
          documentFileName={agency.cyber_document_file_name ?? null}
          read={agency.cyber_read}
          history={historyByPolicy.cyber}
        />
        <InsuranceCard
          {...shared}
          target={{ kind: "agency", policy: "icare" }}
          title="iCare workers insurance"
          note="NSW workers compensation cover for the agency's employees."
          insurer={agency.icare_insurer}
          policyNumber={agency.icare_policy_number}
          expiry={agency.icare_expiry}
          documentPath={agency.icare_document_path ?? null}
          documentFileName={agency.icare_document_file_name ?? null}
          read={agency.icare_read}
          history={historyByPolicy.icare}
        />
      </div>

      {otherPolicies.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-bold uppercase tracking-wider text-rc-muted">Other insurance</h3>
          <div className="mt-3 space-y-4">
            {otherPolicies.map((p) => (
              <InsuranceCard
                key={p.id}
                {...shared}
                target={{ kind: "other", policyId: p.id, policyKind: p.kind, name: p.name }}
                title={otherInsuranceTitle(p.kind, p.name)}
                insurer={p.insurer}
                policyNumber={p.policy_number}
                expiry={p.expiry}
                documentPath={p.document_path}
                documentFileName={p.document_file_name}
                read={p.read}
                history={otherHistory[p.id] ?? []}
              />
            ))}
          </div>
        </div>
      )}

      {canAddOther && (
        <div className="mt-4">
          <AddOtherInsurance agencyId={agency.id} />
        </div>
      )}
    </div>
  );
}

function Tile({ n, l, ok, warn, bad }: { n: number; l: string; ok?: boolean; warn?: boolean; bad?: boolean }) {
  const color = bad ? "text-red-700" : warn ? "text-rc-amber-deep" : ok ? "text-rc-green-deep" : "text-rc-ink";
  return (
    <div className="rounded-card border border-rc-border bg-white px-3.5 py-2.5 shadow-card">
      <div className={`text-lg font-bold tracking-tight ${color}`}>{n}</div>
      <div className="mt-0.5 text-[11px] font-medium text-rc-muted">{l}</div>
    </div>
  );
}
