"use client";

import { InsuranceCard } from "@/components/registers/InsuranceCard";
import { expiryStatus } from "@/lib/expiry-status";
import type { Agency, Profile } from "@/lib/types";

// Insurance register — split out of Licence register (Adam, 13 Aug 2026),
// which used to bundle a single PI insurance card in with licence/CPD data
// and had no room for anything else. Room for exactly the three policies
// Adam named: PI, cybersecurity, iCare workers — not a generic "add any
// policy" system, since that's not what was asked for.
export function InsurancePanel({ agency, viewerProfile }: { agency: Agency; viewerProfile: Profile }) {
  const statuses = [
    expiryStatus(agency.pi_expiry),
    expiryStatus(agency.cyber_expiry),
    expiryStatus(agency.icare_expiry),
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
          policyType="pi"
          title="Professional indemnity insurance"
          note="Mandatory condition of every licence in the agency — s22, Property and Stock Agents Act 2002 (NSW)."
          insurer={agency.pi_insurer}
          policyNumber={agency.pi_policy_number}
          expiry={agency.pi_expiry}
          viewerProfile={viewerProfile}
        />
        <InsuranceCard
          policyType="cyber"
          title="Cybersecurity insurance"
          note="Not a PSA Act requirement, but worth tracking here alongside the rest — client and identity documents held in the agency's systems are the exposure."
          insurer={agency.cyber_insurer}
          policyNumber={agency.cyber_policy_number}
          expiry={agency.cyber_expiry}
          viewerProfile={viewerProfile}
        />
        <InsuranceCard
          policyType="icare"
          title="iCare workers insurance"
          note="NSW workers compensation cover for the agency's employees."
          insurer={agency.icare_insurer}
          policyNumber={agency.icare_policy_number}
          expiry={agency.icare_expiry}
          viewerProfile={viewerProfile}
        />
      </div>
    </div>
  );
}

function Tile({ n, l, ok, warn, bad }: { n: number; l: string; ok?: boolean; warn?: boolean; bad?: boolean }) {
  const color = bad ? "text-red-700" : warn ? "text-rc-amber-deep" : ok ? "text-rc-green-deep" : "text-rc-ink";
  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className={`text-xl font-bold tracking-tight ${color}`}>{n}</div>
      <div className="mt-0.5 text-[11px] font-medium text-rc-muted">{l}</div>
    </div>
  );
}
