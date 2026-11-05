import { CONTRACT_NEEDED, S63_LABEL_ACT, S63_LABEL_SECTION, S63_URL } from "@/lib/rules/contract-before-market";

// "Contract needed before the property goes on the market." and the Act, with
// "section 63" linked (Master, 5 Nov 2026: just the title and the link; the
// section's words stay in the code). On the contract card until it's done,
// and under Continue to On market when that's refused for it.

export function ContractNeededNote({ className = "", also }: { className?: string; also?: string | null }) {
  return (
    <div className={`text-sm ${className}`}>
      <p className="font-semibold text-rc-amber-deep">{CONTRACT_NEEDED}</p>
      <p className="mt-0.5 text-xs text-rc-muted">
        {S63_LABEL_ACT}{" "}
        <a href={S63_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-rc-green-deep underline">
          {S63_LABEL_SECTION}
        </a>
      </p>
      {also && <p className="mt-1.5 text-sm text-rc-amber-deep">{also}</p>}
    </div>
  );
}
