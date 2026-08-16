"use client";

import { useState, useTransition } from "react";
import { Globe, AlertTriangle, Check } from "lucide-react";
import { checkListingNow } from "@/lib/actions/website-scan";

// The advertised-price check, as shown on c1.
//
// Reports; it does not decide. The check never sets the item's status and never
// touches the guide figures the agent recorded — a mis-parsed page would
// otherwise put a red mark on a compliant listing, or quietly overwrite the
// agent's own record with something scraped off a web page. Both are worse
// failures than missing a discrepancy, because neither is visible to the person
// who would have to answer for it.

export type ScanFinding = {
  checkedAt: string;
  url: string;
  ok: boolean;
  summary: string;
  issues: string[];
  priceShown: boolean;
  priceText?: string;
};

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function ListingScanPanel({
  propertyId,
  finding,
  hasUrl,
}: {
  propertyId: string;
  finding?: ScanFinding;
  hasUrl: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function check() {
    setError(null);
    startTransition(async () => {
      const result = await checkListingNow(propertyId);
      if (result.error) setError(result.error);
    });
  }

  const tone = !finding ? "none" : finding.issues.length > 0 ? "warn" : finding.ok ? "ok" : "unknown";

  return (
    <div className="mt-3 border-t border-rc-border pt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-rc-muted">The live ad</p>
          {!hasUrl ? (
            <p className="mt-1 text-[11px] leading-relaxed text-rc-muted">
              Add this listing&rsquo;s web address in Edit listing details and it will be checked against the ESP
              each week.
            </p>
          ) : !finding ? (
            <p className="mt-1 text-[11px] leading-relaxed text-rc-muted">
              Not checked yet. Runs automatically each week, or check it now.
            </p>
          ) : (
            <div className="mt-1">
              <p
                className={`flex items-start gap-1.5 text-sm leading-snug ${
                  tone === "warn" ? "text-rc-amber-deep" : tone === "ok" ? "text-rc-ink" : "text-rc-muted"
                }`}
              >
                {tone === "warn" ? (
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                ) : tone === "ok" ? (
                  <Check size={13} className="mt-0.5 shrink-0 text-rc-green-deep" aria-hidden="true" />
                ) : (
                  <Globe size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                )}
                <span>{finding.summary}</span>
              </p>
              {finding.issues.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {finding.issues.map((issue, i) => (
                    <li key={i} className="text-[11px] leading-relaxed text-rc-amber-deep">
                      {issue}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1.5 text-[11px] text-rc-faint">
                Checked {when(finding.checkedAt)}. This is a read of your own listing page, not a compliance
                decision.
              </p>
            </div>
          )}
        </div>
        {hasUrl && (
          <button
            type="button"
            onClick={check}
            disabled={pending}
            className="shrink-0 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-ink transition hover:border-rc-ink/20 disabled:opacity-60"
          >
            {pending ? "Checking…" : "Check now"}
          </button>
        )}
      </div>
      {error && (
        <p className="mt-2 text-[11px] font-medium text-rc-amber-deep" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
