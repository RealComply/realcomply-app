"use client";

import { useState, useTransition } from "react";
import { Globe, AlertTriangle, Check } from "lucide-react";
import { checkListingNow, findListingPage, confirmListingPage, type ListingCandidate } from "@/lib/actions/website-scan";

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
  const [candidate, setCandidate] = useState<ListingCandidate | null>(null);

  function find() {
    setError(null);
    setCandidate(null);
    startTransition(async () => {
      const result = await findListingPage(propertyId);
      if (result.error) setError(result.error);
      else if (result.candidate) setCandidate(result.candidate);
    });
  }

  function confirm() {
    if (!candidate) return;
    setError(null);
    startTransition(async () => {
      const result = await confirmListingPage(propertyId, candidate.url);
      if (result.error) setError(result.error);
      else setCandidate(null);
    });
  }

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
            candidate ? (
              /* Proposed, not adopted. The agent confirms once and it becomes
                 the stored address; a match accepted silently would mean the
                 weekly check reporting all clear on somebody else's page. */
              <div className="mt-1 rounded-md border border-rc-border bg-rc-bg-alt px-2.5 py-2">
                <p className="text-[11px] font-semibold text-rc-ink">Is this the right page?</p>
                <p className="mt-1 break-all text-[11px] leading-relaxed text-rc-muted">{candidate.url}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-rc-faint">{candidate.why}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <a
                    href={candidate.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-medium text-rc-muted transition hover:text-rc-ink"
                  >
                    Open it
                  </a>
                  <button
                    type="button"
                    onClick={confirm}
                    disabled={pending}
                    className="rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
                  >
                    {pending ? "Saving…" : "Yes, that's it"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCandidate(null)}
                    className="rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-medium text-rc-muted transition hover:text-rc-ink"
                  >
                    No
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-1">
                <p className="text-[11px] leading-relaxed text-rc-muted">
                  Not linked to a listing page yet. I can look for it on your website, or you can paste the link in
                  Edit listing details.
                </p>
                <button
                  type="button"
                  onClick={find}
                  disabled={pending}
                  className="mt-2 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-ink transition hover:border-rc-ink/20 disabled:opacity-60"
                >
                  {pending ? "Looking…" : "Find the listing page"}
                </button>
              </div>
            )
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
